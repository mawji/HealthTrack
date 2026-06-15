import { NextRequest, NextResponse } from "next/server";
import { getDay, getRecentDays, getTrends } from "@/lib/context";
import { demoTrends } from "@/lib/demo";
import { readJson, localDateStr } from "@/lib/store";
import { FoodEntry, HealthPayload, TrendPoint, TrendsPayload } from "@/lib/types";

function dateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return localDateStr(d);
}

/**
 * Daily macro + glycemic-load totals from the local food log. The Google
 * Health rollup doesn't expose macro sums, so these series cover app-logged
 * meals only; days with nothing logged become gaps (null).
 */
function nutritionSeries(days: number): Pick<TrendsPayload, "proteinG" | "carbsG" | "fatG" | "glycemicLoad"> {
  const foods = readJson<FoodEntry[]>("food-log.json", []);
  type DayTotals = { p: number; c: number; f: number; gl: number | null };
  const totals = new Map<string, DayTotals>();
  for (const f of foods) {
    const key = localDateStr(new Date(f.loggedAt));
    const t = totals.get(key) ?? { p: 0, c: 0, f: 0, gl: null };
    t.p += f.proteinG;
    t.c += f.carbsG;
    t.f += f.fatG;
    // GL stays null until at least one entry that day carries an estimate
    // (entries logged before GL support don't have one).
    if (f.glycemicLoad != null) t.gl = (t.gl ?? 0) + f.glycemicLoad;
    totals.set(key, t);
  }
  const series = (get: (t: DayTotals) => number | null): TrendPoint[] => {
    const pts: TrendPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = dateKey(i);
      const t = totals.get(date);
      pts.push({ date, value: t ? get(t) : null });
    }
    return pts;
  };
  return {
    proteinG: series((t) => t.p),
    carbsG: series((t) => t.c),
    fatG: series((t) => t.f),
    glycemicLoad: series((t) => t.gl),
  };
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
    return NextResponse.json({ ...(trends ?? demoTrends(days)), ...nutritionSeries(days) });
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
