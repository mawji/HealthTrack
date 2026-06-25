// High-level workout planning. Planned workouts are SEPARATE from completed
// history and from Google Health (data/workout-plans.json) and do not sync until
// completed. Completing a plan item creates a normal workout via the existing
// /api/workouts path — which syncs to Google when connected and therefore gets a
// googleName, so the existing googleName dedup prevents double-counting when the
// same session later returns from the API (no extra time-window matching needed
// for synced completions). See plans/workout-notes-and-planning.md Phase B.

import { readJson, writeJson, newId, localDateStr } from "./store";
import { normalizeExerciseType } from "./googlehealth";
import { estimateBurn } from "./coach/met";
import { sanitizeExercises } from "./workout-detail";
import { WorkoutExercise } from "./types";

const PLANS = "workout-plans.json";
const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3210";

export type PlanStatus = "planned" | "completed" | "skipped";
export type PlanIntensity = "easy" | "moderate" | "hard";

export interface WorkoutPlanItem {
  id: string;
  date: string; // yyyy-MM-dd
  name: string;
  exerciseType: string;
  durationMin: number;
  intensity?: PlanIntensity;
  focus?: string;
  notes?: string;
  exercises?: WorkoutExercise[]; // exercises planned within the workout (wger-linked / per-set)
  estCalories?: number; // MET-based estimate (no device data for a plan)
  status: PlanStatus;
  linkedWorkoutId?: string; // set when completed into a real workout
  createdAt: string;
  updatedAt: string;
}

const INTENSITIES: PlanIntensity[] = ["easy", "moderate", "hard"];

export function getPlanItems(): WorkoutPlanItem[] {
  return readJson<WorkoutPlanItem[]>(PLANS, []);
}

function save(items: WorkoutPlanItem[]) {
  writeJson(PLANS, items);
}

