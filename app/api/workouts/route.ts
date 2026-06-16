import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson, newId, localDateStr } from "@/lib/store";
import {
  isConnected,
  fetchWorkouts,
  logExerciseToGoogleHealth,
  deleteDataPoint,
  normalizeExerciseType,
  updateExerciseType,
  civilToDate,
} from "@/lib/googlehealth";
import { demoWorkouts } from "@/lib/demo";
import { refreshArchivedDay } from "@/lib/context";
import { isSettledDate } from "@/lib/archive";
import { WorkoutSession, WorkoutDetail } from "@/lib/types";
import { DEFAULT_QUICK_TYPES, labelForType, WorkoutType } from "@/lib/workout-types";
import { sanitizeDetail } from "@/lib/workout-detail";

const JOURNAL = "workout-journal.json";
const OVERRIDES = "workout-overrides.json";
const DETAIL = "workout-detail.json";
const STATS = "workout-type-stats.json";

// Local relabels for sessions whose Google-reported type/name is wrong or
// generic. Keyed by session id (the dataPoint resource name for synced
// sessions). Applied on read so corrections survive every refetch.
type WorkoutOverride = { exerciseType: string; name?: string; synced?: boolean };

// Count every time a type is chosen (logged or relabeled) so the most-used
// types can surface as quick-pick chips, replacing the static defaults.
function bumpTypeStat(type: string) {
  const stats = readJson<Record<string, number>>(STATS, {});
  stats[type] = (stats[type] ?? 0) + 1;
  writeJson(STATS, stats);
}

// Quick-pick chips: most-used types first, padded with defaults to 7.
function computeQuickTypes(): WorkoutType[] {
  const stats = readJson<Record<string, number>>(STATS, {});
  const ranked = Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
  const picked: string[] = [];
  for (const t of [...ranked, ...DEFAULT_QUICK_TYPES.map((d) => d.type)]) {
    if (picked.length >= 7) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.map((type) => ({ type, label: labelForType(type) }));
}

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
  const merged = [
    ...journal,
    ...remote.filter((w) => !journalGoogleNames.has(w.googleName)),
  ].sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));

  const overrides = readJson<Record<string, WorkoutOverride>>(OVERRIDES, {});
  const details = readJson<Record<string, WorkoutDetail>>(DETAIL, {});
  const sessions = merged.map((w) => {
    const o = overrides[w.id];
    const d = details[w.id] ?? w.detail;
    const base = o
      ? { ...w, exerciseType: o.exerciseType, name: o.name ?? w.name, overridden: true, overrideSynced: !!o.synced }
      : w;
    return d ? { ...base, detail: d } : base;
  });

  return NextResponse.json({ demo, range: { start, end }, sessions, quickTypes: computeQuickTypes() });
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

  const detail = sanitizeDetail(body.detail);
  if (detail) {
    entry.detail = detail;
    const details = readJson<Record<string, WorkoutDetail>>(DETAIL, {});
    details[entry.id] = detail;
    writeJson(DETAIL, details);
  }

  const journal = readJson<WorkoutSession[]>(JOURNAL, []);
  journal.push(entry);
  writeJson(JOURNAL, journal);
  bumpTypeStat(exerciseType);
  return NextResponse.json(entry);
}

// Relabel a session's type/name locally (used to correct stale or generic
// Google-reported workout types). { id, exerciseType, name? } sets an override;
// { id, clear: true } reverts to whatever Google/journal reports.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  // Detail edits are independent of type relabels and apply to any session
  // (journal or Google-imported) — they only touch the local detail side-store.
  if ("detail" in body) {
    const details = readJson<Record<string, WorkoutDetail>>(DETAIL, {});
    const detail = sanitizeDetail(body.detail);
    if (detail) details[id] = detail;
    else delete details[id];
    writeJson(DETAIL, details);
    return NextResponse.json({ ok: true, detail: detail ?? null });
  }

  const overrides = readJson<Record<string, WorkoutOverride>>(OVERRIDES, {});
  if (body.clear) {
    delete overrides[id];
    writeJson(OVERRIDES, overrides);
    return NextResponse.json({ ok: true });
  }

  const exerciseType = normalizeExerciseType(String(body.exerciseType ?? body.name ?? "workout"));
  const name = body.name ? String(body.name) : undefined;

  // Try to write the corrected type back to Google — but only for sessions our
  // own client created (journal entries we synced). Google forbids editing data
  // points sourced from other clients (Fitbit, Google Fit, …) with
  // DATA_POINT_NOT_OWNED_BY_CLIENT, so for those we skip the call and rely on
  // the local override below.
  let synced = false;
  if (body.source === "journal" && typeof body.googleName === "string" && body.googleName && isConnected()) {
    synced = await updateExerciseType(body.googleName, exerciseType, name ?? exerciseType);
  }

  overrides[id] = { exerciseType, name, synced };
  bumpTypeStat(exerciseType);
  writeJson(OVERRIDES, overrides);
  return NextResponse.json({ ok: true, synced });
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
  if (id) {
    const details = readJson<Record<string, WorkoutDetail>>(DETAIL, {});
    if (details[id]) {
      delete details[id];
      writeJson(DETAIL, details);
    }
  }
  return NextResponse.json({ ok: true });
}
