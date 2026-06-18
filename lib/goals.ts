// Macro health goals: defaults, local persistence, deterministic status/progress
// math, and value resolution from existing stores. Route handlers stay thin and
// call into here. Status is ALWAYS computed (never persisted as source of truth)
// from the latest tracked value vs the target — the AI only explains it.
//
// Lab-backed goals reuse the canonical keys from lib/labs.ts and read their
// latest value from records-index.json; device goals read DaySummary fields via
// getRecentDays. No second copy of any measurement is stored here.
//
// Weight write-back to Google Health and height/BMI are a later phase (see
// plans/goals-menu.md build order); this module is read-only against device data.

import fs from "fs";
import { readJson, writeJson, dataPath, newId } from "./store";
import {
  DaySummary,
  GoalDefinition,
  GoalDirection,
  GoalProgress,
  GoalSource,
  GoalStatus,
  MedicalRecord,
} from "./types";

const GOALS = "goals.json";
const RECORDS = "records-index.json";
const MIGRATIONS = "goals-migrations.json";

const SOURCES: GoalSource[] = ["lab", "device"];
const DIRECTIONS: GoalDirection[] = ["lower_is_better", "higher_is_better", "target_range"];

// ── device metric accessors ────────────────────────────────────────────────
// Non-lab goals read these DaySummary fields (the same data Daily/Trends fetch).
export const DEVICE_METRICS: Record<string, (d: DaySummary) => number | null> = {
  weightKg: (d) => d.weightKg,
  steps: (d) => (d.steps > 0 ? d.steps : null),
  restingHeartRate: (d) => d.restingHeartRate,
  sleepHours: (d) => (d.sleep ? Math.round((d.sleep.durationMin / 60) * 10) / 10 : null),
};

// ── per-metric static metadata (reference notes for the editor) ─────────────
// Curated, conservative "why a personal target may differ" copy — general
// education, never medical advice. Kept in code so it can improve without
// migrating user files.
export interface GoalMeta {
  whyNote?: string;
}
export const GOAL_META: Record<string, GoalMeta> = {
  "ldl-cholesterol": {
    whyNote:
      "Lab 'normal' is often < 3.0 mmol/L. People managing cardiovascular risk often aim lower (e.g. ≤ 2.6). Pick a target with your clinician.",
  },
  "hdl-cholesterol": {
    whyNote: "Higher is generally better. Common floors are ≥ 1.0 mmol/L (men) / ≥ 1.3 (women).",
  },
  hba1c: {
    whyNote:
      "Below 5.7% is typical 'normal'. Many aim for the lower end of normal; diabetes-management targets differ — follow clinical advice.",
  },
  "glucose-fasting": {
    whyNote: "A common healthy fasting range is ~3.9–5.5 mmol/L. Targets differ with clinical context.",
  },
  "total-cholesterol": { whyNote: "A widely used desirable ceiling is < 5.2 mmol/L." },
  triglycerides: { whyNote: "A widely used desirable ceiling is < 1.7 mmol/L." },
};

