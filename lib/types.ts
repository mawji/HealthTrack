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

// ── Nutrition provenance ────────────────────────────────────────────────────
// Where a food entry's macros came from, and how trustworthy each part is. This
// is the shared "show the source + confidence" affordance the evidence-coach
// build reuses across barcode (Open Food Facts), USDA FDC, label, user, and
// model paths. Built first for Track A (barcode); Phase 4 extends it for FDC.
export type NutritionSource = "photo" | "text" | "barcode" | "fdc" | "label" | "user" | "model" | "composite";

export interface FoodProvenance {
  source: NutritionSource;
  sourceLabel?: string; // human label, e.g. "Open Food Facts"
  sourceUrl?: string; // link to the product / source page
  attribution?: string; // required attribution text, e.g. "Source: Open Food Facts (ODbL)"
  barcode?: string;
  brand?: string;
  servingG?: number; // grams the macros are scaled to
  portionEstimated?: boolean; // true when portion is an editable estimate, not measured
  gi?: number; // source-backed glycemic index (glucose=100); enables a real GL
  giSource?: string; // attribution for the GI value, e.g. "Intl. GI Tables 2008/2021"
  nova?: number; // NOVA processing group, 1–4
  ingredients?: string;
  allergens?: string[];
}

// One resolved ingredient/dish in a composite meal. The hybrid analyzer
// decomposes a plate into components, then resolves each against USDA FoodData
// Central (macro DENSITY is reference-grade) or keeps the model estimate when no
// match is found. `per100g`/`fdcId` are present only for USDA-backed components —
// they let the composer rescale a component when its portion is edited.
export interface FoodComponent {
  name: string;
  portionG: number; // grams of THIS component in the meal (editable estimate)
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  glycemicLoad?: number; // GI-based when the component has a curated GI, else model estimate
  per100g?: { calories: number; proteinG: number; carbsG: number; fatG: number };
  fdcId?: number; // USDA FoodData Central id when source-backed
  provenance: FoodProvenance; // per-component source: "fdc" (USDA) or "photo"/"text" (AI estimate)
}

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
  provenance?: FoodProvenance; // source/confidence of the macros (barcode, FDC, …)
  components?: FoodComponent[]; // per-ingredient breakdown when logged via the composite analyzer
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
  provenance?: FoodProvenance; // set on barcode/FDC paths; absent for pure model estimates
  components?: FoodComponent[]; // per-ingredient breakdown from the composite analyzer
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
/** One exercise within a workout (or a planned workout). The uniform
 *  sets/reps/weightKg shortcut covers the common case; setList holds per-set
 *  rows when they vary. exerciseId links to the wger/custom library for image +
 *  muscles. Backward-compatible with the original {name,sets,reps,weightKg}. */
export interface WorkoutExercise {
  exerciseId?: string; // wger uuid or custom id (library link); absent for free-typed
  name: string;
  sets?: number; // uniform shortcut: N sets …
  reps?: number; // … of M reps …
  weightKg?: number; // … at W kg
  setList?: { reps?: number; weightKg?: number }[]; // per-set rows, when sets vary
}

export interface WorkoutDetail {
  intensity?: "easy" | "moderate" | "hard";
  effort?: number; // RPE 1-10, subjective
  soreness?: string;
  injury?: string;
  exercises?: WorkoutExercise[];
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
  // Set when a live session was finished but deferred from Google (the user said
  // they also tracked it on their watch). The workouts GET reconciliation links
  // it to the overlapping watch session once it syncs, then clears this.
  awaitingWatchMatch?: boolean;
  // Read-time merge annotations (computed by the workouts GET, never persisted on
  // the session itself — the links live in workout-merges.json).
  mergedFrom?: WorkoutMergeMember[]; // umbrella: sessions folded into this one
  mergeSuggestion?: { umbrellaId: string; members: WorkoutMergeMember[] }; // "these look like one session — merge?"
}

