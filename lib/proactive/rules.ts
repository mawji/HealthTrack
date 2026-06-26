// Deterministic proactive rules. Each is pure and testable: context in,
// candidate-or-null out. No AI, no network. Thresholds are intentionally
// conservative (the plan's anti-nag stance) and only fire when enough of the
// day remains for the suggested action to be realistic.

import { GuidanceCandidate, ProactiveContext, ProactiveRule } from "@/lib/proactive/types";

const HM = (h: number, m = 0) => h * 60 + m;

function candidate(
  ctx: ProactiveContext,
  c: Omit<GuidanceCandidate, "expiresAt"> & { expiresInMin?: number }
): GuidanceCandidate {
  const { expiresInMin = 120, ...rest } = c;
  return { ...rest, expiresAt: new Date(Date.now() + expiresInMin * 60_000).toISOString() };
}

/** Fraction of the "active day" (08:00 → 20:00) elapsed, clamped 0..1. */
function dayFraction(nowMin: number): number {
  const start = HM(8), end = HM(20);
  return Math.min(1, Math.max(0, (nowMin - start) / (end - start)));
}

// ── Water: behind expected hydration for the time of day ──────────────────────
const waterRule: ProactiveRule = {
  id: "water.behind_by_time",
  category: "water",
  priority: "medium",
  earliestLocalMin: HM(9),
  latestLocalMin: HM(20, 30),
  cooldownHours: 3,
  evaluate(ctx) {
    if (ctx.waterMl == null) return null; // no data → don't guess
    const expected = ctx.waterGoalMl * dayFraction(ctx.nowMin);
    if (expected <= 0) return null;
    // Only nudge when meaningfully behind (≤65% of expected) and not already near goal.
    if (ctx.waterMl >= ctx.waterGoalMl * 0.9) return null;
    if (ctx.waterMl >= expected * 0.65) return null;
    const remainingMl = Math.max(0, ctx.waterGoalMl - ctx.waterMl);
    const glasses = Math.round(remainingMl / 250);
    return candidate(ctx, {
      id: "water.behind_by_time",
      category: "water",
      priority: "medium",
      cooldownKey: "water",
      title: "Time for some water",
      body: `You're at ${(ctx.waterMl / 1000).toFixed(1)} L so far — about ${glasses} glass${glasses === 1 ? "" : "es"} short of your ${(ctx.waterGoalMl / 1000).toFixed(1)} L goal. A glass now keeps you on track.`,
      reason: `water ${ctx.waterMl}ml vs expected ~${Math.round(expected)}ml by ${ctx.nowMin}min`,
      sourceMetrics: { waterMl: ctx.waterMl, expectedMl: Math.round(expected), goalMl: ctx.waterGoalMl },
    });
  },
};

// ── Steps: behind goal pace with enough day left to catch up ──────────────────
const stepsRule: ProactiveRule = {
  id: "steps.behind_pace",
  category: "steps",
  priority: "medium",
  earliestLocalMin: HM(12),
  latestLocalMin: HM(19),
  cooldownHours: 4,
  evaluate(ctx) {
    if (!ctx.stepsGoal) return null;
    if (ctx.steps >= ctx.stepsGoal) return null;
    const frac = dayFraction(ctx.nowMin);
    const expected = ctx.stepsGoal * frac;
    if (ctx.steps >= expected * 0.7) return null; // roughly on pace
    const remaining = ctx.stepsGoal - ctx.steps;
    // Don't set an unrealistic catch-up ask: skip if the gap needs > ~6k more
    // than a normal remaining-day would deliver.
    const dayLeft = 1 - frac;
    if (remaining > ctx.stepsGoal * dayLeft + 6000) return null;
    return candidate(ctx, {
      id: "steps.behind_pace",
      category: "steps",
      priority: "medium",
      cooldownKey: "steps",
      title: "A walk would help your step goal",
      body: `You're at ${ctx.steps.toLocaleString()} of ${ctx.stepsGoal.toLocaleString()} steps. A 10–15 min walk now closes most of the gap before the day winds down.`,
      reason: `steps ${ctx.steps} vs expected ~${Math.round(expected)} (${Math.round(frac * 100)}% of day)`,
      sourceMetrics: { steps: ctx.steps, expected: Math.round(expected), goal: ctx.stepsGoal },
    });
  },
};

