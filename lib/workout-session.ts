// In-progress "live" workout session (at most one at a time), persisted to
// data/workout-session.json so it survives a page reload/resume. The session is
// a complement to the watch: a timer + in-session exercise/set logging. On
// finish the UI writes a completed workout through /api/workouts (honoring the
// "also tracked on your watch?" answer) — this module just owns the in-progress
// state. See plans/live-workout-session.md + the reconciliation in /api/workouts.

import { readJson, writeJson, newId } from "./store";
import { normalizeExerciseType } from "./googlehealth";
import { sanitizeExercises } from "./workout-detail";
import { WorkoutExercise } from "./types";

const SESSION = "workout-session.json";

export interface ActiveSession {
  id: string;
  name: string;
  exerciseType: string;
  startedAt: string; // ISO
  pausedMs: number; // accumulated paused time (ms)
  pauseStartedAt?: string; // ISO; set while paused
  exercises: WorkoutExercise[];
  planItemId?: string; // when started from a planned workout
}

export function getActiveSession(): ActiveSession | null {
  return readJson<ActiveSession | null>(SESSION, null);
}

function save(s: ActiveSession | null) {
  writeJson(SESSION, s);
}

/** Start a session, or return the existing one if one is already in progress. */
export function startSession(input: Record<string, unknown>): ActiveSession {
  const existing = getActiveSession();
  if (existing) return existing;
  const exerciseType = normalizeExerciseType(String(input.exerciseType ?? input.name ?? "workout"));
  const s: ActiveSession = {
    id: newId(),
    name: String(input.name ?? exerciseType.replace(/_/g, " ").toLowerCase()).slice(0, 80),
    exerciseType,
    startedAt: new Date().toISOString(),
    pausedMs: 0,
    exercises: sanitizeExercises(input.exercises) ?? [],
    planItemId: typeof input.planItemId === "string" ? input.planItemId : undefined,
  };
  save(s);
  return s;
}

/** Apply a patch to the active session: exercises, name, or pause/resume. */
export function patchSession(patch: Record<string, unknown>): ActiveSession | null {
  const s = getActiveSession();
  if (!s) return null;

  if (patch.action === "pause" && !s.pauseStartedAt) {
    s.pauseStartedAt = new Date().toISOString();
  } else if (patch.action === "resume" && s.pauseStartedAt) {
    s.pausedMs += Date.now() - new Date(s.pauseStartedAt).getTime();
    s.pauseStartedAt = undefined;
  }
  if (patch.name != null) s.name = String(patch.name).slice(0, 80);
  if (patch.exerciseType != null) s.exerciseType = normalizeExerciseType(String(patch.exerciseType));
  if ("exercises" in patch) s.exercises = sanitizeExercises(patch.exercises) ?? [];

  save(s);
  return s;
}

export function discardSession(): void {
  save(null);
}

/** Elapsed active milliseconds (excludes paused time). */
export function elapsedMs(s: ActiveSession, now = Date.now()): number {
  const paused = s.pausedMs + (s.pauseStartedAt ? now - new Date(s.pauseStartedAt).getTime() : 0);
  return Math.max(0, now - new Date(s.startedAt).getTime() - paused);
}
