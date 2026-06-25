// User profile: local persistence + deterministic derivations (age, BMI,
// healthy-weight range). Manual-first; biological sex/height/weight/activity/goal
// feed the deterministic nutrition targets in a later phase (#11). Route handlers
// stay thin and call into here. Derived figures are ALWAYS computed (never
// persisted) so the coach quotes one source of truth — it never recomputes BMI.
//
// Stored in data/profile.json, separate from data/userinfo.json (Google
// name/photo). Nothing here is ever written back to Google Health.

import { readJson, writeJson } from "./store";
import {
  ActivityLevel,
  BiologicalSex,
  BmiCategory,
  ProfileDerived,
  UserProfile,
  WeightGoal,
} from "./types";

const PROFILE = "profile.json";

const SEXES: BiologicalSex[] = ["male", "female"];
const ACTIVITY: ActivityLevel[] = ["sedentary", "light", "moderate", "active", "very_active"];
const GOALS: WeightGoal[] = ["lose", "maintain", "gain"];

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary (little exercise)",
  light: "Light (1–3 days/week)",
  moderate: "Moderate (3–5 days/week)",
  active: "Active (6–7 days/week)",
  very_active: "Very active (hard daily training / physical job)",
};

export const GOAL_LABELS: Record<WeightGoal, string> = {
  lose: "Lose weight",
  maintain: "Maintain weight",
  gain: "Gain weight",
};

export function emptyProfile(): UserProfile {
  return {
    sex: null,
    birthDate: null,
    heightCm: null,
    weightKg: null,
    activityLevel: null,
    goal: null,
    targetRateKgPerWeek: null,
    pregnantOrLactating: false,
    conditions: null,
    updatedAt: new Date().toISOString(),
  };
}

export function getProfile(): UserProfile {
  const stored = readJson<Partial<UserProfile> | null>(PROFILE, null);
  return { ...emptyProfile(), ...(stored ?? {}), updatedAt: stored?.updatedAt ?? emptyProfile().updatedAt };
}

// ── sanitize ────────────────────────────────────────────────────────────────
function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

function validBirthDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v + "T12:00:00Z");
  if (Number.isNaN(t)) return null;
  const age = ageFromBirthDate(v);
  if (age == null || age < 0 || age > 120) return null;
  return v;
}

/** Merge a partial patch into the stored profile, clamping to sane ranges. Only
 *  keys present in the patch are touched (undefined leaves the field as-is;
 *  explicit null clears it). */
export function saveProfile(patch: Record<string, unknown>): UserProfile {
  const cur = getProfile();
  const next: UserProfile = { ...cur };

  if ("sex" in patch) next.sex = SEXES.includes(patch.sex as BiologicalSex) ? (patch.sex as BiologicalSex) : null;
  if ("birthDate" in patch) next.birthDate = patch.birthDate == null ? null : validBirthDate(patch.birthDate);
  if ("heightCm" in patch) next.heightCm = patch.heightCm == null ? null : num(patch.heightCm, 50, 272);
  if ("weightKg" in patch) next.weightKg = patch.weightKg == null ? null : num(patch.weightKg, 20, 500);
  if ("activityLevel" in patch)
    next.activityLevel = ACTIVITY.includes(patch.activityLevel as ActivityLevel) ? (patch.activityLevel as ActivityLevel) : null;
  if ("goal" in patch) next.goal = GOALS.includes(patch.goal as WeightGoal) ? (patch.goal as WeightGoal) : null;
  if ("targetRateKgPerWeek" in patch)
    next.targetRateKgPerWeek = patch.targetRateKgPerWeek == null ? null : num(Math.abs(Number(patch.targetRateKgPerWeek)), 0, 1.5);
  if ("pregnantOrLactating" in patch) next.pregnantOrLactating = !!patch.pregnantOrLactating;
  if ("conditions" in patch) {
    const c = typeof patch.conditions === "string" ? patch.conditions.trim() : "";
    next.conditions = c ? c.slice(0, 500) : null;
  }

  next.updatedAt = new Date().toISOString();
  writeJson(PROFILE, next);
  return next;
}

// ── derivations ───────────────────────────────────────────────────────────────
export function ageFromBirthDate(birthDate: string | null, now = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = now.getFullYear() - y;
  const mo = now.getMonth() + 1;
  const day = now.getDate();
  if (mo < m || (mo === m && day < d)) age--;
  return age >= 0 && age <= 120 ? age : null;
}

export function computeBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const h = heightCm / 100;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

// CDC adult BMI framing — general wellness reference, not a diagnosis.
export function bmiCategory(bmi: number | null): BmiCategory | null {
  if (bmi == null) return null;
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

/** Weight range for a "normal" BMI (18.5–24.9) at this height, kg, 1-decimal. */
export function healthyWeightRange(heightCm: number | null): { min: number; max: number } | null {
  if (!heightCm) return null;
  const h = heightCm / 100;
  return {
    min: Math.round(18.5 * h * h * 10) / 10,
    max: Math.round(24.9 * h * h * 10) / 10,
  };
}

const TARGET_FIELD_LABELS: Record<string, string> = {
  sex: "biological sex",
  birthDate: "date of birth",
  heightCm: "height",
  weight: "current weight",
  activityLevel: "activity level",
};

/**
 * Derive everything the coach quotes from the stored profile plus an optional
 * resolved device weight (preferred over the manual figure when present).
 */
export function deriveProfile(profile: UserProfile, deviceWeightKg: number | null = null): ProfileDerived {
  const age = ageFromBirthDate(profile.birthDate);

  let weightKgResolved: number | null = null;
  let weightSource: "device" | "manual" | null = null;
  if (deviceWeightKg != null) {
    weightKgResolved = Math.round(deviceWeightKg * 10) / 10;
    weightSource = "device";
  } else if (profile.weightKg != null) {
    weightKgResolved = profile.weightKg;
    weightSource = "manual";
  }

  const bmi = computeBmi(weightKgResolved, profile.heightCm);

  // Fields a precise (deterministic) calorie/macro target needs before the
  // coach should commit to one — drives the "ask first" gate (#10/#11).
  const missingForTargets: string[] = [];
  if (!profile.sex) missingForTargets.push(TARGET_FIELD_LABELS.sex);
  if (age == null) missingForTargets.push(TARGET_FIELD_LABELS.birthDate);
  if (!profile.heightCm) missingForTargets.push(TARGET_FIELD_LABELS.heightCm);
  if (weightKgResolved == null) missingForTargets.push(TARGET_FIELD_LABELS.weight);
  if (!profile.activityLevel) missingForTargets.push(TARGET_FIELD_LABELS.activityLevel);

  return {
    age,
    weightKgResolved,
    weightSource,
    bmi,
    bmiCategory: bmiCategory(bmi),
    healthyWeightRangeKg: healthyWeightRange(profile.heightCm),
    missingForTargets,
  };
}
