// MET-based calorie estimate for planned (not-yet-performed) workouts, where no
// device heart-rate data exists. kcal ≈ MET × weight(kg) × hours. MET values are
// representative figures from the Compendium of Physical Activities (Ainsworth
// et al.) — public reference data. This is a deliberately rough estimate for
// planning; real completed workouts use device calories when available.

const SOURCE = "Compendium of Physical Activities (MET)";

// Keyed by Google ExerciseType. Anything not listed falls back to DEFAULT_MET.
const MET_BY_TYPE: Record<string, number> = {
  WALKING: 3.5,
  POWER_WALKING: 4.5,
  NORDIC_WALKING: 4.8,
  HIKING: 6.0,
  RUNNING: 9.8,
  TRAIL_RUN: 9.0,
  TREADMILL: 8.0,
  BIKING: 7.5,
  STATIONARY_BIKE: 7.0,
  SPINNING: 8.5,
  ELLIPTICAL: 5.0,
  ROWING_MACHINE: 7.0,
  ROWING: 7.0,
  SWIMMING_POOL: 6.0,
  SWIMMING: 6.0,
  STRENGTH_TRAINING: 5.0,
  WEIGHTS: 5.0,
  WEIGHTLIFTING: 5.0,
  POWERLIFTING: 6.0,
  FUNCTIONAL_STRENGTH_TRAINING: 5.0,
  BODY_WEIGHT: 3.8,
  CALISTHENICS: 3.8,
  CORE_TRAINING: 3.8,
  CIRCUIT_TRAINING: 7.0,
  CROSSFIT: 8.0,
  HIIT: 8.0,
  TABATA_WORKOUT: 8.0,
  BOXING: 7.8,
  KICKBOXING: 7.8,
  MARTIAL_ARTS: 7.0,
  JUMPING_ROPE: 11.0,
  YOGA: 2.5,
  YOGA_POWER: 4.0,
  PILATES: 3.0,
  STRETCHING: 2.3,
  STAIRCLIMBER: 8.0,
  WORKOUT: 5.0,
};

export const DEFAULT_MET = 5.0;
const DEFAULT_WEIGHT_KG = 70; // used only when the profile has no weight

export function metForType(type: string): number {
  return MET_BY_TYPE[type] ?? DEFAULT_MET;
}

export interface BurnEstimate {
  calories: number;
  met: number;
  assumedWeight: boolean; // true when no real weight was available
  source: string;
}

/** Estimate calories for a planned workout from its type, duration, and weight. */
export function estimateBurn(type: string, durationMin: number, weightKg: number | null): BurnEstimate {
  const met = metForType(type);
  const assumedWeight = weightKg == null || weightKg <= 0;
  const kg = assumedWeight ? DEFAULT_WEIGHT_KG : weightKg!;
  const calories = Math.round((met * kg * Math.max(0, durationMin)) / 60);
  return { calories, met, assumedWeight, source: SOURCE };
}
