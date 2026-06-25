// Deterministic nutrition targets (item #11). The app computes calorie, protein,
// fat, carb, and hydration targets from the user's profile; the coach explains
// them and never invents its own. Reproducible: same inputs → same numbers.
//
// Energy: Mifflin-St Jeor BMR × activity factor = TDEE, then a goal-adjusted
// calorie target. Safety is deterministic, not advisory — we never return a
// crash-diet number: deficits are capped and floored, and pregnancy/lactation/
// minors are held at maintenance with a clinician deferral. See
// plans/calorie-feedback-calibration.md.

import { ActivityLevel, UserProfile, WeightGoal } from "../types";

export const KCAL_PER_KG = 7700; // ~kcal per kg of body mass
const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};
const CAL_FLOOR: Record<"male" | "female", number> = { male: 1500, female: 1200 };
const MAX_DEFICIT_FRACTION = 0.25; // never cut more than 25% below maintenance
const MAX_SURPLUS_FRACTION = 0.2; // gentle surplus cap to limit fat gain

// Protein g/kg by goal: low–high range. Higher in a deficit to preserve lean
// mass; moderate at maintenance (general healthy-adult guidance, above the
// 0.8 g/kg RDA floor).
const PROTEIN_G_PER_KG: Record<WeightGoal, { min: number; max: number }> = {
  lose: { min: 1.6, max: 2.2 },
  maintain: { min: 1.2, max: 1.6 },
  gain: { min: 1.6, max: 2.0 },
};

export interface Range {
  min: number;
  max: number;
}

export interface NutritionTargets {
  ok: true;
  bmr: number;
  tdee: number;
  activityFactor: number;
  maintenanceKcal: number; // = tdee, the no-change anchor
  calorieTarget: number; // goal-adjusted, after caps + floor
  calorieBand: Range; // small band around the target for intake-vs-target framing
  goal: WeightGoal;
  dailyDeltaKcal: number; // signed adjustment actually applied (after caps/floor)
  proteinG: Range;
  fatG: Range;
  carbsG: Range;
  waterMl: Range;
  weightKg: number;
  safetyNotes: string[]; // deterministic guardrail explanations
  deferredToClinician: boolean; // pregnancy/lactation/minor → maintenance only
}

export interface TargetsUnavailable {
  ok: false;
  missing: string[];
}

const round = (n: number) => Math.round(n);
const round5 = (n: number) => Math.round(n / 5) * 5;