// ── seedable macro set ───────────────────────────────────────────────────────
// General wellbeing references the user can override, NOT diagnostic thresholds.
function defaultGoal(
  partial: Omit<GoalDefinition, "active" | "showOnDaily" | "showOnTrends" | "coachVisible" | "isDefault" | "createdAt" | "updatedAt">
): GoalDefinition {
  const now = new Date().toISOString();
  return {
    active: true,
    showOnDaily: false, // off by default — the user opts goals onto Daily
    showOnTrends: true,
    coachVisible: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function goalDefaults(): GoalDefinition[] {
  return [
    defaultGoal({ id: "weight", metricKey: "weightKg", source: "device", label: "Body weight", iconKey: "scale", direction: "target_range", unit: "kg" }),
    defaultGoal({ id: "steps", metricKey: "steps", source: "device", label: "Daily steps", iconKey: "steps", direction: "higher_is_better", unit: "steps", targetMin: 10000 }),
    defaultGoal({ id: "resting-hr", metricKey: "restingHeartRate", source: "device", label: "Resting heart rate", iconKey: "pulse", direction: "lower_is_better", unit: "bpm", targetMax: 65 }),
    defaultGoal({ id: "sleep", metricKey: "sleepHours", source: "device", label: "Sleep duration", iconKey: "moon", direction: "higher_is_better", unit: "h", targetMin: 7 }),
    defaultGoal({ id: "glucose-fasting", metricKey: "glucose-fasting", source: "lab", label: "Fasting glucose", iconKey: "water", direction: "target_range", unit: "mmol/L", targetMin: 3.9, targetMax: 5.5 }),
    defaultGoal({ id: "hba1c", metricKey: "hba1c", source: "lab", label: "HbA1c", iconKey: "flame", direction: "lower_is_better", unit: "%", targetMax: 5.6 }),
    defaultGoal({ id: "total-cholesterol", metricKey: "total-cholesterol", source: "lab", label: "Total cholesterol", iconKey: "heart", direction: "lower_is_better", unit: "mmol/L", targetMax: 5.2 }),
    defaultGoal({ id: "ldl-cholesterol", metricKey: "ldl-cholesterol", source: "lab", label: "LDL", iconKey: "heart", direction: "lower_is_better", unit: "mmol/L", targetMax: 2.6 }),
    defaultGoal({ id: "hdl-cholesterol", metricKey: "hdl-cholesterol", source: "lab", label: "HDL", iconKey: "heart", direction: "higher_is_better", unit: "mmol/L", targetMin: 1.0 }),
    defaultGoal({ id: "triglycerides", metricKey: "triglycerides", source: "lab", label: "Triglycerides", iconKey: "leaf", direction: "lower_is_better", unit: "mmol/L", targetMax: 1.7 }),
  ];
}

// ── persistence ──────────────────────────────────────────────────────────────

/** Load goals, seeding the macro defaults on first run. */
export function getGoals(): GoalDefinition[] {
  if (!fs.existsSync(dataPath(GOALS))) {
    const seeded = goalDefaults();
    writeJson(GOALS, seeded);
    return seeded;
  }
  return migrateGoals(readJson<GoalDefinition[]>(GOALS, []));
}

/** One-time migrations for goals saved by older versions. Converts the legacy
 *  minutes-based sleep goal (metricKey "sleepMin", target in minutes) to the
 *  hours-based one ("sleepHours"). */
function migrateGoals(goals: GoalDefinition[]): GoalDefinition[] {
  const flags = readJson<Record<string, boolean>>(MIGRATIONS, {});
  let changed = false;
  const toHours = (v?: number) => (v != null ? Math.round((v / 60) * 10) / 10 : v);
  let out = goals.map((g) => {
    if (g.metricKey === "sleepMin") {
      changed = true;
      return { ...g, metricKey: "sleepHours", unit: "h", targetMin: toHours(g.targetMin), targetMax: toHours(g.targetMax) };
    }
    return g;
  });
  // One-time: start everyone with goals hidden from Daily (opt-in), since the
  // old default showed device goals and the toggle had no visible effect.
  if (!flags.dailyOptIn) {
    out = out.map((g) => (g.showOnDaily ? ((changed = true), { ...g, showOnDaily: false }) : g));
    flags.dailyOptIn = true;
    writeJson(MIGRATIONS, flags);
  }
  if (changed) saveGoals(out);
  return out;
}

export function saveGoals(goals: GoalDefinition[]) {
  writeJson(GOALS, goals);
}

// ── untrusted-body validation (mirrors lib/habits.ts) ───────────────────────
const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
};
const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : undefined;
};
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/**
 * Normalize an untrusted create/update body into a GoalDefinition. `existing` is
 * passed on edits so unspecified fields and timestamps survive. metricKey/source
 * are immutable once set (only honored on create).
 */
