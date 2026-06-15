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
  syncedToHealth: boolean;
  googleName?: string; // dataPoint resource name when synced
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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at?: string;
}

export interface CoachInsight {
  period: "day" | "week" | "month";
  generatedAt: string;
  headline: string;
  body: string;
  viz?: Record<string, unknown> | null; // card spec rendered under the body
  focusAreas: { title: string; detail: string; metric: string }[];
}
