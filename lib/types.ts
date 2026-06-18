// Shared shapes passed between API routes and the UI.

export interface DaySummary {
  date: string; // yyyy-MM-dd
  steps: number;
  stepsGoal: number;
  caloriesOut: number;
  activeZoneMinutes: number;
  azmGoal: number;
  distanceKm: number;
  floors: number;
  restingHeartRate: number | null;
  heartIntraday: { time: string; bpm: number; min: number; max: number }[]; // per-interval range across the day
  heartZones: { name: string; minutes: number }[];
  sleep: SleepSummary | null;
  spo2: number | null; // avg %
  hrv: number | null; // daily RMSSD ms
  breathingRate: number | null; // breaths/min
  weightKg: number | null;
  caloriesIn: number; // from food log
}

export type SleepStageName = "wake" | "rem" | "light" | "deep";

export interface SleepSegment {
  stage: SleepStageName;
  startMin: number; // minutes since sleep start
  durMin: number;
}

export interface SleepSummary {
  durationMin: number;
  efficiency: number;
  startTime: string;
  endTime: string;
  stages: { deep: number; light: number; rem: number; wake: number }; // minutes
  segments?: SleepSegment[]; // stage timeline for the hypnogram
}

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface TrendsPayload {
  demo: boolean;
  range: { start: string; end: string };
  steps: TrendPoint[];
  restingHr: TrendPoint[];
  sleepMin: TrendPoint[];
  weightKg: TrendPoint[];
  caloriesOut: TrendPoint[];
  caloriesIn: TrendPoint[];
  hrv: TrendPoint[];
  spo2: TrendPoint[];
  azm: TrendPoint[]; // active zone minutes ≈ daily cardio load
  // Merged in by the health route (not the base trends builders), like the
  // nutrition series below: water from the local hydration log, workoutMin
  // (logged training minutes/day) from the archive + journal + live tail.
  water?: TrendPoint[]; // ml/day
  workoutMin?: TrendPoint[]; // logged workout minutes/day
  // Daily nutrition totals from the local food log (app-logged meals only —
  // the Google Health rollup doesn't expose macro sums). Merged in by the
  // health route, so the base trends builders don't populate them.
  proteinG?: TrendPoint[];
  carbsG?: TrendPoint[];
  fatG?: TrendPoint[];
  glycemicLoad?: TrendPoint[];
}

export interface HealthPayload {
  demo: boolean;
  connected: boolean;
  today: DaySummary;
  week: DaySummary[]; // last 7 days, oldest first
}

export type MealType = "breakfast" | "lunch" | "dinner" | "other";

export interface FoodEntry {
  id: string;
  loggedAt: string; // ISO
  mealType?: MealType; // absent on entries logged before meal-type support
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  glycemicLoad?: number; // AI-estimated; absent on entries logged before GL support
  confidence: "low" | "medium" | "high";
  notes?: string;
  photo?: string; // small data-URL thumbnail of the analyzed photo
  syncedToHealth: boolean; // written back to Google Health
  googleName?: string | null; // dataPoint resource name when synced — provenance key
}

export interface FoodAnalysis {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  glycemicLoad: number;
  confidence: "low" | "medium" | "high";
  notes: string;
}

export type LabFlag = "normal" | "high" | "low" | "abnormal" | "critical";

export interface LabMetric {
  key: string; // canonical slug stable across reports, e.g. "ldl-cholesterol"
  name: string; // display name as printed on the report
  panel: string; // report section, e.g. "Lipid Panel"
  value: number | null; // numeric value when parseable
  valueText: string; // raw printed value (covers qualitative results)
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  refText: string; // reference range as printed
  flag: LabFlag;
}

export interface MedicalRecord {
  id: string;
  uploadedAt: string;
  filename: string;
  mimeType: string;
  summary: string; // AI-generated summary used as coach context
  textExcerpt: string; // first chunk of extracted text
  docType?: string | null; // e.g. "Lab report — General Chemistry"
  labName?: string | null;
  reportDate?: string | null; // yyyy-MM-dd specimen collection date
  metrics?: LabMetric[]; // structured results extracted from the document
}

/** App-local structured training detail. NOT synced to Google Health (the API
 *  has no field for it). Stored in a side-store keyed by session id and merged
 *  on read, same as the type-override store. */