/** A session referenced by a merge (folded-in member, or a suggested member). */
export interface WorkoutMergeMember {
  id: string;
  name: string;
  exerciseType: string;
  startTime: string;
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

export type MeasurementKind = "weight" | "glucose" | "body-temp" | "body-fat" | "sleep" | "muscle-mass" | "blood-pressure";

export interface Measurement {
  id: string;
  kind: MeasurementKind;
  at: string; // ISO timestamp of the reading
  value: number; // primary value: kg | glucose | °C/°F | % | sleep minutes | muscle-mass kg | blood-pressure systolic
  value2?: number; // secondary value — diastolic for blood-pressure (mmHg)
  unit: string; // display unit, e.g. "kg", "mmol/L", "°C", "%", "min", "mmHg"
  context?: string; // glucose timing: fasting | random | post_meal | pre_meal
  startTime?: string; // sleep: HH:MM
  endTime?: string; // sleep: HH:MM
  note?: string;
  syncedToHealth: boolean; // written back to Google Health
  googleName?: string; // dataPoint resource name when synced — provenance key
}

// ── User profile (foundation for evidence-based targets #10/#11/#13) ─────────
// Manual-first profile feeding deterministic targets (BMR/TDEE land in a later
// phase) and BMI / healthy-weight range now. Stored locally in data/profile.json.
// Today data/userinfo.json holds only the Google name/photo — this is separate,
// app-owned, and never written back to Google.

export type BiologicalSex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type WeightGoal = "lose" | "maintain" | "gain";

export interface UserProfile {
  sex: BiologicalSex | null; // biological sex — used only for metabolic estimates
  birthDate: string | null; // yyyy-MM-dd; age is derived, never stored directly
  heightCm: number | null;
  weightKg: number | null; // manual current weight; device weight is preferred when present
  activityLevel: ActivityLevel | null;
  goal: WeightGoal | null;
  targetRateKgPerWeek: number | null; // pace toward goal, magnitude in kg/week
  pregnantOrLactating: boolean; // conservative-defaults safety flag
  conditions: string | null; // voluntarily disclosed chronic conditions / limitations, free text
  updatedAt: string;
}

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

/** Deterministic figures derived from the profile (+ resolved device weight).
 *  The coach quotes these; it never recomputes BMI or ranges itself. */
export interface ProfileDerived {
  age: number | null;
  weightKgResolved: number | null; // weight used for BMI (device when synced, else manual)
  weightSource: "device" | "manual" | null;
  bmi: number | null; // 1-decimal
  bmiCategory: BmiCategory | null; // CDC adult framing
  healthyWeightRangeKg: { min: number; max: number } | null; // BMI 18.5–24.9 for this height
  // Safety-critical fields still missing before precise targets/plans are warranted.
  missingForTargets: string[];
}

export interface ProfilePayload {
  profile: UserProfile;
  derived: ProfileDerived;
}

// ── Medications & supplements ───────────────────────────────────────────────
// Local-only tracker for daily meds/supplements: definitions + per-dose
// adherence, time-anchored reminders (Telegram + Daily), and a generated-once
// research note sourced from authoritative drug databases. Never synced to
// Google Health and excluded from every cloud/social aggregate (meds are
// sensitive). Mirrors the configurable-habits template. See
// plans/medications-tracking.md.

export type MedicationKind = "medication" | "supplement";
export type MedicationFrequency = "daily" | "specific_days" | "as_needed";
export type MedicationStatus = "taken" | "skipped";

export interface MedicationSchedule {
  frequency: MedicationFrequency;
  daysOfWeek?: number[]; // 0=Sun … 6=Sat, used by specific_days
  times: string[]; // "HH:mm" local dose times (empty ⇒ one untimed dose / as_needed)
}

/** Per-med reminder behavior. Overrides the global defaults in the settings
 *  store. leadMinutes lists how long BEFORE each dose time to remind (0 = at
 *  the time itself), e.g. [15, 0]. */
export interface MedicationReminderSettings {
  enabled: boolean;
  leadMinutes: number[];
}

/** Generated-once research note. AI maps the user's brand name → active
 *  ingredient; the section text is distilled STRICTLY from authoritative source
 *  text (openFDA / MedlinePlus / NIH ODS) with the sources cited — never
 *  invented. `error` is set (and sections left empty) when no reliable source
 *  was found, so the UI can say so instead of showing fabricated facts. */
export interface MedicationInfo {
  genericName: string | null;
  sections: {
    purpose?: string;
    usage?: string;
    dosage?: string;
    sideEffects?: string;
    cautions?: string;
  };
  sources: { name: string; url: string }[];
  disclaimer: string;
  retrievedAt: string; // ISO
  error?: string;
}

/** One active component of a (possibly combination) medication, each with its
 *  own strength — e.g. Xigduo XR = dapagliflozin 5 mg + metformin 1000 mg. */
export interface MedicationIngredient {
  name: string; // active ingredient, generic name
  strength?: string; // e.g. "5 mg", "1000 mg" — display only
}

export interface MedicationDefinition {
  id: string;
  name: string; // brand / name as the user knows it
  kind: MedicationKind;
  strength?: string; // single-ingredient display, e.g. "5 mg" — NOT clinically validated
  ingredients?: MedicationIngredient[]; // active components for combination meds
  quantity?: number; // units per dose, e.g. 1
  unit?: string; // "tablet" | "capsule" | "ml" | "IU" | … (freeform)
  form?: string;
  nickname?: string; // 1-3 char abbreviation shown in the pill box, e.g. "BP", "VD"
  withFood?: boolean;
  notes?: string;
  schedule: MedicationSchedule;
  critical: boolean; // must-take: reminders re-nudge until taken + bypass quiet hours
  reminders: MedicationReminderSettings;
  info?: MedicationInfo; // cached research note (generated once, refreshable)
  inventory?: MedicationInventory; // current supply on hand; undefined = not tracked
  active: boolean; // archived meds keep history but drop off Daily/reminders
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

/** Current supply on hand for a med. Auto-deducted as doses are taken (by the
 *  per-dose quantity); the user tops it up when they restock. */
export interface MedicationInventory {
  units: number; // remaining units (tablets/capsules/ml…)
  updatedAt: string; // ISO
}

export interface MedicationRecord {
  id: string;
  medicationId: string;
  date: string; // yyyy-MM-dd in APP_TZ
  doseIndex: number; // which scheduled time (index into schedule.times); 0 for untimed/as_needed
  status: MedicationStatus;
  takenAt?: string; // ISO, when marked taken
  note?: string;
}

export interface MedicationDoseStatus {
  doseIndex: number;
  time: string | null; // "HH:mm" scheduled time, or null for an untimed dose
  status: MedicationStatus | null; // null ⇒ pending
  overdue: boolean; // scheduled time passed today and still pending
}

export interface MedicationDayStatus {
  medicationId: string;
  date: string;
  scheduledToday: boolean; // does the schedule call for this med on `date`
  asNeeded: boolean;
  doses: MedicationDoseStatus[];
  takenCount: number;
  scheduledCount: number;
  adherence7d: number | null; // % of scheduled doses taken over the trailing 7 days
}

export interface MedicationsPayload {
  date: string;
  medications: MedicationDefinition[];
  records: MedicationRecord[]; // records for the requested date
  status: MedicationDayStatus[];
}

/** Global reminder defaults + critical-dose escalation knobs (one store). */
export interface MedicationSettings {
  remindersEnabled: boolean; // master switch (opt-in)
  defaultLeadMinutes: number[]; // seeded onto new meds
  renudgeMinutes: number; // gap between re-nudges for a missed critical dose
  maxRenudges: number; // cap on re-nudges per missed critical dose
  criticalBypassQuietHours: boolean;
  quietStartMin: number; // local minutes; non-critical reminders suppressed in [start,end)
  quietEndMin: number;
  inventoryEnabled: boolean; // track supply counts + low-stock reminders
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

// ── Coach memory (durable facts about the person) ──────────────────────────
// A small, ranked store of human-readable facts the coach reads each turn and
// can write to as it learns — so it carries context across sessions and gets
// smarter by the day. One fact per record; deduplicate/consolidate rather than
// duplicate; never store what's already trended/logged as a raw value. Local
// only (data/coach-memory.json), never synced. See plans/coach-memory-system.md.

export type CoachMemoryCategory =
  | "preference"   // "prefers morning workouts"
  | "constraint"   // "recovering from a knee injury"
  | "condition"    // disclosed condition the coach should account for
  | "lifestyle"    // "has an infant who wakes them at night"
  | "goal"         // goal-in-progress / agreement
  | "advice"       // prior advice given
  | "pattern"      // a derived/consolidated pattern (e.g. from silent watchers)
  | "openness"     // evolving read of how freely the user shares per area
  | "boundary"     // explicit do-not-probe (only from an explicit user opt-out)
  | "other";

export type CoachMemorySource = "coach" | "user" | "proactive" | "derived" | "reflection";

export interface CoachMemory {
  id: string;
  text: string; // the fact, one sentence
  category: CoachMemoryCategory;
  source: CoachMemorySource;
  confidence?: number; // 0..1; derived/coach-asserted facts can be soft
  topic?: string; // coarse grouping key for consolidation (e.g. "sleep", "glucose")
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string; // touched when surfaced into context (ranking/pruning)
  pinned?: boolean; // user-pinned memories always surface
  archived?: boolean; // soft-delete
}

// ── Coach proactive questions ──────────────────────────────────────────────
// Short questions the coach raises to build a sense of the person's lifestyle.
// Two kinds: anomaly (deterministic detection of a notable data deviation → AI
// phrasing) and discovery (AI-driven, indirect, within deterministic rails).
// Answered conversationally in the coach page; answers become coach memories.
// Local only (data/coach-questions.json). See plans/coach-proactive-questions.md.

export type CoachQuestionKind = "anomaly" | "discovery";
export type CoachQuestionStatus = "pending" | "answered" | "dismissed" | "expired";

export interface CoachQuestion {
  id: string;
  kind: CoachQuestionKind;
  ruleId?: string; // anomaly only
  metric?: string; // anomaly: the concrete figure
  topic: string; // cooldown + memory grouping key
  observation?: string; // deterministic fact the question is about (anomaly)
  prompt: string; // AI-phrased, indirect opener shown to the user
  status: CoachQuestionStatus;
  date: string; // local day the trigger fired (yyyy-MM-dd)
  createdAt: string; // ISO
  dismissCount?: number; // drives backoff/rephrase
  answer?: string; // captured gist of the user's reply
  answeredAt?: string;
  memoryId?: string; // link to the coach memory created from the answer
}