function bmrMifflin(sex: "male" | "female", kg: number, cm: number, age: number): number {
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

/**
 * Compute targets from a profile + resolved weight + age. Returns
 * { ok:false, missing } when a required field is absent (drives the coach's
 * "ask first" gate). Pure — no I/O.
 */
export function computeTargets(
  profile: UserProfile,
  weightKg: number | null,
  age: number | null
): NutritionTargets | TargetsUnavailable {
  const missing: string[] = [];
  if (!profile.sex) missing.push("biological sex");
  if (age == null) missing.push("date of birth");
  if (!profile.heightCm) missing.push("height");
  if (weightKg == null) missing.push("current weight");
  if (!profile.activityLevel) missing.push("activity level");
  if (missing.length) return { ok: false, missing };

  const sex = profile.sex as "male" | "female";
  const cm = profile.heightCm!;
  const kg = weightKg!;
  const activity = profile.activityLevel!;
  const activityFactor = ACTIVITY_FACTOR[activity];
  const goal: WeightGoal = profile.goal ?? "maintain";

  const bmr = bmrMifflin(sex, kg, cm, age!);
  const tdee = bmr * activityFactor;

  const safetyNotes: string[] = [];

  // Safety overrides: never prescribe a deficit/surplus for these populations.
  const minor = age! < 18;
  const deferred = profile.pregnantOrLactating || minor;
  if (profile.pregnantOrLactating) {
    safetyNotes.push("Pregnancy/lactation needs individualized targets — showing maintenance only; set energy/macros with your clinician.");
  }
  if (minor) {
    safetyNotes.push("Under-18 targets should come from a pediatric clinician — showing maintenance only.");
  }

  // Desired daily delta from goal + target rate (defaults to a sustainable
  // 0.4 kg/week when a goal is set without a rate).
  let delta = 0;
  if (!deferred && goal !== "maintain") {
    const rate = profile.targetRateKgPerWeek && profile.targetRateKgPerWeek > 0 ? profile.targetRateKgPerWeek : 0.4;
    const magnitude = (rate * KCAL_PER_KG) / 7;
    delta = goal === "lose" ? -magnitude : magnitude;
  }

  // Cap the adjustment so it never becomes a crash diet (or an extreme bulk).
  const maxDeficit = MAX_DEFICIT_FRACTION * tdee;
  const maxSurplus = MAX_SURPLUS_FRACTION * tdee;
  if (delta < -maxDeficit) {
    delta = -maxDeficit;
    safetyNotes.push(`Deficit capped at 25% of maintenance (a faster cut than that risks muscle and rebound).`);
  }
  if (delta > maxSurplus) {
    delta = maxSurplus;
    safetyNotes.push("Surplus capped at 20% of maintenance to limit fat gain.");
  }

  let calorieTarget = tdee + delta;
  const floor = CAL_FLOOR[sex];
  if (calorieTarget < floor) {
    calorieTarget = floor;
    safetyNotes.push(`Held at the ${floor} kcal/day minimum — we never prescribe lower.`);
  }
  calorieTarget = round5(calorieTarget);
  const dailyDeltaKcal = round(calorieTarget - tdee);

  if (profile.conditions) {
    safetyNotes.push(`You noted "${profile.conditions}" — adjust these general targets with your clinician.`);
  }

  // Macros. Protein from g/kg by goal; fat 20–35% of calories; carbs fill the
  // rest (computed at the fat extremes so the ranges are consistent).
  const pkg = PROTEIN_G_PER_KG[deferred ? "maintain" : goal];
  const proteinG: Range = { min: round5(pkg.min * kg), max: round5(pkg.max * kg) };
  const proteinMidKcal = ((proteinG.min + proteinG.max) / 2) * 4;

  const fatG: Range = { min: round5((0.2 * calorieTarget) / 9), max: round5((0.35 * calorieTarget) / 9) };
  const carbsMax = (calorieTarget - proteinMidKcal - fatG.min * 9) / 4;
  const carbsMin = (calorieTarget - proteinMidKcal - fatG.max * 9) / 4;
  const carbsG: Range = { min: Math.max(0, round5(carbsMin)), max: Math.max(0, round5(carbsMax)) };

  // Hydration: ~30–35 ml/kg total water (food contributes ~20%, noted to the user).
  const waterMl: Range = { min: round(30 * kg), max: round(35 * kg) };

  const bandPad = Math.max(75, round(0.05 * calorieTarget));
  return {
    ok: true,
    bmr: round(bmr),
    tdee: round(tdee),
    activityFactor,
    maintenanceKcal: round(tdee),
    calorieTarget,
    calorieBand: { min: calorieTarget - bandPad, max: calorieTarget + bandPad },
    goal,
    dailyDeltaKcal,
    proteinG,
    fatG,
    carbsG,
    waterMl,
    weightKg: kg,
    safetyNotes,
    deferredToClinician: deferred,
  };
}

const GOAL_VERB: Record<WeightGoal, string> = { lose: "lose", maintain: "maintain", gain: "gain" };

/**
 * Render the targets as a coach-context block, with a weekly intake comparison
 * (trend-aware framing — judge the week, not a single day) when intake is known.
 */
export function formatTargetsForCoach(
  t: NutritionTargets,
  recentIntake?: { avgKcal: number; daysLogged: number } | null
): string {
  const L = (ml: number) => (ml / 1000).toFixed(1);
  const lines: string[] = ["== Nutrition targets (deterministic; Mifflin-St Jeor) =="];

  const anchor = `Maintenance ~${t.maintenanceKcal} kcal/day (BMR ${t.bmr} × ${t.activityFactor} activity, weight ${t.weightKg}kg).`;
  const goalLine =
    t.dailyDeltaKcal === 0
      ? `Target ~${t.calorieTarget} kcal/day (${GOAL_VERB[t.goal]}).`
      : `Goal: ${GOAL_VERB[t.goal]} → target ~${t.calorieTarget} kcal/day (${t.dailyDeltaKcal > 0 ? "+" : ""}${t.dailyDeltaKcal} vs maintenance).`;
  lines.push(`${anchor} ${goalLine}`);
  lines.push(
    `Protein ${t.proteinG.min}–${t.proteinG.max} g/day, fat ${t.fatG.min}–${t.fatG.max} g, carbs ${t.carbsG.min}–${t.carbsG.max} g. Water ${L(t.waterMl.min)}–${L(t.waterMl.max)} L/day total (food covers ~20%).`
  );

  if (recentIntake && recentIntake.daysLogged > 0) {
    const gap = recentIntake.avgKcal - t.calorieTarget;
    const rel = Math.abs(gap) <= (t.calorieBand.max - t.calorieTarget) ? "on target" : gap > 0 ? `~${Math.round(gap)} over` : `~${Math.round(-gap)} under`;
    lines.push(`This week: averaging ${recentIntake.avgKcal} kcal/day intake (${recentIntake.daysLogged} day(s) logged) — ${rel}. Judge the weekly trend, not single days.`);
  }

  if (t.safetyNotes.length) lines.push(`Safety: ${t.safetyNotes.join(" ")}`);
  lines.push("These are estimates expressed as ranges — not exact prescriptions.");
  return lines.join("\n");
}
