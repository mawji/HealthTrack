import { NextRequest, NextResponse } from "next/server";
import { getDay, getRecentDays, getTrends } from "@/lib/context";
import { getRemoteMealsRange } from "@/lib/remote-food";
import { getArchivedNutrition, upsertNutrition, isSettledDate, getArchivedWorkouts } from "@/lib/archive";
import { isConnected, fetchWorkouts } from "@/lib/googlehealth";
import { demoTrends, demoWorkouts } from "@/lib/demo";
import { readJson, localDateStr } from "@/lib/store";
import { FoodEntry, HealthPayload, TrendPoint, TrendsPayload, WaterEntry, WorkoutSession } from "@/lib/types";

function dateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return localDateStr(d);
}

/** Step a yyyy-MM-dd civil date by n days (noon-anchored to dodge DST). */
function addDaysStr(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Field = "p" | "c" | "f" | "gl";
type DayTotals = { p: number | null; c: number | null; f: number | null; gl: number | null };

function addTo(map: Map<string, DayTotals>, key: string, field: Field, v: number | null | undefined) {
  if (v == null) return;
  const t = map.get(key) ?? { p: null, c: null, f: null, gl: null };
  t[field] = (t[field] ?? 0) + v;
  map.set(key, t);
}
function foldMeal(map: Map<string, DayTotals>, key: string, m: { proteinG?: number | null; carbsG?: number | null; fatG?: number | null; glycemicLoad?: number | null }) {
  addTo(map, key, "p", m.proteinG);
  addTo(map, key, "c", m.carbsG);
  addTo(map, key, "f", m.fatG);
  addTo(map, key, "gl", m.glycemicLoad);
}
function foldTotals(map: Map<string, DayTotals>, key: string, t: DayTotals) {
  addTo(map, key, "p", t.p);
  addTo(map, key, "c", t.c);
  addTo(map, key, "f", t.f);
  addTo(map, key, "gl", t.gl);
}

/**
 * Daily macro + glycemic-load totals, combining app-logged meals (food-log.json)
 * with meals synced back from Google Health — the same set shown in the food
 * log. Each macro stays null until a meal that day actually carries it, so days
 * with no data (or meals lacking macros) become gaps rather than zeros.
 *
 * Local-log macros are cheap and always recomputed live. Synced (remote) meals
 * cost a Google Health fetch + AI GL estimation, so settled days are cached in
 * the archive (nutrition_days): we read those and fetch only the unsettled tail.
 */
async function nutritionSeries(days: number): Promise<Pick<TrendsPayload, "proteinG" | "carbsG" | "fatG" | "glycemicLoad">> {
  const foods = readJson<FoodEntry[]>("food-log.json", []);
  const totals = new Map<string, DayTotals>();
  for (const f of foods) foldMeal(totals, localDateStr(new Date(f.loggedAt)), f);

  if (isConnected()) {
    const end = dateKey(0);
    const start = dateKey(days - 1);
    // Settled days come straight from the archive (synced-meal totals, deduped
    // against the local log when they were stored).
    const archived = getArchivedNutrition(start, end);
    for (const [date, t] of archived) foldTotals(totals, date, t);

    // Live window: from the first date not yet covered by a settled archive row
    // through today. After backfill this is just the unsettled tail (~4 days).
    let liveStart = end;
    for (let d = start; d <= end; d = addDaysStr(d, 1)) {
      if (!(archived.has(d) && isSettledDate(d))) {
        liveStart = d;
        break;
      }
      liveStart = addDaysStr(d, 1);
    }

    if (liveStart <= end) {
      try {
        const remote = await getRemoteMealsRange(foods, liveStart, end);
        const live = new Map<string, DayTotals>();
        for (const r of remote) foldMeal(live, localDateStr(new Date(r.at)), r);
        for (let d = liveStart; d <= end; d = addDaysStr(d, 1)) {
          const t = live.get(d);
          if (t) foldTotals(totals, d, t);
          // Persist newly-settled days (even empty ones) so we never refetch them.
          if (isSettledDate(d)) upsertNutrition(d, t ?? { p: null, c: null, f: null, gl: null });
        }
      } catch (e) {
        console.error("Remote nutrition fetch failed:", e);
      }
    }
  }

  const series = (field: Field): TrendPoint[] => {
    const pts: TrendPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = dateKey(i);
      pts.push({ date, value: totals.get(date)?.[field] ?? null });
    }
    return pts;
  };
  return {
    proteinG: series("p"),
    carbsG: series("c"),
    fatG: series("f"),
    glycemicLoad: series("gl"),
  };
}