export function sanitizeGoal(raw: unknown, existing?: GoalDefinition): GoalDefinition | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid body" };
  const r = raw as Record<string, unknown>;
  const now = new Date().toISOString();

  const source: GoalSource = existing?.source ?? (SOURCES.includes(r.source as GoalSource) ? (r.source as GoalSource) : "device");
  const metricKey = existing?.metricKey ?? str(r.metricKey, 48);
  if (!metricKey) return { error: "metricKey is required" };

  const label = str(r.label, 60) ?? existing?.label ?? metricKey;
  const direction: GoalDirection = DIRECTIONS.includes(r.direction as GoalDirection)
    ? (r.direction as GoalDirection)
    : existing?.direction ?? "target_range";

  const def: GoalDefinition = {
    id: existing?.id ?? "",
    metricKey,
    source,
    label,
    iconKey: str(r.iconKey, 40) ?? existing?.iconKey ?? "check",
    direction,
    unit: str(r.unit, 24) ?? existing?.unit ?? "",
    targetMin: "targetMin" in r ? num(r.targetMin) : existing?.targetMin,
    targetMax: "targetMax" in r ? num(r.targetMax) : existing?.targetMax,
    tolerancePct: "tolerancePct" in r ? num(r.tolerancePct) : existing?.tolerancePct,
    active: bool(r.active, existing?.active ?? true),
    showOnDaily: bool(r.showOnDaily, existing?.showOnDaily ?? true),
    showOnTrends: bool(r.showOnTrends, existing?.showOnTrends ?? true),
    coachVisible: bool(r.coachVisible, existing?.coachVisible ?? true),
    isDefault: existing?.isDefault ?? false,
    note: str(r.note, 280) ?? existing?.note,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return def;
}

// ── latest value resolution ──────────────────────────────────────────────────

function recordDate(r: MedicalRecord): string {
  return r.reportDate || r.uploadedAt.slice(0, 10);
}

export interface LatestLab {
  value: number;
  date: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
}

/** Newest dated numeric value for a canonical lab key across all records. */
export function latestLabValue(key: string, records?: MedicalRecord[]): LatestLab | null {
  const recs = records ?? readJson<MedicalRecord[]>(RECORDS, []);
  let best: LatestLab | null = null;
  for (const r of recs) {
    if (!r.metrics?.length) continue;
    const date = recordDate(r);
    for (const m of r.metrics) {
      if (m.key !== key || m.value == null) continue;
      if (!best || date > best.date) {
        best = { value: m.value, date, unit: m.unit || "", refLow: m.refLow, refHigh: m.refHigh };
      }
    }
  }
  return best;
}

/** Latest non-null device value for a metric key, newest first. */
export function latestDeviceValue(metricKey: string, days: DaySummary[]): { value: number; date: string } | null {
  const accessor = DEVICE_METRICS[metricKey];
  if (!accessor) return null;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = accessor(days[i]);
    if (v != null) return { value: v, date: days[i].date };
  }
  return null;
}

// ── deterministic status / progress math ─────────────────────────────────────

function statusFor(goal: GoalDefinition, value: number): GoalStatus {
  const t = goal.tolerancePct ?? 0.1;
  const { targetMin: min, targetMax: max, direction } = goal;
  switch (direction) {
    case "lower_is_better":
      if (max == null) return "no_data";
      if (value <= max) return "met";
      return value <= max * (1 + t) ? "on_track" : "needs_attention";
    case "higher_is_better":
      if (min == null) return "no_data";
      if (value >= min) return "met";
      return value >= min * (1 - t) ? "on_track" : "needs_attention";
    case "target_range": {
      if (min == null || max == null) return "no_data";
      if (value >= min && value <= max) return "met";
      const span = (max - min) || Math.abs(max) || 1;
      const out = value < min ? min - value : value - max;
      return out <= span * t ? "on_track" : "needs_attention";
    }
  }
}

function progressFor(goal: GoalDefinition, value: number): number | null {
  const { targetMin: min, targetMax: max, direction } = goal;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  switch (direction) {
    case "lower_is_better":
      return max == null || max === 0 ? null : clamp01(max / value);
    case "higher_is_better":
      return min == null || min === 0 ? null : clamp01(value / min);
    case "target_range": {
      if (min == null || max == null) return null;
      if (value >= min && value <= max) return 1;
      const span = (max - min) || Math.abs(max) || 1;
      const out = value < min ? min - value : value - max;
      return clamp01(1 - out / span);
    }
  }
}

