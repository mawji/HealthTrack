// Canonical exercise-type catalog. Source of truth: the Google Health API v4
// discovery doc (schemas.Exercise.properties.exerciseType, 182 values). Used
// for the type picker's search menu and to validate logged/overridden types.

export type WorkoutType = { type: string; label: string };

// Full enum minus EXERCISE_TYPE_UNSPECIFIED. Order matches the discovery doc.
export const ALL_EXERCISE_TYPES: string[] = [
  "AEROBIC_WORKOUT","ARCHERY","ASSAULT_BIKE","BACKPACKING","BADMINTON","BALLET",
  "BALLROOM_DANCE","BARRE_CLASS","BASEBALL","BASKETBALL","BIKING","BILLIARDS",
  "BODY_WEIGHT","BOOTCAMP","BOWLING","BOXING","BREAKDANCING","CALISTHENICS",
  "CANOEING","CARDIO_SCULPT","CARDIO_WORKOUT","CARPENTRY","CHEERLEADING",
  "CIRCUIT_TRAINING","CLEANING","CLIMBING","CORE_TRAINING","CRICKET","CROQUET",
  "CROSS_COUNTRY_SKI","CROSS_TRAINING","CROSSFIT","CURLING","DANCING","DIVING",
  "ELECTRIC_BIKE","ELECTRIC_SCOOTER","ELLIPTICAL","EQUESTRIAN_SPORTS",
  "EXERCISE_CLASS","FENCING","FIELD_HOCKEY","FISHING","FITNESS_GAMING","FOILING",
  "FOOTBALL_AMERICAN","FOOTBALL_AUSTRALIAN","FREE_WEIGHTS","FRISBEE_PLAYING_GENERAL",
  "FUNCTIONAL_STRENGTH_TRAINING","GARDENING","GOLF","GYMNASTICS","HANDBALL",
  "HAND_CYCLING","HIIT","HIKING","HIP_HOP","HOCKEY","HOEING","HOUSEHOLD_CHORES",
  "HUNTING","ICE_SKATING","INCLINE_RUN","INCLINE_WALK","INDOOR_CLIMBING",
  "INTERVAL_WORKOUT","JAZZ_DANCE","JIU_JITSU","JUMPING_ROPE","KARATE","KAYAKING",
  "KICKBOXING","KITESURFING","LACROSSE","MARTIAL_ARTS","MEDITATE","MODERN_DANCE",
  "MOTOCROSS","MOTORCYCLE","MOUNTAIN_BIKE","MOWING_LAWN","MUAY_THAI","MULTISPORT",
  "MUSICAL_PERFORMANCE","NORDIC_WALKING","ORIENTEERING","OTHER","OUTDOOR_BIKE",
  "OUTDOOR_WORKOUT","PADDLEBOARDING","PADEL","PAINTING","PARAGLIDING","PARKOUR",
  "PICKELBALL","PILATES","POLO","POWERLIFTING","POWER_WALKING","RACKET_SPORTS",
  "RACQUETBALL","RESISTANCE_BANDS","ROCK_CLIMBING","ROLLERBLADING","ROLLER_SKATING",
  "ROWING","ROWING_MACHINE","RUCKING","RUGBY","RUNNING","SAILING","SCOOTERING",
  "SCUBA_DIVING","SHOOTING","SHOVELING","SKATEBOARDING","SKATING","SKIING",
  "SKYDIVING","SNORKELING","SNOWBOARDING","SNOWMOBILING","SNOWSHOEING","SNOW_SPORT",
  "SOCCER","SOFTBALL","SPEED_SKATING","SPINNING","SPORT","SQUASH","STAIRCLIMBER",
  "STATIONARY_BIKE","STEP_TRAINING","STRENGTH_TRAINING","STRETCHING","STROLLER_WALK",
  "SURFING","SWIMMING","SWIMMING_OPEN_WATER","SWIMMING_POOL","SYNCHRONIZED_SWIMMING",
  "TABATA_WORKOUT","TABLE_TENNIS","TAEKWONDO","TAI_CHI","TANGO","TENNIS",
  "TRACK_AND_FIELD","TRAIL_RUN","TRAMPOLINE","TREADMILL","TREADMILL_WALK","TRX",
  "ULTIMATE_FRISBEE","UNICYCLING","VOLLEYBALL","VOLLEYBALL_BEACH","WAKEBOARDING",
  "WALKING","WALK_WITH_WEIGHTS","WATER_AEROBICS","WATER_JOGGING","WATER_POLO",
  "WATER_SKIING","WATER_SPORT","WATER_VOLLEYBALL","WEEDING","WEIGHTLIFTING",
  "WEIGHT_MACHINES","WEIGHTS","WHEELCHAIR","WINDSURFING","WORKOUT","WRESTLING",
  "YOGA","YOGA_BIKRAM","YOGA_HATHA","YOGA_POWER","YOGA_VINYASA","ZUMBA",
];

export const EXERCISE_TYPE_SET: ReadonlySet<string> = new Set(ALL_EXERCISE_TYPES);

// Short, friendly labels for the most common types; everything else is
// title-cased from its enum value.
const LABELS: Record<string, string> = {
  WALKING: "Walk",
  RUNNING: "Run",
  STRENGTH_TRAINING: "Weights",
  BIKING: "Bike",
  SWIMMING_POOL: "Swim",
  HIIT: "HIIT",
  YOGA: "Yoga",
  WORKOUT: "Other",
};

/** Seed quick-pick chips, shown until usage frequency takes over. */
export const DEFAULT_QUICK_TYPES: WorkoutType[] = [
  { label: "Walk", type: "WALKING" },
  { label: "Run", type: "RUNNING" },
  { label: "Weights", type: "STRENGTH_TRAINING" },
  { label: "HIIT", type: "HIIT" },
  { label: "Yoga", type: "YOGA" },
  { label: "Bike", type: "BIKING" },
  { label: "Swim", type: "SWIMMING_POOL" },
];

export function titleCaseType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Display label for any exercise type — friendly where we have one, else humanized. */
export function labelForType(type: string): string {
  return LABELS[type] ?? titleCaseType(type);
}

/** Filter a catalog by query against both label and enum value. Empty query
 *  returns the list unchanged. */
export function filterTypes(list: WorkoutType[], query: string): WorkoutType[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (t) => t.label.toLowerCase().includes(q) || t.type.toLowerCase().includes(q.replace(/\s+/g, "_"))
  );
}

/** Filter the bundled snapshot — used as the picker's fallback before/if the
 *  live catalog is unavailable. */
export function searchExerciseTypes(query: string): WorkoutType[] {
  return filterTypes(ALL_EXERCISE_TYPES.map((type) => ({ type, label: labelForType(type) })), query);
}