/** Fill a trailing-day series (oldest→newest) from a date→value map. */
function fillSeries(days: number, byDate: Map<string, number>): TrendPoint[] {
  const pts: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dateKey(i);
    pts.push({ date, value: byDate.get(date) ?? null });
  }
  return pts;
}

/**
 * Daily hydration totals (ml) from the local water log — app-logged glasses are
 * stored locally with their ml regardless of Google Health sync, so summing the
 * log gives a complete app-logged series with no per-day remote fetches.
 */
function waterSeries(days: number): Pick<TrendsPayload, "water"> {
  const byDate = new Map<string, number>();
  for (const e of readJson<WaterEntry[]>("water-log.json", [])) {
    const d = localDateStr(new Date(e.at));
    byDate.set(d, (byDate.get(d) ?? 0) + e.ml);
  }
  return { water: fillSeries(days, byDate) };
}

/**
 * Logged workout minutes per day, combining the local journal, settled archived
 * workouts, and a live fetch of the unsettled tail (same archive/live split as
 * nutrition). Deduped by googleName so synced sessions aren't counted twice.
 */
async function workoutSeries(days: number): Promise<Pick<TrendsPayload, "workoutMin">> {
  const end = dateKey(0);
  const start = dateKey(days - 1);

  const sessions: WorkoutSession[] = readJson<WorkoutSession[]>("workout-journal.json", []).filter(
    (w) => w.date >= start && w.date <= end
  );
  const seen = new Set(sessions.map((w) => w.googleName).filter(Boolean));
  const add = (list: WorkoutSession[]) => {
    for (const w of list) {
      if (w.googleName && seen.has(w.googleName)) continue;
      if (w.googleName) seen.add(w.googleName);
      sessions.push(w);
    }
  };

  if (isConnected()) {
    add(getArchivedWorkouts(start, end));
    // Live window: from the first unsettled day in range through today.
    let tailStart: string | null = null;
    for (let d = start; d <= end; d = addDaysStr(d, 1)) {
      if (!isSettledDate(d)) {
        tailStart = d;
        break;
      }
    }
    if (tailStart) {
      try {
        add(await fetchWorkouts(tailStart, end));
      } catch (e) {
        console.error("Workout trend fetch failed:", e);
      }
    }
  } else {
    add(demoWorkouts(days));
  }

  const byDate = new Map<string, number>();
  for (const w of sessions) {
    if (w.date < start || w.date > end) continue;
    byDate.set(w.date, (byDate.get(w.date) ?? 0) + (w.durationMin || 0));
  }
  return { workoutMin: fillSeries(days, byDate) };
}

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") ?? "today";

  if (view === "trends") {
    const days = Math.min(Number(req.nextUrl.searchParams.get("days") ?? 30), 365);
    let trends: TrendsPayload | null = null;
    try {
      trends = await getTrends(days);
    } catch (e) {
      console.error("Trends fetch failed, serving demo:", e);
    }
    // Nutrition series come from the local food log, so they apply to the
    // demo payload too — logged meals are real either way.
    return NextResponse.json({
      ...(trends ?? demoTrends(days)),
      ...(await nutritionSeries(days)),
      ...waterSeries(days),
      ...(await workoutSeries(days)),
    });
  }

  // Default: the requested day (today if unspecified) + last 7 days.
  const todayKey = dateKey(0);
  const reqDate = req.nextUrl.searchParams.get("date");
  const date =
    reqDate && /^\d{4}-\d{2}-\d{2}$/.test(reqDate) && reqDate <= todayKey ? reqDate : todayKey;

  const [{ day: today, demo }, { days: week }] = await Promise.all([
    getDay(date),
    getRecentDays(7),
  ]);

  // Local food log supplements caloriesIn when the API has nothing yet.
  const foods = readJson<FoodEntry[]>("food-log.json", []);
  const todayLocal = foods
    .filter((f) => f.loggedAt.slice(0, 10) === today.date)
    .reduce((sum, f) => sum + f.calories, 0);
  if (todayLocal > today.caloriesIn) today.caloriesIn = todayLocal;

  const payload: HealthPayload = { demo, connected: !demo, today, week };
  return NextResponse.json(payload);
}
