// Workout reconciliation & merge primitives, shared by the workouts API route.
//
// Two related problems live here:
//  1. live-session ↔ watch reconciliation (the awaitingWatchMatch 1:1 link) —
//     the time/type overlap test used by the GET handler.
//  2. source-agnostic merging — folding several overlapping same-day sessions
//     (from any source: journal, Google app, coach voice logs) into one
//     "umbrella" workout, and suggesting such merges on read. The umbrella is
//     the largest-window session; members contribute their exercise detail, not
//     their metrics (those would double-count the same minutes).
//
// The merge links are stored in a tiny side-store keyed by session id
// (memberId → umbrellaId). Session ids are stable across reads for both sources
// (journal ids are persisted; Google ids are the dataPoint resource name), so
// the links survive re-fetches. Merging is non-destructive — unmerge just drops
// the link and the members reappear.

import { WorkoutSession, WorkoutExercise } from "./types";
import { readJson, writeJson } from "./store";

const MERGES = "workout-merges.json";

export const RECONCILE_TOL_MS = 30 * 60 * 1000; // start-time drift tolerance
export const GENERIC_TYPES = new Set([
  "WORKOUT",
  "OTHER",
  "AEROBIC_WORKOUT",
  "CARDIO_WORKOUT",
  "EXERCISE_CLASS",
  "OUTDOOR_WORKOUT",
]);

export function workoutRange(w: WorkoutSession): { s: number; e: number } {
  const s = Date.parse(`${w.date}T${w.startTime || "00:00"}:00`);
  return { s, e: s + (w.durationMin || 0) * 60000 };
}

/** Time windows of two same-day sessions intersect (or start within tolerance). */
export function timeOverlap(a: WorkoutSession, b: WorkoutSession): boolean {
  if (a.date !== b.date) return false;
  const ra = workoutRange(a);
  const rb = workoutRange(b);
  if (Number.isNaN(ra.s) || Number.isNaN(rb.s)) return false;
  return (ra.s < rb.e && rb.s < ra.e) || Math.abs(ra.s - rb.s) <= RECONCILE_TOL_MS;
}

/** timeOverlap PLUS a compatible-type gate (same type, or either side generic).
 *  Used for the conservative auto paths (watch reconcile, attach-at-log-time)
 *  where we act without asking — type compatibility avoids absorbing a run into
 *  a strength session. Suggestions use the looser timeOverlap (the user
 *  confirms those). */
export function sessionsOverlap(a: WorkoutSession, b: WorkoutSession): boolean {
  const typeOk =
    a.exerciseType === b.exerciseType ||
    GENERIC_TYPES.has(a.exerciseType) ||
    GENERIC_TYPES.has(b.exerciseType);
  if (!typeOk) return false;
  return timeOverlap(a, b);
}

// ── merge store ──────────────────────────────────────────────────────────────
export type MergeMap = Record<string, string>; // memberId → umbrellaId

export const readMerges = (): MergeMap => readJson<MergeMap>(MERGES, {});
export const writeMerges = (m: MergeMap): void => writeJson(MERGES, m);

/** Record memberIds as folded into umbrellaId (idempotent). */
export function addMerge(umbrellaId: string, memberIds: string[]): void {
  const m = readMerges();
  for (const id of memberIds) if (id && id !== umbrellaId) m[id] = umbrellaId;
  writeMerges(m);
}

/** Undo a merge: if `id` is a member, drop just that link; if it's an umbrella,
 *  drop every member folded into it. */
export function removeMerge(id: string): void {
  const m = readMerges();
  if (m[id]) delete m[id];
  else for (const k of Object.keys(m)) if (m[k] === id) delete m[k];
  writeMerges(m);
}

function brief(w: WorkoutSession) {
  return { id: w.id, name: w.name, exerciseType: w.exerciseType, startTime: w.startTime };
}

const maxOrNull = (xs: (number | null | undefined)[]): number | null => {
  const nums = xs.filter((n): n is number => typeof n === "number");
  return nums.length ? Math.max(...nums) : null;
};

/** Fold stored merges: enrich each umbrella with its members' exercise detail
 *  and drop the members from the list. Umbrella metrics win; calories/HR fall
 *  back to the richest member value only when the umbrella has none (never
 *  summed — members share the umbrella's window). Mutates the passed session
 *  objects (which are fresh per-read copies) and returns the surviving list. */
export function applyMerges(sessions: WorkoutSession[], merges: MergeMap): WorkoutSession[] {
  if (!Object.keys(merges).length) return sessions;
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const membersByUmbrella = new Map<string, WorkoutSession[]>();
  const removed = new Set<string>();

  for (const s of sessions) {
    const umbId = merges[s.id];
    if (umbId && umbId !== s.id && byId.has(umbId)) {
      const list = membersByUmbrella.get(umbId) ?? [];
      list.push(s);
      membersByUmbrella.set(umbId, list);
      removed.add(s.id);
    }
  }

  for (const [umbId, members] of membersByUmbrella) {
    const umb = byId.get(umbId)!;
    const exercises: WorkoutExercise[] = [
      ...(umb.detail?.exercises ?? []),
      ...members.flatMap((m) => m.detail?.exercises ?? []),
    ];
    if (exercises.length) umb.detail = { ...(umb.detail ?? {}), exercises };
    if (umb.calories == null) umb.calories = maxOrNull(members.map((m) => m.calories));
    if (umb.avgHr == null) umb.avgHr = maxOrNull(members.map((m) => m.avgHr));
    umb.mergedFrom = members.map(brief);
  }

  return sessions.filter((s) => !removed.has(s.id));
}

/** Annotate each umbrella with a merge suggestion for the unmerged sessions
 *  whose windows overlap it. Greedy per day: the longest session claims the
 *  overlapping ones as suggested members, so each session appears in at most one
 *  suggestion. Time-overlap only (the user confirms), no type gate. */
export function annotateSuggestions(sessions: WorkoutSession[]): WorkoutSession[] {
  const byDate = new Map<string, WorkoutSession[]>();
  for (const s of sessions) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  for (const day of byDate.values()) {
    const sorted = [...day].sort((a, b) => (b.durationMin || 0) - (a.durationMin || 0));
    const used = new Set<string>();
    for (const umb of sorted) {
      if (used.has(umb.id)) continue;
      const members = sorted.filter(
        (o) => o.id !== umb.id && !used.has(o.id) && timeOverlap(umb, o)
      );
      if (!members.length) continue;
      used.add(umb.id);
      members.forEach((m) => used.add(m.id));
      umb.mergeSuggestion = { umbrellaId: umb.id, members: members.map(brief) };
    }
  }
  return sessions;
}

/** Find an existing journal session a freshly logged exercise-set should attach
 *  to (attach-at-log-time): same day, compatible type, overlapping window. Picks
 *  the longest such session (the natural umbrella). Returns undefined when none
 *  fits — the caller then logs a standalone workout. */
export function findAttachTarget(
  journal: WorkoutSession[],
  entry: WorkoutSession
): WorkoutSession | undefined {
  return journal
    .filter((j) => j.id !== entry.id && sessionsOverlap(j, entry))
    .sort((a, b) => (b.durationMin || 0) - (a.durationMin || 0))[0];
}
