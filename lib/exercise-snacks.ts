// Exercise Snacks — local persistence + coach formatting. Route handlers stay
// thin and call into here. Snacks never sync to Google Health; they live only in
// data/exercise-snacks.json. The editable daily target lives alongside the
// completions here (the metric-value Goals engine in lib/goals.ts is built for
// trended lab/device numbers, not a per-day completion counter, so the snack
// target stays self-contained rather than shoehorned into that shared file).
// See plans/exercise-snacks.md.

import { readJson, writeJson, newId, localDateStr } from "./store";
import { SnackDayState, SnackEntry, SnackSource, routineById } from "./snack-routines";

const FILE = "exercise-snacks.json";

export const DEFAULT_SNACK_TARGET = 10;
const MIN_TARGET = 1;
const MAX_TARGET = 20;

interface SnackStore {
  /** Editable daily target (count of breathless-minute snacks). */
  target: number;
  /** Completed snacks keyed by local date (yyyy-MM-dd). */
  days: Record<string, SnackEntry[]>;
}

function clampTarget(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_SNACK_TARGET;
  return Math.max(MIN_TARGET, Math.min(MAX_TARGET, v));
}

function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function load(): SnackStore {
  const s = readJson<SnackStore>(FILE, { target: DEFAULT_SNACK_TARGET, days: {} });
  return {
    target: clampTarget(s?.target),
    days: s?.days && typeof s.days === "object" ? s.days : {},
  };
}

function save(s: SnackStore) {
  writeJson(FILE, s);
}

// ── target ──────────────────────────────────────────────────────────────────

export function getSnackTarget(): number {
  return load().target;
}

export function setSnackTarget(n: unknown): number {
  const s = load();
  s.target = clampTarget(n);
  save(s);
  return s.target;
}

// ── per-day state ─────────────────────────────────────────────────────────────

/** ISO time of the most recent meal logged on `date` (local food log only),
 *  used for the after-meal "due" trigger. */
function lastMealAtToday(date: string): string | null {
  const meals = readJson<Array<{ loggedAt?: string }>>("food-log.json", []);
  let best: string | null = null;
  for (const m of meals) {
    if (typeof m.loggedAt === "string" && m.loggedAt.slice(0, 10) === date) {
      if (!best || m.loggedAt > best) best = m.loggedAt;
    }
  }
  return best;
}

export function getSnackDay(date?: string): SnackDayState {
  const s = load();
  const d = isDate(date) ? date : localDateStr();
  return { date: d, target: s.target, completed: s.days[d] ?? [], lastMealAt: lastMealAtToday(d) };
}

// ── post-hoc heart-rate resolution ───────────────────────────────────────────
// Google Health HR is delayed batch data (intraday roll-ups synced from the
// watch after the fact), so a snack's HR can't be known at completion time. We
// resolve it on later reads: for each completed snack still missing maxHr, take
// the max BPM over its last ~3 min once the watch has synced that window. Give
// up (null = "no data") after 2h so we stop retrying. See plans/exercise-snacks.md.

const HR_LOOKBACK_MS = 3 * 60 * 1000; // "last ~3 min"
const HR_FORWARD_MS = 60 * 1000; // small slack after the tap
const HR_GIVEUP_MS = 2 * 60 * 60 * 1000; // stop retrying after 2h

let hrCache: { date: string; at: number; windows: { start: number; end: number; max: number }[] } | null = null;

/** Enrich today's completed snacks with maxHr where the watch has synced HR.
 *  Returns the (possibly updated) day state. Never throws. */
