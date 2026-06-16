// Helpers for the app-local WorkoutDetail blob: validate untrusted input on the
// way in, and render a compact one-line summary for the coach context and UI.
// The detail blob never syncs to Google Health — it lives only in the local
// workout-detail.json side-store, keyed by session id.

import { WorkoutDetail } from "./types";

export const INTENSITIES = ["easy", "moderate", "hard"] as const;
export type Intensity = (typeof INTENSITIES)[number];

const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
};

const posInt = (v: unknown, max: number): number | undefined => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : undefined;
};

const posNum = (v: unknown, max: number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 10) / 10, max) : undefined;
};

/** True when a detail blob carries no usable information. */
export function detailIsEmpty(d: WorkoutDetail | undefined): boolean {
  if (!d) return true;
  return (
    !d.intensity &&
    d.effort == null &&
    !d.soreness &&
    !d.injury &&
    !(d.exercises && d.exercises.length)
  );
}

/** Clamp and validate untrusted detail input. Returns undefined when empty so
 *  callers can clear the side-store entry rather than storing a blank object. */
export function sanitizeDetail(raw: unknown): WorkoutDetail | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const intensity = INTENSITIES.includes(r.intensity as Intensity)
    ? (r.intensity as Intensity)
    : undefined;

  let effort: number | undefined;
  const e = Math.round(Number(r.effort));
  if (Number.isFinite(e) && e >= 1 && e <= 10) effort = e;

  const exercises = Array.isArray(r.exercises)
    ? r.exercises
        .slice(0, 30)
        .map((x) => {
          const ex = (x ?? {}) as Record<string, unknown>;
          const name = str(ex.name, 80);
          if (!name) return null;
          return {
            name,
            sets: posInt(ex.sets, 99),
            reps: posInt(ex.reps, 999),
            weightKg: posNum(ex.weightKg, 1000),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : undefined;

  const out: WorkoutDetail = {
    intensity,
    effort,
    soreness: str(r.soreness),
    injury: str(r.injury),
    exercises: exercises && exercises.length ? exercises : undefined,
  };
  return detailIsEmpty(out) ? undefined : out;
}

function fmtExercise(ex: NonNullable<WorkoutDetail["exercises"]>[number]): string {
  let s = ex.name;
  if (ex.sets && ex.reps) s += ` ${ex.sets}×${ex.reps}`;
  else if (ex.reps) s += ` ${ex.reps} reps`;
  else if (ex.sets) s += ` ${ex.sets} sets`;
  if (ex.weightKg) s += ` @${ex.weightKg}kg`;
  return s;
}

/** Compact one-line summary, e.g. "RPE 8/10 · hard · sore: quads · ex: Squat 5×5
 *  @100kg, Bench 3×8". Used by the coach context and the history rows. */
export function formatDetail(d: WorkoutDetail | undefined): string {
  if (detailIsEmpty(d)) return "";
  const parts: string[] = [];
  if (d!.effort != null) parts.push(`RPE ${d!.effort}/10`);
  if (d!.intensity) parts.push(d!.intensity);
  if (d!.soreness) parts.push(`sore: ${d!.soreness}`);
  if (d!.injury) parts.push(`injury: ${d!.injury}`);
  if (d!.exercises?.length) {
    parts.push(`ex: ${d!.exercises.slice(0, 8).map(fmtExercise).join(", ")}`);
  }
  return parts.join(" · ");
}
