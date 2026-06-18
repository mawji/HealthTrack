// Deterministic gate for Daily inline insights.
//
// The gate runs BEFORE any model call: for each section it decides whether
// today deviates meaningfully from the user's baseline / target. Only the
// sections that pass are sent to the LLM for phrasing, so a calm day produces
// no insights and we don't waste tokens or clutter the page. The thresholds
// here are the tunable "what counts as meaningful" knobs.
//
// See plans/daily-trends-ai-suggestions.md.

import { APP_TZ } from "./store";
import { computeReadiness } from "./readiness";
import { DaySummary, InsightSection, ReadinessScore, HabitKind } from "./types";

export interface GateResult {
  section: InsightSection;
  metric: string; // the concrete figure the advice must be grounded in
  context: string; // compact data block for the prompt
}

export interface DailyInsightData {
  readiness: ReadinessScore | null;
  gates: GateResult[];
}

// Waking-hours model used to judge time-of-day pace (steps, water): goal is
// expected to accrue between 07:00 and 22:00 local.
const DAY_START_MIN = 7 * 60;
const DAY_END_MIN = 22 * 60;

function tzNowMinutes(now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Fraction (0-1) of the waking day elapsed — how much of a daily goal is "due". */
function dayProgress(now: Date): number {
  const m = tzNowMinutes(now);
  return Math.max(0, Math.min(1, (m - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)));
}

/**
 * Run every section's deterministic check. `history` is prior days (today
 * excluded) for baselines; `today` is the live current day; `waterMl` is
 * today's logged water (null if unknown).
 */
export function gateDaily(
  today: DaySummary,
  history: DaySummary[],
  waterMl: number | null,
  todaysWorkouts: number,
  now = new Date()
): DailyInsightData {
  const frac = dayProgress(now);
  const gates: GateResult[] = [];

  // ── Movement: steps vs time-of-day pace, plus active-zone minutes ──
  if (today.stepsGoal > 0) {
    const expected = today.stepsGoal * frac;
    if (frac > 0.15 && today.steps < 0.7 * expected) {
      const behind = Math.round(expected - today.steps);
      gates.push({
        section: "movement",
        metric: `${today.steps} steps, ~${behind} behind pace for a ${today.stepsGoal} goal`,
        context:
          `Steps so far: ${today.steps} of ${today.stepsGoal} goal (about ${Math.round(frac * 100)}% of the day elapsed, ` +
          `~${Math.round(expected)} expected by now). Active-zone minutes: ${today.activeZoneMinutes}/${today.azmGoal}. ` +
          `Workouts logged today: ${todaysWorkouts}.`,
      });
    } else if (today.steps >= today.stepsGoal && frac < 0.7) {
      gates.push({
        section: "movement",
        metric: `${today.steps} steps — goal already met`,
        context: `Steps ${today.steps} already past the ${today.stepsGoal} goal with the day only ${Math.round(frac * 100)}% done.`,
      });
    }
  }

  // ── Readiness: derived score; surface a snippet only on a real signal ──
  const readiness = computeReadiness(today, history);
  if (readiness && (readiness.band === "low" || readiness.band === "high" || readiness.reasons.length > 0)) {
    gates.push({
      section: "readiness",
      metric: readiness.metric,
      context:
        `Readiness ${readiness.score}/100 (${readiness.band}). ` +
        (readiness.reasons.length ? `Drivers: ${readiness.reasons.join("; ")}.` : "") +
        `${readiness.confident ? "" : " (baseline still building — fewer than ~14 days of history)"}`,
    });
  }

  // ── Hydration: water vs time-of-day pace toward a 2 L day ──
  if (waterMl != null) {
    const target = 2000;
    const expected = target * frac;
    if (frac > 0.2 && waterMl < 0.6 * expected) {
      const behindGlasses = Math.max(1, Math.round((expected - waterMl) / 250));
      gates.push({
        section: "hydration",
        metric: `${(waterMl / 1000).toFixed(2)}L logged, ~${behindGlasses} glasses behind a 2L day`,
        context: `Water today: ${waterMl} ml of a 2000 ml target, with ~${Math.round(frac * 100)}% of the day elapsed (~${Math.round(expected)} ml expected by now).`,
      });
    }
  }

  // ── Sleep: last night vs targets ──
  if (today.sleep) {
    const s = today.sleep;
    const deepPct = s.durationMin > 0 ? (s.stages.deep / s.durationMin) * 100 : 0;
    const poor = s.durationMin < 378 || s.efficiency < 85 || deepPct < 10;
    if (poor) {
      gates.push({
        section: "sleep",
        metric: `${(s.durationMin / 60).toFixed(1)}h, ${s.efficiency}% efficiency, deep ${Math.round(deepPct)}%`,
        context:
          `Last night: ${(s.durationMin / 60).toFixed(1)}h total (target ~7h), efficiency ${s.efficiency}% (target >85%), ` +
          `deep ${s.stages.deep}m (${Math.round(deepPct)}%, target 10–20%), REM ${s.stages.rem}m.`,
      });
    }
  }

  // ── Nutrition: energy balance (only when food is logged) ──
  if (today.caloriesIn > 0) {
    const balance = today.caloriesIn - today.caloriesOut;
    const bigSurplus = frac > 0.5 && balance > 500;
    const bigDeficit = frac > 0.5 && balance < -700;
    if (bigSurplus || bigDeficit) {
      gates.push({
        section: "nutrition",
        metric: `${today.caloriesIn} in vs ${today.caloriesOut} out (${balance > 0 ? "+" : ""}${balance} kcal)`,
        context: `Energy today: ${today.caloriesIn} kcal in, ${today.caloriesOut} kcal out, net ${balance > 0 ? "+" : ""}${balance} kcal, with ~${Math.round(frac * 100)}% of the day elapsed.`,
      });
    }
  }

  return { readiness, gates };
}

/** Compact per-habit snapshot the habits gate reasons over. */
export interface HabitGateInput {
  name: string;
  kind: HabitKind;
  completed: boolean;
  value: number | boolean | null;
  streak: number;
  targetLabel: string;
}

/**
 * Habits gate: surface a note when an avoid-limit is exceeded, a boost streak
 * is at risk of breaking, or the day is well along with habits still open.
 * Calm/early days produce nothing.
 */
export function gateHabits(habits: HabitGateInput[], now = new Date()): GateResult | null {
  if (!habits.length) return null;
  const frac = dayProgress(now);
  const doneCount = habits.filter((h) => h.completed).length;
  const exceeded = habits.filter((h) => h.kind === "avoid" && !h.completed && h.value !== null);
  const incompleteBoost = habits.filter((h) => h.kind === "boost" && !h.completed);
  const atRisk = incompleteBoost.filter((h) => h.streak >= 2).sort((a, b) => b.streak - a.streak);

  const fire =
    exceeded.length > 0 ||
    (frac > 0.4 && atRisk.length > 0) ||
    (frac > 0.6 && incompleteBoost.length > 0);
  if (!fire) return null;

  let metric: string;
  if (exceeded.length) metric = `${exceeded[0].name} past its ${exceeded[0].targetLabel} limit today`;
  else if (atRisk.length) metric = `${atRisk[0].name} ${atRisk[0].streak}-day streak not logged yet`;
  else metric = `${doneCount} of ${habits.length} daily habits done`;

  const context =
    `Daily habits (${doneCount}/${habits.length} complete, ~${Math.round(frac * 100)}% of day elapsed): ` +
    habits
      .map((h) => {
        const v = h.value === null ? "not logged" : typeof h.value === "boolean" ? (h.value ? "yes" : "no") : String(h.value);
        const state = h.completed ? "ok" : h.kind === "avoid" ? "over limit" : "incomplete";
        return `${h.name} [${h.kind}, target ${h.targetLabel}, ${v}, ${state}, streak ${h.streak}]`;
      })
      .join("; ") +
    ".";
  return { section: "habits", metric, context };
}

/** Tight, research-bounded prompt for ONLY the sections that passed the gate. */
export function buildInsightPrompt(gates: GateResult[]): string {
  const blocks = gates
    .map((g) => `### ${g.section}\nKey figure: ${g.metric}\nData: ${g.context}`)
    .join("\n\n");

  return `You are the in-app health coach writing ultra-short inline notes for TODAY's dashboard.
For each section below, write ONE short coaching sentence (max ~140 characters).

HARD RULES:
- Cite a specific number from that section's data (a deviation vs the user's baseline/target).
- Be actionable today and concrete (what to do now or by when). No education, no platitudes
  ("stay hydrated", "get good sleep" are banned).
- If the data does not actually warrant advice, return an empty string for that section's text.
- No medical claims or diagnosis. Warm, encouraging, never preachy.
- Plain text only, no markdown, no emoji.

Reply with ONLY this JSON (no code fences):
{"sections":[{"section":"<one of the section names below>","text":"<one sentence or empty string>"}]}

SECTIONS:
${blocks}`;
}
