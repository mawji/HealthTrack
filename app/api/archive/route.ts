import { NextRequest, NextResponse } from "next/server";
import {
  archiveCoverage,
  getBackfillState,
  setBackfillState,
  upsertDay,
  isSettledDate,
  SETTLE_AFTER_DAYS,
} from "@/lib/archive";
import { refreshArchivedDay } from "@/lib/context";
import {
  isConnected,
  fetchDays,
  fetchHeartIntraday,
  fetchWorkouts,
  fetchWaterByDay,
} from "@/lib/googlehealth";
import { localDateStr } from "@/lib/store";

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days per backfill batch — small enough that one POST stays responsive. */
const BATCH_DAYS = 30;
const BACKFILL_YEARS_DAYS = 365;

function progress() {
  const state = getBackfillState();
  const coverage = archiveCoverage();
  let pct: number | null = null;
  if (state) {
    const total = daysBetween(state.target, addDays(localDateStr(), -SETTLE_AFTER_DAYS));
    const remaining = state.cursor >= state.target ? daysBetween(state.target, state.cursor) : 0;
    pct = total > 0 ? Math.round(((total - remaining) / total) * 100) : 100;
  }
  return { connected: isConnected(), coverage, backfill: state ? { ...state, pct } : null };
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000) + 1;
}

export async function GET() {
  return NextResponse.json(progress());
}

/**
 * POST { action: "backfill" }  — start (or continue) the 1-year backfill;
 *   processes one batch per call so the client loops until done: true.
 * POST { action: "resync", date } — re-pull one archived day from the API.
 */
export async function POST(req: NextRequest) {
  if (!isConnected()) {
    return NextResponse.json({ error: "Google Health not connected" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));

  if (body.action === "resync") {
    const date = String(body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const ok = await refreshArchivedDay(date);
    return NextResponse.json({ ok });
  }

  if (body.action !== "backfill") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const newestSettled = addDays(localDateStr(), -SETTLE_AFTER_DAYS);
  let state = getBackfillState();
  if (!state || state.cursor < state.target) {
    state = {
      target: addDays(localDateStr(), -BACKFILL_YEARS_DAYS),
      cursor: newestSettled,
      startedAt: new Date().toISOString(),
    };
    setBackfillState(state);
  }

  // One batch, walking backward from the cursor.
  const batchEnd = state.cursor;
  const batchStart = addDays(batchEnd, -(BATCH_DAYS - 1)) > state.target
    ? addDays(batchEnd, -(BATCH_DAYS - 1))
    : state.target;

  const [days, workouts, water] = await Promise.all([
    fetchDays(batchStart, batchEnd),
    // Deep paging: old workouts sit far down the newest-first list.
    fetchWorkouts(batchStart, batchEnd, 40).catch(() => [] as Awaited<ReturnType<typeof fetchWorkouts>>),
    fetchWaterByDay(batchStart, batchEnd).catch(() => new Map<string, number>()),
  ]);

  const workoutsByDate = new Map<string, typeof workouts>();
  for (const w of workouts) {
    if (!workoutsByDate.has(w.date)) workoutsByDate.set(w.date, []);
    workoutsByDate.get(w.date)!.push(w);
  }

  // Intraday HR is one API call per day — fetch in small parallel chunks so a
  // 30-day batch stays well-behaved.
  const settledDays = days.filter((d) => isSettledDate(d.date));
  for (let i = 0; i < settledDays.length; i += 10) {
    await Promise.all(
      settledDays.slice(i, i + 10).map(async (day) => {
        day.heartIntraday = await fetchHeartIntraday(day.date).catch(() => []);
      })
    );
  }

  for (const day of settledDays) {
    upsertDay(day.date, {
      summary: day,
      workouts: workoutsByDate.get(day.date) ?? [],
      waterMl: water.get(day.date) ?? 0,
      settled: true,
    });
  }

  const nextCursor = addDays(batchStart, -1);
  const done = nextCursor < state.target;
  setBackfillState({ ...state, cursor: nextCursor });

  return NextResponse.json({ done, batch: { start: batchStart, end: batchEnd }, ...progress() });
}
