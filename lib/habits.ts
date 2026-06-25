// Local persistence, validation, and status/streak math for configurable
// habits. Route handlers stay thin and call into here. Habits never sync to
// Google Health — they live only in data/habits.json + data/habit-records.json.
// See plans/configurable-habits.md.

import fs from "fs";
import { readJson, writeJson, dataPath, newId, localDateStr } from "./store";
import {
  HabitDefinition,
  HabitRecord,
  HabitComputedStatus,
  HabitKind,
  HabitTargetType,
  HabitGoalMode,
} from "./types";
import { HABIT_ICON_KEYS } from "@/components/icons";

const HABITS = "habits.json";
const RECORDS = "habit-records.json";

const KINDS: HabitKind[] = ["boost", "avoid"];
const TARGET_TYPES: HabitTargetType[] = ["yes_no", "count", "duration", "quantity"];
const GOAL_MODES: HabitGoalMode[] = ["at_least", "at_most", "between", "exactly", "none"];

// ── small input helpers (untrusted bodies) ────────────────────────────────
const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
};
const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
};
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "habit"
  );
}

// ── definitions ────────────────────────────────────────────────────────────

/** Stable display order: habits with an explicit sortOrder first (ascending),
 *  then any without, preserving their stored order. */
function sortHabits(habits: HabitDefinition[]): HabitDefinition[] {
  const N = habits.length;
  return habits
    .map((h, i) => ({ h, key: h.sortOrder ?? N + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.h);
}

/** Load habit definitions (in display order), seeding examples on first run. */
export function getHabitDefinitions(): HabitDefinition[] {
  if (!fs.existsSync(dataPath(HABITS))) {
    const seeded = seedHabits();
    writeJson(HABITS, seeded);
    return seeded;
  }
  return sortHabits(readJson<HabitDefinition[]>(HABITS, []));
}

/** Apply a new manual order. `ids` is a desired ordering of some habits; those
 *  habits are reordered among the slots they currently occupy (non-listed
 *  habits keep their positions), then every habit gets a fresh sortOrder. */
export function reorderHabits(ids: string[]): HabitDefinition[] {
  const current = getHabitDefinitions();
  const provided = new Set(ids.filter((id) => current.some((h) => h.id === id)));
  const queue = ids.filter((id) => provided.has(id));
  const newOrderIds = current.map((h) => (provided.has(h.id) ? queue.shift()! : h.id));
  const byId = new Map(current.map((h) => [h.id, h]));
  const now = new Date().toISOString();
  const reordered = newOrderIds.map((id, i) => ({ ...byId.get(id)!, sortOrder: i, updatedAt: now }));
  saveHabitDefinitions(reordered);
  return reordered;
}

export function saveHabitDefinitions(habits: HabitDefinition[]) {
  writeJson(HABITS, habits);
}

/** Validate and normalize an untrusted create/update body into a definition.
 *  `existing` is passed on edits so unspecified fields and timestamps survive. */
export function sanitizeHabitDefinition(
  raw: unknown,
  existing?: HabitDefinition
): HabitDefinition | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid body" };
  const r = raw as Record<string, unknown>;
  const now = new Date().toISOString();

  const name = str(r.name, 80) ?? existing?.name;
  if (!name) return { error: "name is required" };

  const kind: HabitKind = KINDS.includes(r.kind as HabitKind)
    ? (r.kind as HabitKind)
    : existing?.kind ?? "boost";
  const targetType: HabitTargetType = TARGET_TYPES.includes(r.targetType as HabitTargetType)
    ? (r.targetType as HabitTargetType)
    : existing?.targetType ?? "yes_no";
  let goalMode: HabitGoalMode = GOAL_MODES.includes(r.goalMode as HabitGoalMode)
    ? (r.goalMode as HabitGoalMode)
    : existing?.goalMode ?? (kind === "avoid" ? "at_most" : "at_least");
  // yes_no carries no numeric goal mode.
  if (targetType === "yes_no") goalMode = "none";

  const iconKeyRaw = str(r.iconKey, 40) ?? existing?.iconKey ?? "check";
  const iconKey = HABIT_ICON_KEYS.includes(iconKeyRaw) ? iconKeyRaw : "check";

  const def: HabitDefinition = {
    id: existing?.id ?? "",
    name,
    description: str(r.description, 280) ?? existing?.description,
    iconKey,
    color: str(r.color, 40) ?? existing?.color,
    kind,
    targetType,
    goalMode,
    unit: str(r.unit, 24) ?? existing?.unit,
    targetMin: "targetMin" in r ? num(r.targetMin) : existing?.targetMin,
    targetMax: "targetMax" in r ? num(r.targetMax) : existing?.targetMax,
    defaultValue: "defaultValue" in r ? num(r.defaultValue) : existing?.defaultValue,
    active: bool(r.active, existing?.active ?? true),
    showOnDaily: bool(r.showOnDaily, existing?.showOnDaily ?? true),
    coachVisible: bool(r.coachVisible, existing?.coachVisible ?? true),
    nudgeEnabled: bool(r.nudgeEnabled, existing?.nudgeEnabled ?? false),
    sortOrder: existing?.sortOrder, // managed by reorderHabits, never set from body
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return def;
}

/** Assign a stable, unique id derived from the name (falls back to a random id). */
export function nextHabitId(name: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return newId();
}

// ── records ──────────────────────────────────────────────────────────────

export function getHabitRecords(): HabitRecord[] {
  return readJson<HabitRecord[]>(RECORDS, []);
}

export function saveHabitRecords(records: HabitRecord[]) {
  writeJson(RECORDS, records);
}

export function deleteHabitRecord(id: string): boolean {
  const records = getHabitRecords();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  saveHabitRecords(next);
  return true;
}

/** Create or replace the single record for (habitId, date). A null/undefined
 *  value clears any existing record (e.g. un-checking a yes_no habit). */
export function upsertHabitRecord(input: {
  habitId: string;
  date: string;
  value: boolean | number | null;
  note?: string;
}): HabitRecord | null {
  const habit = getHabitDefinitions().find((h) => h.id === input.habitId);
  if (!habit) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDateStr();
  const records = getHabitRecords();
  const idx = records.findIndex((r) => r.habitId === input.habitId && r.date === date);

  if (input.value == null) {
    if (idx >= 0) {
      records.splice(idx, 1);
      saveHabitRecords(records);
    }
    return null;
  }

  const value =
    habit.targetType === "yes_no" ? Boolean(input.value) : Number(input.value) || 0;
  const completed = evalCompletion(habit, value);
  const now = new Date().toISOString();

  if (idx >= 0) {
    records[idx] = {
      ...records[idx],
      value,
      note: str(input.note, 280),
      completed,
      updatedAt: now,
    };
    saveHabitRecords(records);
    return records[idx];
  }
  const rec: HabitRecord = {
    id: newId(),
    habitId: input.habitId,
    date,
    value,
    note: str(input.note, 280),
    completed,
    createdAt: now,
    updatedAt: now,
  };
  records.push(rec);
  saveHabitRecords(records);
  return rec;
}

// ── completion + streaks ───────────────────────────────────────────────────

/** Does a logged value satisfy the habit's target? Boost = "did enough";
 *  avoid = "stayed within the limit / avoided the behavior". */
export function evalCompletion(habit: HabitDefinition, value: boolean | number): boolean {
  if (habit.targetType === "yes_no") {
    const occurred = Boolean(value); // tracked behavior happened
    return habit.kind === "boost" ? occurred : !occurred;
  }
  const v = Number(value) || 0;
  const min = habit.targetMin;
  const max = habit.targetMax;
  switch (habit.goalMode) {
    case "at_least":
      return min == null || v >= min;
    case "at_most":
      return max == null || v <= max;
    case "between":
      return (min == null || v >= min) && (max == null || v <= max);
    case "exactly":
      return min != null && v === min;
    case "none":
    default:
      // No explicit target: boost counts any positive value; avoid is just tracked.
      return habit.kind === "boost" ? v > 0 : true;
  }
}

/** Records for one habit, keyed by date, completed-only. */
function completedDates(records: HabitRecord[], habit: HabitDefinition): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    if (r.habitId !== habit.id) continue;
    if (evalCompletion(habit, r.value)) out.add(r.date);
  }
  return out;
}

function prevDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Consecutive completed days ending at `date`. If `date` itself is not yet
 *  completed it does not break the streak (grace for "today not done yet"). */
export function computeHabitStreak(
  habit: HabitDefinition,
  records: HabitRecord[],
  date: string,
  today: string
): number {
  const done = completedDates(records, habit);
  let cursor = date;
  // Today (or the viewed future-less date) gets grace: start from the prior day
  // when the current day isn't complete yet.
  if (!done.has(cursor)) {
    if (cursor !== today) return 0; // a past gap genuinely breaks the streak
    cursor = prevDate(cursor);
  }
  let n = 0;
  while (done.has(cursor)) {
    n++;
    cursor = prevDate(cursor);
  }
  return n;
}

/** Longest completed run across all recorded history for the habit. */
export function computeBestStreak(habit: HabitDefinition, records: HabitRecord[]): number {
  const done = [...completedDates(records, habit)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of done) {
    run = prev && prevDate(d) === prev ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/** Full computed status for a habit on a given date. */
export function computeHabitStatus(
  habit: HabitDefinition,
  records: HabitRecord[],
  date: string,
  today: string
): HabitComputedStatus {
  const rec = records.find((r) => r.habitId === habit.id && r.date === date);
  const completed = rec ? evalCompletion(habit, rec.value) : false;
  return {
    habitId: habit.id,
    date,
    completed,
    value: rec ? rec.value : null,
    streak: computeHabitStreak(habit, records, date, today),
    bestStreak: computeBestStreak(habit, records),
    missedToday: date === today && !completed,
  };
}

/** Short human target summary, e.g. "≥ 10 min", "≤ 2 cups", "avoid". */
export function habitTargetLabel(h: HabitDefinition): string {
  const unit = h.unit ? ` ${h.unit}` : "";
  if (h.targetType === "yes_no") return h.kind === "boost" ? "do daily" : "avoid";
  switch (h.goalMode) {
    case "at_least":
      return `≥ ${h.targetMin ?? 0}${unit}`;
    case "at_most":
      return `≤ ${h.targetMax ?? 0}${unit}`;
    case "between":
      return `${h.targetMin ?? 0}–${h.targetMax ?? 0}${unit}`;
    case "exactly":
      return `= ${h.targetMin ?? 0}${unit}`;
    default:
      return h.unit ? `track${unit}` : "track";
  }
}

/** One compact line per habit for the coach context, e.g.
 *  "Read: target ≥ 10 min, 12 logged today, completed, streak 4" */
export function formatHabitForCoach(
  habit: HabitDefinition,
  status: HabitComputedStatus
): string {
  const target = habitTargetLabel(habit);
  let logged: string;
  if (status.value == null) logged = "nothing logged today";
  else if (habit.targetType === "yes_no")
    logged = status.value ? "behavior occurred" : "avoided today";
  else logged = `${status.value}${habit.unit ? " " + habit.unit : ""} logged today`;
  const state =
    habit.kind === "boost"
      ? status.completed
        ? "completed"
        : "target not met"
      : status.completed
        ? "within limit"
        : "limit exceeded";
  return `${habit.name}: ${habit.kind} ${target}, ${logged}, ${state}, streak ${status.streak}`;
}

// ── seed ────────────────────────────────────────────────────────────────────

/** Editable example habits written once on first run. Not special-cased
 *  anywhere — the user can edit or archive them like any other habit. */
function seedHabits(): HabitDefinition[] {
  const now = new Date().toISOString();
  const base = {
    active: true,
    showOnDaily: true,
    coachVisible: true,
    nudgeEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  return [
    {
      ...base,
      id: "read",
      name: "Read",
      description: "Read a book for at least 10 minutes.",
      iconKey: "book",
      color: "var(--sleep)",
      kind: "boost",
      targetType: "duration",
      goalMode: "at_least",
      unit: "min",
      targetMin: 10,
      defaultValue: 10,
    },
    {
      ...base,
      id: "coffee",
      name: "Coffee",
      description: "Keep coffee to at most 2 cups a day.",
      iconKey: "coffee",
      color: "var(--food)",
      kind: "avoid",
      targetType: "count",
      goalMode: "at_most",
      unit: "cups",
      targetMax: 2,
      defaultValue: 1,
    },
    {
      ...base,
      id: "coffee-empty-stomach",
      name: "Coffee on empty stomach",
      description: "Avoid coffee before eating in the morning.",
      iconKey: "no-entry",
      color: "var(--heart)",
      kind: "avoid",
      targetType: "yes_no",
      goalMode: "none",
    },
  ];
}
