// The multi-window deterministic digest — the free pre-pass that gates the whole
// background-intelligence pipeline. It rolls the same structured stores the app
// already keeps (DaySummary history, workouts, habits, measurements, lab
// records) into day / 7d / 30d / 90d aggregates and emits conservative signals.
//
// Crucially, a CALM / under-target stretch is itself a signal here (low movement,
// missed goals, sparse logging) — absence of activity affects goals adversely, so
// the reflection always has something to reason about, not just deviations.
//
// Pure compute (computeDigest) is separated from data gathering (buildDigestData)
// so it stays trivially testable. No AI, no network beyond the shared day fetch.
// See plans/coach-background-intelligence.md.

import { getRecentDays } from "@/lib/context";
import { readJson } from "@/lib/store";
import { recentMeasurements } from "@/lib/measurements";
import { getHabitDefinitions, getHabitRecords } from "@/lib/habits";
import { collectDerivedCandidates } from "@/lib/memory-watchers";
import { DaySummary, HabitDefinition, HabitRecord, WorkoutSession } from "@/lib/types";

export type DigestArea =
  | "movement"
  | "sleep"
  | "workouts"
  | "nutrition"
  | "habits"
  | "cardiometabolic"
  | "weight";

export type DigestWindow = "today" | "7d" | "30d" | "90d";
export type Severity = "info" | "watch" | "flag";

export interface DigestSignal {
  area: DigestArea;
  window: DigestWindow;
  severity: Severity;
  metric: string; // the concrete figure
  detail: string; // one plain sentence
}

export interface WindowStats {
  days: number; // days with data in the window
  avgSteps: number | null;
  stepsGoal: number | null;
  azmPerWeek: number | null;
  activeDays: number; // days with a workout or AZM >= 30
  avgSleepMin: number | null;
  shortNights: number; // nights < 6h
  foodLoggedDays: number;
}

export interface WellbeingDigest {
  generatedAt: string;
  date: string; // the latest day in range
  demo: boolean; // true when not connected (demo data) — don't draw conclusions
  windows: Record<"w7" | "w30", WindowStats>;
  signals: DigestSignal[]; // most notable first
}

export interface DigestData {
  days: DaySummary[]; // oldest first
  demo: boolean;
  habits: HabitDefinition[];
  habitRecords: HabitRecord[];
  workouts: WorkoutSession[];
  derived: { topic: string; text: string; confidence?: number }[];
}

// ── helpers ───────────────────────────────────────────────────────────────────
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function mean(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
/** The most recent positive step goal in the window (goals can be 0 on gaps). */
function latestGoal(days: DaySummary[]): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    if (finite(days[i].stepsGoal) && days[i].stepsGoal > 0) return days[i].stepsGoal;
  }
  return null;
}

function windowStats(days: DaySummary[], workouts: WorkoutSession[]): WindowStats {
  const stepVals = days.map((d) => d.steps).filter(finite);
  const goal = latestGoal(days);
  const azm = days.map((d) => d.activeZoneMinutes).filter(finite).reduce((a, b) => a + b, 0);
  const woDates = new Set(workouts.map((w) => w.date));
  const activeDays = days.filter((d) => woDates.has(d.date) || (finite(d.activeZoneMinutes) && d.activeZoneMinutes >= 30)).length;
  const sleepVals = days.map((d) => d.sleep?.durationMin).filter(finite);
  const shortNights = sleepVals.filter((m) => m < 360).length;
  const foodLoggedDays = days.filter((d) => finite(d.caloriesIn) && d.caloriesIn > 0).length;
  // azm per week, scaled to a 7-day rate from however many days we actually have
  const azmPerWeek = days.length ? Math.round((azm / days.length) * 7) : null;
  return {
    days: days.length,
    avgSteps: stepVals.length ? Math.round(mean(stepVals)!) : null,
    stepsGoal: goal,
    azmPerWeek,
    activeDays,
    avgSleepMin: sleepVals.length ? Math.round(mean(sleepVals)!) : null,
    shortNights,
    foodLoggedDays,
  };
}

/** 30-day adherence per coach-visible boost habit: completed days / 30. */
function habitAdherence(habits: HabitDefinition[], records: HabitRecord[], windowDates: Set<string>): { name: string; pct: number; kind: string }[] {
  const out: { name: string; pct: number; kind: string }[] = [];
  for (const h of habits) {
    if (!h.active || !h.coachVisible) continue;
    const recs = records.filter((r) => r.habitId === h.id && windowDates.has(r.date));
    const completed = recs.filter((r) => r.completed).length;
    const denom = Math.max(windowDates.size, 1);
    out.push({ name: h.name, pct: Math.round((completed / denom) * 100), kind: h.kind });
  }
  return out;
}