/** Planned (not-yet-completed) items from `from` through `from`+days, oldest first. */
export function getUpcoming(from = localDateStr(), days = 7): WorkoutPlanItem[] {
  const end = addDays(from, days);
  return getPlanItems()
    .filter((p) => p.status === "planned" && p.date >= from && p.date <= end)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addPlanItem(input: Record<string, unknown>, weightKg: number | null): WorkoutPlanItem {
  const now = new Date().toISOString();
  const durationMin = Math.max(1, Math.round(Number(input.durationMin) || 45));
  const exerciseType = normalizeExerciseType(String(input.exerciseType ?? input.name ?? "workout"));
  const intensity = INTENSITIES.includes(input.intensity as PlanIntensity) ? (input.intensity as PlanIntensity) : undefined;
  const item: WorkoutPlanItem = {
    id: newId(),
    date: typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDateStr(),
    name: String(input.name ?? exerciseType.replace(/_/g, " ").toLowerCase()).slice(0, 80),
    exerciseType,
    durationMin,
    intensity,
    focus: input.focus ? String(input.focus).slice(0, 80) : undefined,
    notes: input.notes ? String(input.notes).slice(0, 300) : undefined,
    exercises: sanitizeExercises(input.exercises),
    estCalories: estimateBurn(exerciseType, durationMin, weightKg).calories,
    status: "planned",
    createdAt: now,
    updatedAt: now,
  };
  const items = getPlanItems();
  items.push(item);
  save(items);
  return item;
}

export function updatePlanItem(id: string, patch: Record<string, unknown>, weightKg: number | null): WorkoutPlanItem | null {
  const items = getPlanItems();
  const item = items.find((p) => p.id === id);
  if (!item) return null;
  if (typeof patch.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) item.date = patch.date;
  if (patch.name != null) item.name = String(patch.name).slice(0, 80);
  if (patch.exerciseType != null) item.exerciseType = normalizeExerciseType(String(patch.exerciseType));
  if (patch.durationMin != null) item.durationMin = Math.max(1, Math.round(Number(patch.durationMin) || item.durationMin));
  if ("intensity" in patch) item.intensity = INTENSITIES.includes(patch.intensity as PlanIntensity) ? (patch.intensity as PlanIntensity) : undefined;
  if ("focus" in patch) item.focus = patch.focus ? String(patch.focus).slice(0, 80) : undefined;
  if ("notes" in patch) item.notes = patch.notes ? String(patch.notes).slice(0, 300) : undefined;
  if ("exercises" in patch) item.exercises = sanitizeExercises(patch.exercises);
  if (patch.status === "skipped" || patch.status === "planned") item.status = patch.status;
  item.estCalories = estimateBurn(item.exerciseType, item.durationMin, weightKg).calories;
  item.updatedAt = new Date().toISOString();
  save(items);
  return item;
}

export function deletePlanItem(id: string): boolean {
  const items = getPlanItems();
  const next = items.filter((p) => p.id !== id);
  if (next.length === items.length) return false;
  save(next);
  return true;
}

/**
 * Complete a plan item into a real workout via the existing /api/workouts path
 * (so it syncs to Google + dedups by googleName like any logged workout), then
 * mark the item completed and link it. Returns the updated item, or null.
 */
export async function completePlanItem(id: string): Promise<WorkoutPlanItem | null> {
  const items = getPlanItems();
  const item = items.find((p) => p.id === id);
  if (!item) return null;
  if (item.status === "completed") return item;

  try {
    const res = await fetch(`${BASE_URL}/api/workouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: item.name,
        exerciseType: item.exerciseType,
        durationMin: item.durationMin,
        date: item.date,
        calories: item.estCalories,
        notes: item.notes,
        detail:
          item.intensity || item.exercises?.length
            ? { intensity: item.intensity, exercises: item.exercises }
            : undefined,
      }),
    });
    if (res.ok) {
      const workout = await res.json();
      item.linkedWorkoutId = workout.id;
    }
  } catch {
    // even if the workout write fails, mark the plan item done locally
  }
  item.status = "completed";
  item.updatedAt = new Date().toISOString();
  save(items);
  return item;
}

const GENERIC_TYPES = new Set(["WORKOUT", "OTHER", "AEROBIC_WORKOUT", "CARDIO_WORKOUT", "EXERCISE_CLASS", "OUTDOOR_WORKOUT"]);
function typeCompatible(a: string, b: string): boolean {
  return a === b || GENERIC_TYPES.has(a) || GENERIC_TYPES.has(b);
}

/**
 * Auto-complete planned workouts that actually happened. A planned item is
 * marked completed + linked when a COMPLETED workout exists on its date with a
 * compatible type — whether logged in the app, started as a live session, or
 * recorded on the watch and synced from Google. Day-level match (plans are
 * day-level, not time-precise); one workout completes at most one plan. The
 * manual "keep separate" override can undo a wrong link.
 */
export function reconcilePlans(completed: { id: string; date: string; exerciseType: string }[]): boolean {
  const items = getPlanItems();
  let changed = false;
  const used = new Set(items.map((i) => i.linkedWorkoutId).filter(Boolean) as string[]);
  for (const item of items) {
    if (item.status !== "planned") continue;
    const match = completed.find((w) => w.date === item.date && typeCompatible(w.exerciseType, item.exerciseType) && !used.has(w.id));
    if (!match) continue;
    item.status = "completed";
    item.linkedWorkoutId = match.id;
    item.updatedAt = new Date().toISOString();
    used.add(match.id);
    changed = true;
  }
  if (changed) save(items);
  return changed;
}

/** Compact planned-workout context block for the coach (today + next `days`). */
export function formatPlanForCoach(from = localDateStr(), days = 7): string {
  const upcoming = getUpcoming(from, days);
  if (!upcoming.length) return "";
  const lines = ["== Planned workouts (upcoming; NOT yet done — never log these as completed) =="];
  for (const p of upcoming) {
    const bits = [
      `${p.date}: ${p.name} (${p.exerciseType})`,
      `${p.durationMin} min`,
      p.intensity,
      p.focus ? `focus: ${p.focus}` : null,
      p.exercises?.length ? `${p.exercises.length} exercise(s)` : null,
      p.estCalories ? `~${p.estCalories} kcal (MET est.)` : null,
      p.notes ? `notes: ${p.notes}` : null,
    ].filter(Boolean);
    lines.push(bits.join(", "));
  }
  return lines.join("\n");
}
