// The data a shared contact's reply can draw from, built ONCE from the same
// sources the app's own views read. Scope resolvers (lib/telegram/scopes.ts)
// format slices of this; the choke point decides which slices a contact may see.
// Nothing here is contact-specific — filtering happens after, never before.

import { getRecentDays, readinessForDate } from "@/lib/context";
import { isConnected, fetchWaterTotal, fetchWorkouts } from "@/lib/googlehealth";
import { recentMeasurements } from "@/lib/measurements";
import { readJson, localDateStr } from "@/lib/store";
import { DaySummary, WorkoutSession, Measurement, ReadinessScore, WaterEntry } from "@/lib/types";
import { WATER_TARGET_ML } from "@/lib/daily-insights";

export interface ShareData {
  today: DaySummary | null;
  week: DaySummary[];
  readiness: ReadinessScore | null;
  workouts: WorkoutSession[]; // last 7 days, newest first
  waterMl: number | null;
  waterGoalMl: number;
  bp: Measurement | null;
  glucose: Measurement | null;
  weight: Measurement | null;
  demo: boolean;
}

async function waterTodayMl(date: string): Promise<number | null> {
  const all = readJson<WaterEntry[]>("water-log.json", []);
  const today = all.filter((e) => localDateStr(new Date(e.at)) === date);
  const unsynced = today.filter((e) => !e.googleName).reduce((a, e) => a + e.ml, 0);
  if (isConnected()) {
    const remote = await fetchWaterTotal(date).catch(() => null);
    if (remote !== null) return remote + unsynced;
  }
  return today.length ? today.reduce((a, e) => a + e.ml, 0) : null;
}

async function recentWorkouts(): Promise<WorkoutSession[]> {
  const start = localDateStr(new Date(Date.now() - 7 * 86400000));
  const end = localDateStr();
  try {
    const journal = readJson<WorkoutSession[]>("workout-journal.json", []);
    const remote = isConnected() ? await fetchWorkouts(start, end).catch(() => []) : [];
    const names = new Set(journal.map((w) => w.googleName).filter(Boolean));
    return [...journal.filter((w) => w.date >= start), ...remote.filter((w) => !names.has(w.googleName))]
      .sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));
  } catch {
    return [];
  }
}

export async function buildShareData(): Promise<ShareData> {
  const date = localDateStr();
  const { days, demo } = await getRecentDays(7);
  const measurements = recentMeasurements({ limit: 50 });
  const firstOf = (kind: Measurement["kind"]) => measurements.find((m) => m.kind === kind) ?? null;

  return {
    today: days[days.length - 1] ?? null,
    week: days,
    readiness: await readinessForDate().catch(() => null),
    workouts: await recentWorkouts(),
    waterMl: await waterTodayMl(date),
    waterGoalMl: WATER_TARGET_ML,
    bp: firstOf("blood-pressure"),
    glucose: firstOf("glucose"),
    weight: firstOf("weight"),
    demo,
  };
}