/** Signed gap to the relevant target bound (positive = over a ceiling / under a floor). */
function deltaFor(goal: GoalDefinition, value: number): number | null {
  const round = (x: number) => Math.round(x * 100) / 100;
  switch (goal.direction) {
    case "lower_is_better":
      return goal.targetMax == null ? null : round(value - goal.targetMax);
    case "higher_is_better":
      return goal.targetMin == null ? null : round(goal.targetMin - value);
    case "target_range":
      if (goal.targetMin == null || goal.targetMax == null) return null;
      if (value < goal.targetMin) return round(goal.targetMin - value);
      if (value > goal.targetMax) return round(value - goal.targetMax);
      return 0;
  }
}

export function computeGoalProgress(
  goal: GoalDefinition,
  latest: { value: number; date: string } | null
): GoalProgress {
  const base: GoalProgress = {
    goalId: goal.id,
    metricKey: goal.metricKey,
    status: "no_data",
    latestValue: null,
    latestDate: null,
    target: { min: goal.targetMin, max: goal.targetMax },
    direction: goal.direction,
    unit: goal.unit,
    progress: null,
    delta: null,
  };
  if (!latest) return base;
  return {
    ...base,
    status: statusFor(goal, latest.value),
    latestValue: latest.value,
    latestDate: latest.date,
    progress: progressFor(goal, latest.value),
    delta: deltaFor(goal, latest.value),
  };
}

/** Compute progress for every active goal from the latest device/lab values. */
export async function buildAllProgress(goals: GoalDefinition[]): Promise<{ progress: GoalProgress[]; demo: boolean }> {
  const active = goals.filter((g) => g.active);
  const needsDevice = active.some((g) => g.source === "device");
  let days: DaySummary[] = [];
  let demo = false;
  if (needsDevice) {
    // Lazy import to avoid a static context <-> goals import cycle.
    const { getRecentDays } = await import("./context");
    const recent = await getRecentDays(90);
    days = recent.days;
    demo = recent.demo;
  }
  const records = active.some((g) => g.source === "lab") ? readJson<MedicalRecord[]>(RECORDS, []) : [];

  const progress = active.map((g) => {
    const latest =
      g.source === "device"
        ? latestDeviceValue(g.metricKey, days)
        : (() => {
            const l = latestLabValue(g.metricKey, records);
            return l ? { value: l.value, date: l.date } : null;
          })();
    return computeGoalProgress(g, latest);
  });
  return { progress, demo };
}

// ── coach context ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<GoalStatus, string> = {
  met: "met",
  on_track: "on track",
  needs_attention: "needs attention",
  no_data: "no data yet",
};

/** Compact "== Goals ==" block for the coach: target, latest value+date, status. */
export function formatGoalsForCoach(goals: GoalDefinition[], progress: GoalProgress[]): string {
  const byId = new Map(progress.map((p) => [p.goalId, p]));
  const lines = goals
    .filter((g) => g.active && g.coachVisible)
    .map((g) => {
      const p = byId.get(g.id);
      const target =
        g.direction === "lower_is_better"
          ? `≤ ${g.targetMax}`
          : g.direction === "higher_is_better"
            ? `≥ ${g.targetMin}`
            : `${g.targetMin}–${g.targetMax}`;
      if (!p || p.latestValue == null) return `${g.label}: target ${target} ${g.unit}, no data yet`;
      const deltaStr = p.delta && p.delta !== 0 ? ` (${p.delta > 0 ? "+" : ""}${p.delta})` : "";
      return `${g.label}: target ${target} ${g.unit}, latest ${p.latestValue} (${p.latestDate}), ${STATUS_LABEL[p.status]}${deltaStr}`;
    });
  if (!lines.length) return "";
  return ["== Goals (targets the user set; status is computed, do not recompute) ==", ...lines].join("\n");
}