// ── Movement: long sedentary stretch in active hours, no recent workout ───────
const movementRule: ProactiveRule = {
  id: "movement.sedentary_afternoon",
  category: "movement",
  priority: "low",
  earliestLocalMin: HM(14),
  latestLocalMin: HM(18),
  cooldownHours: 4,
  evaluate(ctx) {
    // Suppress right after a workout.
    if (ctx.minsSinceWorkout != null && ctx.minsSinceWorkout < 120) return null;
    // Very low active-zone minutes by mid-afternoon suggests a sedentary day.
    if (ctx.activeZoneMinutes >= 15) return null;
    if (ctx.steps >= ctx.stepsGoal * 0.5) return null; // already moving plenty
    return candidate(ctx, {
      id: "movement.sedentary_afternoon",
      category: "movement",
      priority: "low",
      cooldownKey: "movement",
      title: "Stand up and move for a bit",
      body: `Quiet day so far (${ctx.activeZoneMinutes} active-zone min). A few minutes on your feet — a short walk or some stretches — breaks up the sitting.`,
      reason: `azm ${ctx.activeZoneMinutes}, steps ${ctx.steps}, minsSinceWorkout ${ctx.minsSinceWorkout ?? "n/a"}`,
      sourceMetrics: { activeZoneMinutes: ctx.activeZoneMinutes, steps: ctx.steps },
    });
  },
};

// ── Wind-down: gentle nudge ~1h before usual bedtime ──────────────────────────
const windDownRule: ProactiveRule = {
  id: "sleep.wind_down",
  category: "sleep",
  priority: "low",
  earliestLocalMin: 0, // gated dynamically against bedtime below
  latestLocalMin: 24 * 60,
  cooldownHours: 12,
  evaluate(ctx) {
    const start = ctx.bedtimeMin - 75;
    const end = ctx.bedtimeMin - 15;
    if (ctx.nowMin < start || ctx.nowMin > end) return null;
    return candidate(ctx, {
      id: "sleep.wind_down",
      category: "sleep",
      priority: "low",
      cooldownKey: "sleep",
      expiresInMin: 60,
      title: "Time to start winding down",
      body: `Your usual bedtime is around ${String(Math.floor(ctx.bedtimeMin / 60)).padStart(2, "0")}:${String(ctx.bedtimeMin % 60).padStart(2, "0")}. Dimming screens and lights now helps you fall asleep more easily.`,
      reason: `now ${ctx.nowMin}min, bedtime ${ctx.bedtimeMin}min`,
      sourceMetrics: { nowMin: ctx.nowMin, bedtimeMin: ctx.bedtimeMin },
    });
  },
};

// ── Habits: coach-visible boost habit still unlogged in the evening ───────────
const habitsRule: ProactiveRule = {
  id: "habits.unlogged_evening",
  category: "habits",
  priority: "low",
  earliestLocalMin: HM(18),
  latestLocalMin: HM(21),
  cooldownHours: 12,
  evaluate(ctx) {
    if (!ctx.pendingHabits.length) return null;
    const names = ctx.pendingHabits.slice(0, 2).map((h) => h.name);
    const more = ctx.pendingHabits.length - names.length;
    const list = names.join(" and ") + (more > 0 ? ` (+${more} more)` : "");
    return candidate(ctx, {
      id: "habits.unlogged_evening",
      category: "habits",
      priority: "low",
      cooldownKey: "habits",
      title: "A habit or two left for today",
      body: `You haven't logged ${list} yet. A good moment to finish the day strong — or just log it if you already did.`,
      reason: `pending habits: ${ctx.pendingHabits.map((h) => h.id).join(", ")}`,
      sourceMetrics: { pendingCount: ctx.pendingHabits.length },
    });
  },
};

export const RULES: ProactiveRule[] = [waterRule, stepsRule, movementRule, windDownRule, habitsRule];