export async function resolveSnackHr(date?: string): Promise<SnackDayState> {
  const d = isDate(date) ? date : localDateStr();
  const day = getSnackDay(d);
  const now = Date.now();
  const pending = day.completed.filter((e) => e.maxHr === undefined && now - Date.parse(e.at) < HR_GIVEUP_MS + HR_LOOKBACK_MS);
  const expired = day.completed.filter((e) => e.maxHr === undefined && now - Date.parse(e.at) >= HR_GIVEUP_MS + HR_LOOKBACK_MS);
  if (!pending.length && !expired.length) return day;

  let windows: { start: number; end: number; max: number }[] = [];
  if (pending.length) {
    try {
      const { isConnected, fetchHeartMaxWindows } = await import("./googlehealth");
      if (isConnected()) {
        if (hrCache && hrCache.date === d && now - hrCache.at < 60_000) {
          windows = hrCache.windows;
        } else {
          windows = await fetchHeartMaxWindows(d, 180);
          hrCache = { date: d, at: now, windows };
        }
      }
    } catch {
      // leave pending entries unresolved; retry next read
    }
  }

  const s = load();
  const arr = s.days[d];
  if (!arr) return day;
  let changed = false;
  for (const e of arr) {
    if (e.maxHr !== undefined) continue;
    const t = Date.parse(e.at);
    if (windows.length) {
      const lo = t - HR_LOOKBACK_MS;
      const hi = t + HR_FORWARD_MS;
      const hits = windows.filter((w) => w.end > lo && w.start < hi).map((w) => w.max);
      if (hits.length) {
        e.maxHr = Math.max(...hits);
        changed = true;
        continue;
      }
    }
    if (now - t >= HR_GIVEUP_MS) {
      e.maxHr = null; // no HR ever synced for this window — stop retrying
      changed = true;
    }
  }
  if (changed) save(s);
  return { date: d, target: s.target, completed: arr, lastMealAt: lastMealAtToday(d) };
}

/** Credit one snack for a date. routineId is optional — a generic snack counts;
 *  an unknown routineId is dropped rather than stored. */
export function completeSnack(input: {
  date?: string;
  routineId?: string;
  source?: SnackSource;
}): SnackDayState {
  const s = load();
  const date = isDate(input.date) ? input.date : localDateStr();
  const routineId = input.routineId && routineById(input.routineId) ? input.routineId : undefined;
  const source: SnackSource =
    input.source === "auto" || input.source === "coach" ? input.source : "manual";
  const entry: SnackEntry = { id: newId(), at: new Date().toISOString(), source, routineId };
  const arr = s.days[date] ?? [];
  arr.push(entry);
  s.days[date] = arr;
  save(s);
  return { date, target: s.target, completed: arr };
}

/** Remove a snack for a date: a specific entry by id, else the most recent one.
 *  No-op (returns current state) when there is nothing to undo. */
export function undoSnack(input: { date?: string; entryId?: string }): SnackDayState {
  const s = load();
  const date = isDate(input.date) ? input.date : localDateStr();
  const arr = s.days[date] ?? [];
  if (arr.length) {
    if (input.entryId) {
      const idx = arr.findIndex((e) => e.id === input.entryId);
      if (idx >= 0) arr.splice(idx, 1);
    } else {
      arr.pop();
    }
    s.days[date] = arr;
    save(s);
  }
  return { date, target: s.target, completed: arr };
}

// ── coach context ──────────────────────────────────────────────────────────

/** Compact "== Exercise snacks (today) ==" block: progress + loggable routine
 *  ids. Kept short; the coach nudges toward the remaining snacks. */
export function formatSnacksForCoach(date?: string): string {
  const day = getSnackDay(date);
  const done = day.completed.length;
  const left = Math.max(0, day.target - done);
  const lines = [
    "== Exercise snacks (today) ==",
    `${done} of ${day.target} breathless-minute snacks done${left > 0 ? `, ${left} to go` : " — goal met"}.`,
  ];
  if (left > 0) {
    lines.push(
      "A snack = ~1 minute of vigorous, breathless movement; placing them after meals also blunts post-meal glucose. Encourage the remaining snacks with a concrete one-minute idea."
    );
  }
  lines.push(
    "logExerciseSnack routineIds (routineId optional): squats, jumping-jacks, high-knees, burpees, fast-stairs, uphill-walk, walk-jog-intervals, mountain-climbers, squat-jumps, march, dance, active-play, speed-walk."
  );
  return lines.join("\n");
}
