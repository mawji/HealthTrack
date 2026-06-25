// Deterministic exercise grounding. The app computes the weekly activity numbers
// and the readiness-gated intensity call; the coach only explains them. No
// external API — this reads the workout + readiness data the app already has.
//
// Weekly aerobic load is measured in Active Zone Minutes (AZM), which credit 1
// min per moderate minute and 2 per vigorous minute — the same mapping behind
// ODPHP's "150 min moderate OR 75 min vigorous", so the weekly AZM target is
// 150. See lib/evidence/rules.ts for the cited guideline.

import { DaySummary, ReadinessScore, WorkoutSession } from "../types";

export const AEROBIC_AZM_TARGET = 150; // ODPHP 150 min/week moderate-equivalent
export const STRENGTH_DAYS_TARGET = 2; // ODPHP: 2+ days/week, all major muscle groups
export const EXERCISE_SOURCE = "ODPHP Physical Activity Guidelines";

// Google ExerciseType values that count as muscle-strengthening for the
// strength-days tally (kept narrow — cardio/sport types don't count).
const STRENGTH_TYPES = new Set([
  "STRENGTH_TRAINING",
  "WEIGHTS",
  "BODY_WEIGHT",
  "CALISTHENICS",
  "CROSSFIT",
  "CORE_TRAINING",
]);

export interface WeeklyActivity {
  aerobicMinutes: number; // weekly AZM sum over the days available
  aerobicTarget: number; // 150
  aerobicRemaining: number; // max(0, target - actual)
  aerobicMet: boolean;
  strengthDays: number; // distinct days with a strength session
  strengthTarget: number; // 2
  strengthMet: boolean;
  daysCounted: number; // how many days the aerobic sum covers (≤7)
}

/** Weekly aerobic minutes (AZM) + strength days over the last 7 days available. */
export function summarizeWeeklyActivity(days: DaySummary[], workouts: WorkoutSession[]): WeeklyActivity {
  const last7 = days.slice(-7);
  const dayKeys = new Set(last7.map((d) => d.date));
  const aerobicMinutes = Math.round(last7.reduce((s, d) => s + (d.activeZoneMinutes || 0), 0));

  const strengthDaySet = new Set<string>();
  for (const w of workouts) {
    if (STRENGTH_TYPES.has(w.exerciseType) && dayKeys.has(w.date)) strengthDaySet.add(w.date);
  }
  const strengthDays = strengthDaySet.size;

  return {
    aerobicMinutes,
    aerobicTarget: AEROBIC_AZM_TARGET,
    aerobicRemaining: Math.max(0, AEROBIC_AZM_TARGET - aerobicMinutes),
    aerobicMet: aerobicMinutes >= AEROBIC_AZM_TARGET,
    strengthDays,
    strengthTarget: STRENGTH_DAYS_TARGET,
    strengthMet: strengthDays >= STRENGTH_DAYS_TARGET,
    daysCounted: last7.length,
  };
}

export type TrainingBalance = "sedentary" | "aerobic_only" | "strength_only" | "balanced" | "well_rounded";

/** Coarse balance read from the two weekly metrics — NOT a load/intensity model
 *  (acute:chronic cardio load is a separate, later feature). */
export function classifyTrainingBalance(w: WeeklyActivity): TrainingBalance {
  const someAerobic = w.aerobicMinutes >= w.aerobicTarget / 2;
  const someStrength = w.strengthDays >= 1;
  if (!someAerobic && !someStrength) return "sedentary";
  if (someAerobic && !someStrength) return "aerobic_only";
  if (!someAerobic && someStrength) return "strength_only";
  return w.aerobicMet && w.strengthMet ? "well_rounded" : "balanced";
}

export type IntensityRec = "recovery" | "easy" | "maintain" | "progress";

export interface TrainingIntensity {
  rec: IntensityRec;
  reason: string; // readiness-/data-grounded "why"
}

/**
 * Readiness-gated intensity call. Low readiness biases to active recovery
 * regardless of weekly gaps; otherwise the weekly target gap decides whether to
 * progress or maintain. Stated limitations cap intensity.
 */
export function recommendTrainingIntensity(
  readiness: ReadinessScore | null,
  weekly: WeeklyActivity,
  limitations?: string | null
): TrainingIntensity {
  const r = readiness ? `readiness ${readiness.score}/100 (${readiness.band})` : null;

  if (readiness?.band === "low") {
    return { rec: "recovery", reason: `${r} — bias to active recovery: a walk, mobility, or light technique work, plus extra sleep` };
  }
  if (limitations) {
    return { rec: "easy", reason: `noted limitation (${limitations})${r ? ` and ${r}` : ""} — keep it light and train around it` };
  }
  if (readiness?.band === "fair") {
    return { rec: "easy", reason: `${r} — keep it moderate today; hold off on a hard session` };
  }

  const behind = !weekly.aerobicMet || !weekly.strengthMet;
  if (readiness?.band === "good" || readiness?.band === "high") {
    return behind
      ? { rec: "progress", reason: `${r} — a good day to close the weekly gap (${weekly.aerobicRemaining} aerobic min / ${Math.max(0, weekly.strengthTarget - weekly.strengthDays)} strength day(s) to go)` }
      : { rec: "maintain", reason: `${r} and weekly targets met — maintain or progress as you like` };
  }

  // Unknown readiness — fall back to weekly progress only.
  return behind
    ? { rec: "progress", reason: `build toward the weekly target (${weekly.aerobicRemaining} aerobic min / ${Math.max(0, weekly.strengthTarget - weekly.strengthDays)} strength day(s) to go)` }
    : { rec: "maintain", reason: "weekly targets met — maintain" };
}

const BALANCE_LABEL: Record<TrainingBalance, string> = {
  sedentary: "sedentary",
  aerobic_only: "cardio-leaning (little strength)",
  strength_only: "strength-leaning (little cardio)",
  balanced: "balanced, still building",
  well_rounded: "well-rounded",
};

/** Render the deterministic exercise read as a coach-context block. */
export function formatExerciseForCoach(
  weekly: WeeklyActivity,
  intensity: TrainingIntensity,
  balance: TrainingBalance
): string {
  const aerobic = weekly.aerobicMet
    ? `${weekly.aerobicMinutes} of ${weekly.aerobicTarget} active-zone min/week (met)`
    : `${weekly.aerobicMinutes} of ${weekly.aerobicTarget} active-zone min/week (${weekly.aerobicRemaining} to go)`;
  const strength = weekly.strengthMet
    ? `${weekly.strengthDays} of ${weekly.strengthTarget} strength days (met)`
    : `${weekly.strengthDays} of ${weekly.strengthTarget} strength days`;
  return [
    `== Exercise (deterministic, last ${weekly.daysCounted} days vs ODPHP) ==`,
    `Aerobic: ${aerobic}. Strength: ${strength}. Balance: ${BALANCE_LABEL[balance]}.`,
    `Today's intensity: ${intensity.rec} — ${intensity.reason}.`,
    `Source: ${EXERCISE_SOURCE}.`,
  ].join("\n");
}
