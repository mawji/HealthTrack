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
import { reconcilePlans } from "@/lib/training-plan";
import { DEFAULT_QUICK_TYPES, labelForType, WorkoutType } from "@/lib/workout-types";
import { sanitizeDetail } from "@/lib/workout-detail";
import {
  sessionsOverlap,
  readMerges,
  applyMerges,
  annotateSuggestions,
  addMerge,
  removeMerge,
  findAttachTarget,
} from "@/lib/workout-merge";

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

// ── live-session ↔ watch reconciliation ─────────────────────────────────────
// (overlap primitives + source-agnostic merge helpers live in lib/workout-merge.)

/** Link app sessions awaiting a watch match to the overlapping watch session:
 *  adopt its googleName + metrics onto our detail-rich journal entry and claim
 *  the remote index. Mutates journal entries (shared with the persisted list);
 *  returns true if anything was adopted. */
function reconcileJournal(journal: WorkoutSession[], remote: WorkoutSession[], claimed: Set<number>): boolean {
  let changed = false;
  for (const j of journal) {
    if (!j.awaitingWatchMatch || j.googleName) continue;
    const idx = remote.findIndex((r, i) => !claimed.has(i) && r.googleName && sessionsOverlap(j, r));
    if (idx === -1) continue;
    const r = remote[idx];
    claimed.add(idx);
    j.googleName = r.googleName;
    j.syncedToHealth = true;
    j.awaitingWatchMatch = false;
    if (j.calories == null) j.calories = r.calories;
    if (j.avgHr == null) j.avgHr = r.avgHr;
    changed = true;
  }
  return changed;
}

export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get("days") ?? 7), 31);
  const end = localDateStr();
  const start = addDays(end, -(days - 1));

  const allJournal = readJson<WorkoutSession[]>(JOURNAL, []);
  const journal = allJournal.filter((w) => w.date >= start && w.date <= end);

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

  // Reconcile app-logged sessions (no googleName — e.g. finished in-app and
  // "also tracked on the watch") against the watch session that later syncs:
  // match by date + compatible type + overlapping interval (±30 min tolerance
  // for start drift), then ADOPT the watch session's googleName + metrics onto
  // our (detail-rich) journal entry so it shows as one workout. Adoptions are
  // persisted so it's a one-time link per session.
  const claimed = new Set<number>();
  if (!demo) {
    const persisted = reconcileJournal(journal, remote, claimed);
    if (persisted) writeJson(JOURNAL, allJournal); // journal rows are shared with allJournal by reference
  }

  // Journal entries that synced come back from the API too — prefer the journal
  // copy (it has notes/detail) and drop the API duplicate (by googleName or the
  // overlap match above).
  const journalGoogleNames = new Set(journal.map((w) => w.googleName).filter(Boolean));
  const merged = [
    ...journal,
    ...remote.filter((w, i) => !claimed.has(i) && !journalGoogleNames.has(w.googleName)),
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

  // Source-agnostic merging: fold stored merges into their umbrella (largest
  // window wins; members contribute exercise detail, not double-counted metrics),
  // then suggest merging any remaining overlapping same-day sessions.
  const foldedSessions = annotateSuggestions(applyMerges(sessions, readMerges()));

  // Auto-complete planned workouts that actually happened (app or watch),
  // matched by date + compatible type. Uses the post-override types.
  if (!demo) reconcilePlans(foldedSessions.map((w) => ({ id: w.id, date: w.date, exerciseType: w.exerciseType })));

  return NextResponse.json({ demo, range: { start, end }, sessions: foldedSessions, quickTypes: computeQuickTypes() });
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

  // Structured exercises may arrive as detail.exercises (web detail form) or as a
  // top-level exercises array (coach shortcut) — fold the latter into a detail blob.
  const detail = sanitizeDetail(
    body.detail ?? (Array.isArray(body.exercises) ? { exercises: body.exercises } : undefined)
  );
  if (detail) entry.detail = detail;

  // Attach-at-log-time: when the coach logs specific exercises (e.g. "squats
  // 3×15") during an existing same-day workout of a compatible type, fold them
  // into that session instead of spawning a new card — so multiple voice logs
  // across one session coalesce into one workout. Only for exercise-shaped logs
  // (it carries exercises) that aren't watch-deferred. No Google call: exercise
  // detail is app-local and never synced.
  if (detail?.exercises?.length && !body.skipGoogleSync) {
    const journal = readJson<WorkoutSession[]>(JOURNAL, []);
    const target = findAttachTarget(journal, entry);
    if (target) {
      target.detail = {
        ...(target.detail ?? {}),
        exercises: [...(target.detail?.exercises ?? []), ...detail.exercises],
      };
      writeJson(JOURNAL, journal);
      const details = readJson<Record<string, WorkoutDetail>>(DETAIL, {});
      details[target.id] = target.detail;
      writeJson(DETAIL, details);
      return NextResponse.json({ ...target, attachedTo: target.id });
    }
  }

  // skipGoogleSync: set when finishing a live session the user also tracked on
  // their watch — we hold off writing to Google and let the GET reconciliation
  // link this journal entry to the watch session once it syncs (no duplicate).
  if (isConnected() && !body.skipGoogleSync) {
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
  } else if (isConnected() && body.skipGoogleSync) {
    // Deferred: the user also tracked this on their watch — flag it so the GET
    // reconciliation links it to the watch session once that syncs.
    entry.awaitingWatchMatch = true;
  }

  if (detail) {
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

  // Source-agnostic merge: fold the chosen members into an umbrella session, or
  // undo it. Non-destructive — only the link store changes; the GET handler
  // re-derives the merged view, so unmerge brings the members back.
  if (body.action === "mergeSessions") {
    const umbrellaId = String(body.umbrellaId ?? "");
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    if (!umbrellaId || !memberIds.length) return NextResponse.json({ error: "bad merge" }, { status: 400 });
    addMerge(umbrellaId, memberIds);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "unmergeSession") {
    const target = String(body.id ?? "");
    if (!target) return NextResponse.json({ error: "missing id" }, { status: 400 });
    removeMerge(target);
    return NextResponse.json({ ok: true });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  // Manual resolution for a deferred ("awaiting watch match") journal session.
  if (body.action === "pushToGoogle" || body.action === "linkGoogle") {
    const journal = readJson<WorkoutSession[]>(JOURNAL, []);
    const entry = journal.find((w) => w.id === id);
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (body.action === "pushToGoogle") {
      // The watch session never came (or it wasn't tracked there) — write ours now.
      if (isConnected() && !entry.googleName) {
        const googleName = await logExerciseToGoogleHealth({
          name: entry.name,
          exerciseType: entry.exerciseType,
          start: civilToDate(entry.date, entry.startTime),
          durationMin: entry.durationMin,
          calories: entry.calories,
          notes: entry.notes,
        });
        if (googleName !== null) {
          entry.syncedToHealth = true;
          entry.googleName = googleName || undefined;
        }
        if (isSettledDate(entry.date)) await refreshArchivedDay(entry.date);
      }
      entry.awaitingWatchMatch = false;
    } else {
      // linkGoogle: manually adopt a chosen watch session ("these are the same").
      entry.googleName = String(body.googleName ?? "") || entry.googleName;
      entry.syncedToHealth = true;
      entry.awaitingWatchMatch = false;
      if (entry.calories == null && body.calories != null) entry.calories = Math.round(Number(body.calories));
      if (entry.avgHr == null && body.avgHr != null) entry.avgHr = Math.round(Number(body.avgHr));
    }
    writeJson(JOURNAL, journal);
    return NextResponse.json(entry);
  }

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
