import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson, newId, localDateStr } from "@/lib/store";
import {
  isConnected,
  fetchWorkouts,
  logExerciseToGoogleHealth,
  deleteDataPoint,
  normalizeExerciseType,
  civilToDate,
} from "@/lib/googlehealth";
import { demoWorkouts } from "@/lib/demo";
import { refreshArchivedDay } from "@/lib/context";
import { isSettledDate } from "@/lib/archive";
import { WorkoutSession } from "@/lib/types";

const JOURNAL = "workout-journal.json";

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get("days") ?? 7), 31);
  const end = localDateStr();
  const start = addDays(end, -(days - 1));

  const journal = readJson<WorkoutSession[]>(JOURNAL, []).filter(
    (w) => w.date >= start && w.date <= end
  );

  let remote: WorkoutSession[] = [];
  let demo = false;
  if (isConnected()) {
    try {
      remote = await fetchWorkouts(start, end);
    } catch (e) {
      console.error("Workout fetch failed:", e);
    }
  } else {
    remote = demoWorkouts(days);
    demo = true;
  }

  // Journal entries that synced come back from the API too — prefer the
  // journal copy (it has notes) and drop the API duplicate.
  const journalGoogleNames = new Set(journal.map((w) => w.googleName).filter(Boolean));
  const sessions = [
    ...journal,
    ...remote.filter((w) => !journalGoogleNames.has(w.googleName)),
  ].sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));

  return NextResponse.json({ demo, range: { start, end }, sessions });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const durationMin = Math.max(1, Math.round(Number(body.durationMin) || 30));
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : localDateStr();
  const startTime = typeof body.startTime === "string" && /^\d{2}:\d{2}$/.test(body.startTime)
    ? body.startTime
    : new Date(Date.now() - durationMin * 60000).toTimeString().slice(0, 5);
  const exerciseType = normalizeExerciseType(String(body.exerciseType ?? body.name ?? "workout"));
  const name = String(body.name ?? exerciseType.replace(/_/g, " ").toLowerCase());

  const entry: WorkoutSession = {
    id: newId(),
    source: "journal",
    name,
    exerciseType,
    date,
    startTime,
    durationMin,
    calories: body.calories ? Math.round(Number(body.calories)) : null,
    avgHr: null,
    distanceKm: body.distanceKm ? Number(body.distanceKm) : null,
    notes: body.notes ? String(body.notes) : undefined,
    syncedToHealth: false,
  };

  if (isConnected()) {
    const start = civilToDate(date, startTime);
    const googleName = await logExerciseToGoogleHealth({
      name: entry.name,
      exerciseType: entry.exerciseType,
      start,
      durationMin,
      calories: entry.calories,
      notes: entry.notes,
    });
    if (googleName !== null) {
      entry.syncedToHealth = true;
      entry.googleName = googleName || undefined;
    }
    // Backdated workouts can land on an archived (settled) day — keep the
    // local archive in step with what was just written to the API.
    if (isSettledDate(date)) await refreshArchivedDay(date);
  }

  const journal = readJson<WorkoutSession[]>(JOURNAL, []);
  journal.push(entry);
  writeJson(JOURNAL, journal);
  return NextResponse.json(entry);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const journal = readJson<WorkoutSession[]>(JOURNAL, []);
  const entry = journal.find((w) => w.id === id);
  if (entry?.googleName && isConnected()) {
    await deleteDataPoint("exercise", entry.googleName).catch(() => {});
    if (isSettledDate(entry.date)) await refreshArchivedDay(entry.date);
  }
  writeJson(
    JOURNAL,
    journal.filter((w) => w.id !== id)
  );
  return NextResponse.json({ ok: true });
}
