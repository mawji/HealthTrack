// Builds the deterministic "how is today going" snapshot the rules evaluate.
// Reads the SAME sources the Daily view uses — never a separate query path.

import { getRecentDays } from "@/lib/context";
import { isConnected, fetchWaterTotal } from "@/lib/googlehealth";
import { readJson, localDateStr, APP_TZ } from "@/lib/store";
import { WaterEntry, WorkoutSession } from "@/lib/types";
import { ProactiveContext, ProactivePreferences } from "@/lib/proactive/types";
import { WATER_TARGET_ML } from "@/lib/daily-insights";
import { getHabitDefinitions, getHabitRecords, computeHabitStatus } from "@/lib/habits";

/** Minutes since local midnight in APP_TZ. */
export function nowLocalMin(d = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: APP_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return (h % 24) * 60 + m;
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
}

/** Today's water in ml, mirroring /api/water's total(): synced API total +
 *  unsynced local entries, falling back to the local log when disconnected. */
async function waterTodayMl(date: string): Promise<number | null> {
  const all = readJson<WaterEntry[]>("water-log.json", []);
  const today = all.filter((e) => localDateStr(new Date(e.at)) === date);
  const unsynced = today.filter((e) => !e.googleName).reduce((a, e) => a + e.ml, 0);
  if (isConnected()) {
    const remote = await fetchWaterTotal(date).catch(() => null);
    if (remote !== null) return remote + unsynced;
  }
  if (!today.length) return null;
  return today.reduce((a, e) => a + e.ml, 0);
}

/** Minutes since the most recent workout ended today, from the local journal. */
function minsSinceWorkoutToday(date: string, nowMin: number): number | null {
  const journal = readJson<WorkoutSession[]>("workout-journal.json", []);
  const today = journal.filter((w) => w.date === date && w.startTime);
  let latestEnd = -1;
  for (const w of today) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(w.startTime);
    if (!m) continue;
    const end = Number(m[1]) * 60 + Number(m[2]) + (w.durationMin || 0);
    if (end > latestEnd) latestEnd = end;
  }
  return latestEnd < 0 ? null : Math.max(0, nowMin - latestEnd);
}

/** Coach-visible boost habits not yet completed today — the app's own habit
 *  definitions drive this, so nudges track exactly the habits the user set. */
function pendingHabitsToday(date: string): { id: string; name: string }[] {
  const records = getHabitRecords();
  return getHabitDefinitions()
    .filter((h) => h.active && h.coachVisible && h.kind === "boost")
    .filter((h) => !computeHabitStatus(h, records, date, date).completed)
    .map((h) => ({ id: h.id, name: h.name }));
}

export async function buildProactiveContext(prefs: ProactivePreferences): Promise<ProactiveContext> {
  const date = localDateStr();
  const nowMin = nowLocalMin();
  const { days } = await getRecentDays(2);
  const today = days[days.length - 1];

  return {
    date,
    nowMin,
    isToday: today?.date === date,
    steps: today?.steps ?? 0,
    stepsGoal: today?.stepsGoal || 10000,
    activeZoneMinutes: today?.activeZoneMinutes ?? 0,
    waterMl: await waterTodayMl(date),
    waterGoalMl: WATER_TARGET_ML,
    minsSinceWorkout: minsSinceWorkoutToday(date, nowMin),
    bedtimeMin: prefs.usualBedtimeMin,
    pendingHabits: pendingHabitsToday(date),
  };
}
