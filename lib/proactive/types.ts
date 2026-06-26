// Types for the proactive guidance subsystem (item 14).
//
// Design principle (locked): DETERMINISTIC rules decide whether to interrupt.
// AI may later rewrite the copy, but never decides whether a nudge fires. Every
// rule is plain, testable TypeScript that turns the day's context into a
// candidate or null.

export type GuidanceCategory = "water" | "steps" | "movement" | "sleep" | "habits";
export type GuidancePriority = "low" | "medium" | "high";

/** A point-in-time snapshot of "how today is going", built deterministically
 *  from the same data the Daily view reads. Times are LOCAL (APP_TZ). */
export interface ProactiveContext {
  date: string; // yyyy-MM-dd (today, local)
  nowMin: number; // minutes since local midnight
  isToday: boolean; // guidance only ever fires for the live day
  steps: number;
  stepsGoal: number;
  activeZoneMinutes: number;
  waterMl: number | null;
  waterGoalMl: number;
  /** Minutes since the most recent workout ended today, or null if none. */
  minsSinceWorkout: number | null;
  /** Owner's usual bedtime as minutes since local midnight (from preferences). */
  bedtimeMin: number;
  /** Coach-visible boost habits not yet completed today (from the habits system). */
  pendingHabits: { id: string; name: string }[];
}

/** A potential nudge produced by a rule, before guardrails/ranking. */
export interface GuidanceCandidate {
  id: string; // unique rule firing id, e.g. "water.behind_by_time"
  category: GuidanceCategory;
  title: string;
  body: string;
  reason: string; // why it fired (the numbers) — for the delivery log
  priority: GuidancePriority;
  /** ISO; after this the candidate is stale and must not be sent. */
  expiresAt: string;
  /** Cooldown bucket — repeat firings of the same key are rate-limited. */
  cooldownKey: string;
  sourceMetrics: Record<string, number | null>;
}

export interface ProactiveRule {
  id: string;
  category: GuidanceCategory;
  priority: GuidancePriority;
  earliestLocalMin: number; // don't fire before this local time
  latestLocalMin: number; // …or after this
  cooldownHours: number;
  evaluate: (ctx: ProactiveContext) => GuidanceCandidate | null;
}

export interface ProactivePreferences {
  enabled: boolean;
  quietStartMin: number; // local minutes; nudges suppressed within [quietStart, quietEnd)
  quietEndMin: number;
  maxPerDay: number;
  minGapHours: number;
  categories: Record<GuidanceCategory, boolean>;
  usualBedtimeMin: number;
}

export interface DeliveryRecord {
  at: string; // ISO timestamp
  date: string; // local day the nudge was for
  candidateId: string;
  category: GuidanceCategory;
  cooldownKey: string;
  title: string;
  reason: string;
}
