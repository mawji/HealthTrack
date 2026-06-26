// The catalog of shareable metric scopes. Each scope maps a stable key to a
// human label, a privacy category, whether it's leaderboard-eligible (aggregate,
// non-clinical), and a deterministic formatter over ShareData. This is the ONLY
// place that turns the owner's data into text for a contact — combined with the
// filterForContact choke point, there is no path to a metric that isn't a named,
// owner-enabled scope.

import { escapeHtml } from "@/lib/telegram/bot";
import { ShareData } from "@/lib/telegram/share-context";

export type ScopeCategory = "activity" | "nutrition" | "clinical";

export interface ScopeDef {
  key: string;
  label: string;
  category: ScopeCategory;
  /** Eligible for the friends/family aggregate leaderboard (never clinical). */
  leaderboardEligible: boolean;
  /** Deterministic text for this scope, or null when there's no data. */
  format: (d: ShareData) => string | null;
}

const hours = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

export const SCOPE_CATALOG: ScopeDef[] = [
  {
    key: "steps",
    label: "Steps",
    category: "activity",
    leaderboardEligible: true,
    format: (d) => (d.today ? `👣 Steps today: <b>${d.today.steps.toLocaleString()}</b>${d.today.stepsGoal ? ` / ${d.today.stepsGoal.toLocaleString()}` : ""}` : null),
  },
  {
    key: "workout_duration",
    label: "Workout duration",
    category: "activity",
    leaderboardEligible: true,
    format: (d) => {
      const mins = d.workouts.reduce((s, w) => s + (w.durationMin || 0), 0);
      if (!d.workouts.length) return "🏋️ No workouts logged in the last 7 days";
      return `🏋️ Training (7d): <b>${mins} min</b> across ${d.workouts.length} session${d.workouts.length === 1 ? "" : "s"}`;
    },
  },
  {
    key: "workout_detail",
    label: "Workout detail",
    category: "activity",
    leaderboardEligible: false,
    format: (d) => {
      if (!d.workouts.length) return null;
      const lines = d.workouts.slice(0, 5).map(
        (w) => `• ${w.date} — ${escapeHtml(w.name)} (${escapeHtml(w.exerciseType)}) ${w.durationMin}m` + (w.avgHr ? `, avg HR ${w.avgHr}` : "")
      );
      return "🏋️ Recent workouts (last 7 days)\n" + lines.join("\n");
    },
  },
  {
    key: "active_days",
    label: "Active days",
    category: "activity",
    leaderboardEligible: true,
    format: (d) => {
      const active = d.week.filter((x) => x.activeZoneMinutes > 0 || x.steps >= (x.stepsGoal || 8000)).length;
      return `🔥 Active days this week: <b>${active}/${d.week.length}</b>`;
    },
  },
  {
    key: "readiness",
    label: "Readiness",
    category: "activity",
    leaderboardEligible: false,
    format: (d) => (d.readiness ? `🧭 Readiness: <b>${d.readiness.score}/100</b> (${escapeHtml(d.readiness.band)})` : null),
  },
  {
    key: "kcal_intake",
    label: "Calorie intake",
    category: "nutrition",
    leaderboardEligible: false,
    format: (d) => (d.today && d.today.caloriesIn > 0 ? `🍽️ Intake today: <b>${d.today.caloriesIn}</b> kcal` : null),
  },
  {
    key: "hydration",
    label: "Hydration",
    category: "nutrition",
    leaderboardEligible: true,
    format: (d) => (d.waterMl != null ? `💧 Water today: <b>${(d.waterMl / 1000).toFixed(1)} L</b> / ${(d.waterGoalMl / 1000).toFixed(1)} L` : null),
  },
  {
    key: "sleep",
    label: "Sleep",
    category: "clinical",
    leaderboardEligible: false,
    format: (d) => (d.today?.sleep ? `😴 Sleep: <b>${hours(d.today.sleep.durationMin)}</b> · eff ${d.today.sleep.efficiency}%` : null),
  },
  {
    key: "bp",
    label: "Blood pressure",
    category: "clinical",
    leaderboardEligible: false,
    format: (d) => (d.bp ? `🩺 BP: <b>${d.bp.value}/${d.bp.value2 ?? "?"}</b> ${escapeHtml(d.bp.unit)} <span>(${d.bp.at.slice(0, 10)})</span>` : null),
  },
  {
    key: "glucose",
    label: "Glucose",
    category: "clinical",
    leaderboardEligible: false,
    format: (d) => (d.glucose ? `🩸 Glucose: <b>${d.glucose.value}</b> ${escapeHtml(d.glucose.unit)} <span>(${d.glucose.at.slice(0, 10)})</span>` : null),
  },
  {
    key: "weight",
    label: "Weight",
    category: "clinical",
    leaderboardEligible: false,
    format: (d) => (d.weight ? `⚖️ Weight: <b>${d.weight.value}</b> ${escapeHtml(d.weight.unit)} <span>(${d.weight.at.slice(0, 10)})</span>` : null),
  },
];

export const SCOPE_KEYS = SCOPE_CATALOG.map((s) => s.key);
export const SCOPE_BY_KEY = new Map(SCOPE_CATALOG.map((s) => [s.key, s]));
export const LEADERBOARD_SCOPES = SCOPE_CATALOG.filter((s) => s.leaderboardEligible).map((s) => s.key);

export type PresetName = "trainer" | "clinician" | "friend" | "custom";

/** Preset scope bundles. Editable per contact after applying; default is none. */
export const PRESET_SCOPES: Record<Exclude<PresetName, "custom">, string[]> = {
  trainer: ["steps", "workout_duration", "workout_detail", "readiness", "kcal_intake"],
  clinician: ["bp", "glucose", "sleep", "steps", "kcal_intake"],
  friend: LEADERBOARD_SCOPES, // aggregate, non-clinical only
};

/** Validate an arbitrary scope list down to known keys (drops anything else). */
export function sanitizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string" && SCOPE_BY_KEY.has(k));
}