// ── pure compute ────────────────────────────────────────────────────────────
export function computeDigest(data: DigestData, now = new Date()): WellbeingDigest {
  const { days, workouts } = data;
  const date = days.length ? days[days.length - 1].date : now.toISOString().slice(0, 10);
  const last7 = days.slice(-7);
  const last30 = days.slice(-30);
  const w7 = windowStats(last7, workouts);
  const w30 = windowStats(last30, workouts);
  const signals: DigestSignal[] = [];

  if (data.demo) {
    return { generatedAt: now.toISOString(), date, demo: true, windows: { w7, w30 }, signals };
  }

  // ── Movement: under-target steps over the week (calm = signal) ──
  if (w7.avgSteps != null && w7.stepsGoal && w7.stepsGoal > 0) {
    const ratio = w7.avgSteps / w7.stepsGoal;
    if (ratio < 0.8) {
      signals.push({
        area: "movement", window: "7d",
        severity: ratio < 0.55 ? "flag" : "watch",
        metric: `${w7.avgSteps.toLocaleString()}/day vs ${w7.stepsGoal.toLocaleString()} goal (${Math.round(ratio * 100)}%)`,
        detail: `Daily steps averaged ${w7.avgSteps.toLocaleString()} this week, under the ${w7.stepsGoal.toLocaleString()} goal — a quieter, under-target stretch worth a closer look.`,
      });
    }
  }
  // ── Movement: weekly active-zone minutes vs ODPHP 150 ──
  if (w7.azmPerWeek != null && w7.azmPerWeek < 150) {
    signals.push({
      area: "movement", window: "7d",
      severity: w7.azmPerWeek < 75 ? "flag" : "watch",
      metric: `${w7.azmPerWeek} active-zone min/week vs 150`,
      detail: `Active-zone minutes ran about ${w7.azmPerWeek}/week, below the 150-minute guideline — moderate activity was light.`,
    });
  }
  // ── Sedentary streak: recent consecutive low-movement days ──
  {
    const goal = latestGoal(days) ?? 10000;
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      const lowSteps = finite(d.steps) && d.steps < goal * 0.4;
      const lowAzm = !finite(d.activeZoneMinutes) || d.activeZoneMinutes < 15;
      if (lowSteps && lowAzm) streak++;
      else break;
    }
    if (streak >= 3) {
      signals.push({
        area: "movement", window: "today",
        severity: streak >= 5 ? "flag" : "watch",
        metric: `${streak} low-movement days in a row`,
        detail: `The last ${streak} days have all been low-movement (well under the step goal, little active-zone time) — a sedentary run that drags on the activity goals.`,
      });
    }
  }

  // ── Sleep: short average / repeated short nights ──
  if (w7.avgSleepMin != null) {
    if (w7.avgSleepMin < 400 || w7.shortNights >= 2) {
      signals.push({
        area: "sleep", window: "7d",
        severity: w7.avgSleepMin < 360 || w7.shortNights >= 4 ? "flag" : "watch",
        metric: `${(w7.avgSleepMin / 60).toFixed(1)}h avg, ${w7.shortNights} night(s) < 6h`,
        detail: `Sleep averaged ${(w7.avgSleepMin / 60).toFixed(1)}h this week with ${w7.shortNights} night(s) under 6h — short of a ~7h target.`,
      });
    }
  }

  // ── Workouts / active days per week ──
  if (w7.days >= 4) {
    if (w7.activeDays < 3) {
      signals.push({
        area: "workouts", window: "7d",
        severity: w7.activeDays <= 1 ? "flag" : "watch",
        metric: `${w7.activeDays} active day(s) this week`,
        detail: `Only ${w7.activeDays} day(s) had a workout or meaningful active-zone time this week — consistency dipped.`,
      });
    }
  }

  // ── Nutrition: sparse food logging (a data-coverage signal, not a judgement) ──
  if (w7.days >= 4 && w7.foodLoggedDays <= 3) {
    signals.push({
      area: "nutrition", window: "7d",
      severity: "info",
      metric: `${w7.foodLoggedDays}/${w7.days} days with food logged`,
      detail: `Food was logged on only ${w7.foodLoggedDays} of ${w7.days} days — nutrition guidance is limited without more entries.`,
    });
  }

  // ── Habits: low 30-day adherence on a coach-visible boost habit ──
  {
    const windowDates = new Set(last30.map((d) => d.date));
    for (const a of habitAdherence(data.habits, data.habitRecords, windowDates)) {
      if (a.kind === "boost" && a.pct < 50) {
        signals.push({
          area: "habits", window: "30d",
          severity: a.pct < 25 ? "flag" : "watch",
          metric: `${a.name}: ${a.pct}% of days (30d)`,
          detail: `The "${a.name}" habit landed on about ${a.pct}% of days over the past month — slipping from a routine.`,
        });
      }
    }
  }

  // ── Cardiometabolic / weight: fold in the persistent-pattern watchers ──
  for (const c of data.derived) {
    const area: DigestArea = c.topic.startsWith("labs") || c.topic === "bp" ? "cardiometabolic" : c.topic === "weight" ? "weight" : "cardiometabolic";
    signals.push({
      area, window: "90d",
      severity: area === "cardiometabolic" ? "flag" : "watch",
      metric: c.topic,
      detail: c.text,
    });
  }

  // Most notable first: flag > watch > info.
  const rank: Record<Severity, number> = { flag: 0, watch: 1, info: 2 };
  signals.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return { generatedAt: now.toISOString(), date, demo: false, windows: { w7, w30 }, signals };
}

// ── data gathering (shares the app's normal read paths) ───────────────────────
export async function buildDigestData(): Promise<DigestData> {
  const { days, demo } = await getRecentDays(90);
  const workouts = readJson<WorkoutSession[]>("workout-journal.json", []);
  return {
    days,
    demo,
    habits: getHabitDefinitions(),
    habitRecords: getHabitRecords(),
    workouts,
    derived: collectDerivedCandidates(),
  };
}

/** Convenience: gather + compute in one call. */
export async function buildDigest(now = new Date()): Promise<WellbeingDigest> {
  return computeDigest(await buildDigestData(), now);
}