export interface WorkoutDetail {
  intensity?: "easy" | "moderate" | "hard";
  effort?: number; // RPE 1-10, subjective
  soreness?: string;
  injury?: string;
  exercises?: { name: string; sets?: number; reps?: number; weightKg?: number }[];
}

export interface WorkoutSession {
  id: string;
  source: "google" | "journal";
  name: string;
  exerciseType: string; // Google Health ExerciseType enum value
  date: string; // yyyy-MM-dd in APP_TZ
  startTime: string; // HH:MM
  durationMin: number;
  calories: number | null;
  avgHr: number | null;
  distanceKm: number | null;
  notes?: string;
  detail?: WorkoutDetail; // app-local structured detail, merged on read
  syncedToHealth: boolean;
  googleName?: string; // dataPoint resource name when synced
  overridden?: boolean; // type/name was relabeled locally (Google's value is stale)
  overrideSynced?: boolean; // the relabel was also written back to Google
}

export interface WaterEntry {
  id: string;
  at: string; // ISO
  ml: number;
  googleName?: string; // set when the API accepted the log
}

export interface RemoteFoodEntry {
  name: string;
  calories: number;
  at: string; // ISO
  mealType?: string;
  // Present when the originating app wrote macros to the data point.
  // Google Health has no glycemic load field, so GL stays app-local.
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  glycemicLoad?: number | null; // AI-estimated from name+macros (cached server-side)
  googleName?: string; // dataPoint resource name — matches FoodEntry.googleName
}

// ── Configurable habits ───────────────────────────────────────────────────
// User-defined boost ("do more") and avoid ("stay within a limit") habits,
// tracked daily with streaks. First-class behavior data, stored locally under
// data/habits.json + data/habit-records.json. See plans/configurable-habits.md.

export type HabitKind = "boost" | "avoid";
export type HabitTargetType = "yes_no" | "count" | "duration" | "quantity";
export type HabitGoalMode = "at_least" | "at_most" | "between" | "exactly" | "none";

export interface HabitDefinition {
  id: string;
  name: string;
  description?: string;
  iconKey: string; // stable key into the controlled habit-icon registry
  color?: string; // css var token, e.g. "var(--activity)"
  kind: HabitKind;
  targetType: HabitTargetType;
  goalMode: HabitGoalMode;
  unit?: string; // cups, minutes, pages, grams, …
  targetMin?: number; // used by at_least / between / exactly
  targetMax?: number; // used by at_most / between
  defaultValue?: number; // pre-fill / quick-add step for numeric habits
  active: boolean;
  showOnDaily: boolean;
  coachVisible: boolean;
  nudgeEnabled: boolean; // reserved for the future proactive-guidance system
  sortOrder?: number; // manual display order (drag-to-reorder on Daily)
  createdAt: string;
  updatedAt: string;
}

export interface HabitRecord {
  id: string;
  habitId: string;
  date: string; // yyyy-MM-dd in APP_TZ
  // For yes_no this is a boolean meaning "the tracked behavior occurred today"
  // (good for boost, the thing-to-avoid for avoid). Numeric types store a number.
  value: boolean | number;
  note?: string;
  completed: boolean; // cached at write time; recomputed on read
  createdAt: string;
  updatedAt: string;
}

export interface HabitComputedStatus {
  habitId: string;
  date: string;
  completed: boolean;
  value: boolean | number | null; // null when nothing logged for the date
  streak: number; // consecutive completed days ending at date
  bestStreak: number; // longest completed run across all history
  missedToday: boolean; // date is today, not yet completed
}

export interface HabitsPayload {
  date: string;
  habits: HabitDefinition[];
  records: HabitRecord[]; // records for the requested date
  status: HabitComputedStatus[];
}

// ── Goals (macro health targets) ───────────────────────────────────────────
// A small, curated set of macro health targets the user steers toward. Lab-backed
// goals reuse the canonical lab keys from lib/labs.ts so they line up with the
// trended Records value; device goals read DaySummary fields. Status/progress are
// computed deterministically in lib/goals.ts — the AI only explains them.
// See plans/goals-menu.md. (Google Health weight write-back + height/BMI are a
// later phase per the plan's build order.)

export type GoalSource = "lab" | "device";
export type GoalDirection = "lower_is_better" | "higher_is_better" | "target_range";

