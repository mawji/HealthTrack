import { ALL_EXERCISE_TYPES, labelForType, WorkoutType } from "./workout-types";

// The exercise-type enum lives in the Google Health discovery doc and Google
// keeps adding to it. Fetch it live (cached 24h) so the picker's search menu
// stays current, falling back to the bundled snapshot on any failure.
const DISCOVERY = "https://health.googleapis.com/$discovery/rest?version=v4";
const TTL_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; types: string[] } | null = null;

export async function fetchExerciseTypes(): Promise<WorkoutType[]> {
  let types: string[] | null = cache && Date.now() - cache.at < TTL_MS ? cache.types : null;
  if (!types) {
    try {
      const res = await fetch(DISCOVERY);
      if (res.ok) {
        const doc = await res.json();
        const vals: string[] = doc?.schemas?.Exercise?.properties?.exerciseType?.enum ?? [];
        const clean = vals.filter((t) => t && t !== "EXERCISE_TYPE_UNSPECIFIED");
        if (clean.length) {
          cache = { at: Date.now(), types: clean };
          types = clean;
        }
      }
    } catch {
      /* fall through to bundled snapshot */
    }
  }
  return (types ?? ALL_EXERCISE_TYPES).map((type) => ({ type, label: labelForType(type) }));
}