export interface GoalDefinition {
  id: string;
  // For source "lab": a canonical key from lib/labs.ts (e.g. "ldl-cholesterol").
  // For "device": a fixed DaySummary field key (see DEVICE_METRICS in lib/goals.ts).
  metricKey: string;
  source: GoalSource;
  label: string;
  iconKey: string; // stable key into the controlled icon registry (components/icons.tsx)
  direction: GoalDirection;
  unit: string;
  // Targets, semantics by direction:
  //  lower_is_better  -> met when value <= targetMax
  //  higher_is_better -> met when value >= targetMin
  //  target_range     -> met when targetMin <= value <= targetMax
  targetMin?: number;
  targetMax?: number;
  tolerancePct?: number; // soft band for on-track vs needs-attention; default 0.1
  active: boolean;
  showOnDaily: boolean;
  showOnTrends: boolean;
  coachVisible: boolean;
  isDefault: boolean; // seeded from the macro set (so defaults can be upgraded)
  note?: string; // user's own note, e.g. "doctor wants this under 2.0"
  createdAt: string;
  updatedAt: string;
}

export type GoalStatus = "met" | "on_track" | "needs_attention" | "no_data";

export interface GoalProgress {
  goalId: string;
  metricKey: string;
  status: GoalStatus;
  latestValue: number | null;
  latestDate: string | null; // yyyy-MM-dd of the value used
  target: { min?: number; max?: number };
  direction: GoalDirection;
  unit: string;
  progress: number | null; // 0..1 for the bar, clamped; meaning depends on direction
  delta: number | null; // signed gap to target in metric units
}

export interface GoalsPayload {
  goals: GoalDefinition[];
  progress: GoalProgress[]; // one per active goal, deterministically computed
  demo: boolean; // device values are demo (Google Health not connected)
}

// ── Manual measurements (the "+ Log" quick-entry) ──────────────────────────
// Values the user logs by hand from the global "+ Log" sheet. Activity/food/
// hydration route to their existing flows; these kinds are simple values stored
// locally in data/measurements.json. Google Health write-back (where the v4 API
// exposes a writeonly path) is wired separately and guarded by granted scopes.

export type MeasurementKind = "weight" | "glucose" | "body-temp" | "body-fat" | "sleep";

export interface Measurement {
  id: string;
  kind: MeasurementKind;
  at: string; // ISO timestamp of the reading
  value: number; // primary value: kg | glucose | °C/°F | % | sleep minutes
  unit: string; // display unit, e.g. "kg", "mmol/L", "°C", "%", "min"
  context?: string; // glucose timing: fasting | random | post_meal | pre_meal
  startTime?: string; // sleep: HH:MM
  endTime?: string; // sleep: HH:MM
  note?: string;
  syncedToHealth: boolean; // written back to Google Health
  googleName?: string; // dataPoint resource name when synced — provenance key
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at?: string;
}

export interface CoachInsight {
  // day/week/month are actionable; quarter/year are retrospective summaries.
  period: "day" | "week" | "month" | "quarter" | "year";
  generatedAt: string;
  headline: string;
  body: string;
  viz?: Record<string, unknown> | null; // single card spec (day/week/month)
  vizCards?: Record<string, unknown>[] | null; // multiple cards for long-range retrospectives
  focusAreas: { title: string; detail: string; metric: string }[];
}

// ── Daily inline AI insights ──────────────────────────────────────────────
// Section-level snippets shown inline on the Daily screen for the current day
// only. See plans/daily-trends-ai-suggestions.md.

export type InsightSection = "movement" | "readiness" | "hydration" | "sleep" | "nutrition" | "habits";

export type ReadinessBand = "low" | "fair" | "good" | "high";

/** App-derived recovery score (NOT Google's readiness — the API exposes none). */
export interface ReadinessScore {
  score: number; // 0-100
  band: ReadinessBand;
  color: string; // css var token for the band
  metric: string; // headline figure, e.g. "HRV 31ms below your 40–52ms normal"
  reasons: string[]; // short grounded explanations
  confident: boolean; // false during baseline cold-start (<~14 days history)
}

export interface DailyInsightSection {
  section: InsightSection;
  text: string; // one short sentence grounded in a number
  metric: string; // the figure it is based on
}

export interface DailyInsightsResponse {
  date: string;
  generatedAt: string;
  today: boolean; // false → previous day, sections always empty
  readiness: ReadinessScore | null;
  sections: DailyInsightSection[];
}
