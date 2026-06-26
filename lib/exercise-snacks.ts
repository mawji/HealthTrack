// Exercise Snacks — local persistence + coach formatting. Route handlers stay
// thin and call into here. Snacks never sync to Google Health; they live only in
// data/exercise-snacks.json. The editable daily target lives alongside the
// completions here (the metric-value Goals engine in lib/goals.ts is built for
// trended lab/device numbers, not a per-day completion counter, so the snack
// target stays self-contained rather than shoehorned into that shared file).
// See plans/exercise-snacks.md.

import { readJson, writeJson, newId, localDateStr } from "./store";
import { SnackDayState, SnackEntry, SnackSession, SnackSource, routineById } from "./snack-routines";

const FILE = "exercise-snacks.json";

export const DEFAULT_SNACK_TARGET = 10;
const MIN_TARGET = 1;
const MAX_TARGET = 20;

// Live timer
const STOP_GRACE_SEC = 5; // trimmed off the duration when you stop
export const AUTOSTOP_SEC = 15 * 60; // forgotten sessions auto-stop here

/** A forgotten (auto-stopped) session pending HR reconciliation: once intraday
 *  HR syncs, trim the timer minutes credited after the real stop (HR drop). */
interface AutoStopReconcile {
  date: string;
  startedAt: string;
  stoppedAt: string;
  entryIds: string[];
}

interface SnackStore {
  /** Editable daily target (count of breathless-minute snacks). */
  target: number;
  /** Completed snacks keyed by local date (yyyy-MM-dd). */
  days: Record<string, SnackEntry[]>;
  /** The single live timer session (or null). */
  session?: SnackSession | null;
  /** Pending HR reconcile for a forgotten auto-stopped session. */
  reconcile?: AutoStopReconcile | null;
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
    session: s?.session ?? null,
    reconcile: s?.reconcile ?? null,
  };
}

function save(s: SnackStore) {
  writeJson(FILE, s);
}

/** Live elapsed seconds for a session (carry + current run). */
function sessionElapsed(sess: SnackSession): number {
  return sess.carrySec + (sess.startedAt ? (Date.now() - Date.parse(sess.startedAt)) / 1000 : 0);
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
  const session = s.session && s.session.date === d ? s.session : null;
  return { date: d, target: s.target, completed: s.days[d] ?? [], lastMealAt: lastMealAtToday(d), session };
}

// ── live timer session ───────────────────────────────────────────────────────

/** Begin (or resume) the timer. Carries over any leftover partial from a stopped
 *  session earlier today. The 5-second lead-in countdown is client-side; this is
 *  called when it finishes, so wall-clock starts here. */
export function startSnackSession(): SnackDayState {
  const s = load();
  const d = localDateStr();
  const prev = s.session && s.session.date === d && !s.session.startedAt ? s.session : null;
  s.session = { startedAt: new Date().toISOString(), carrySec: prev?.carrySec ?? 0, date: d };
  save(s);
  return getSnackDay(d);
}

/** Stop the timer and commit whole minutes as `timer` snacks. Manual stops trim
 *  STOP_GRACE_SEC and keep the leftover partial for next time; auto-stops cap at
 *  AUTOSTOP_SEC and queue an HR reconcile. */
export function stopSnackSession(opts?: { auto?: boolean }): SnackDayState {
  const s = load();
  const d = localDateStr();
  const sess = s.session && s.session.date === d ? s.session : null;
  if (!sess || !sess.startedAt) {
    // clear any stale (cross-day) session so a new day starts clean
    if (s.session && s.session.date !== d) {
      s.session = null;
      save(s);
    }
    return getSnackDay(d);
  }

  const now = Date.now();
  let elapsed = sessionElapsed(sess);
  let committedMin: number;
  let carry: number;
  if (opts?.auto) {
    elapsed = Math.min(elapsed, AUTOSTOP_SEC);
    committedMin = Math.floor(elapsed / 60);
    carry = 0;
  } else {
    const eff = Math.max(0, elapsed - STOP_GRACE_SEC);
    committedMin = Math.floor(eff / 60);
    // Keep the partial minute as carry so progress continues next time (the
    // partial circle keeps its ring and gets its own HR pill, resolved below).
    carry = Math.round(eff - committedMin * 60);
  }

  const arr = s.days[d] ?? [];
  const committedIds: string[] = [];
  for (let i = 0; i < committedMin; i++) {
    // Spread each committed minute back from `now`, ~1 min apart, so the HR pill
    // resolves each against roughly when it happened.
    const id = newId();
    committedIds.push(id);
    arr.push({ id, at: new Date(now - (committedMin - 1 - i) * 60000).toISOString(), source: "timer" });
  }
  s.days[d] = arr;
  s.session = {
    startedAt: null,
    carrySec: carry,
    date: d,
    partialAt: carry > 0 ? new Date(now).toISOString() : null,
    // partialMaxHr left undefined → pending resolution (resolveSnackDay).
  };
  s.reconcile = opts?.auto && committedIds.length
    ? { date: d, startedAt: sess.startedAt, stoppedAt: new Date(now).toISOString(), entryIds: committedIds }
    : s.reconcile;
  save(s);
  return getSnackDay(d);
}

/** Auto-stop a session that has run past the cap (or was left over from a prior
 *  day). Returns true if it stopped one. */
function maybeAutoStop(d: string): boolean {
  const s = load();
  if (!s.session) return false;
  if (s.session.date !== d) {
    // leftover from a previous day — discard without crediting today
    s.session = null;
    save(s);
    return true;
  }
  if (s.session.startedAt && sessionElapsed(s.session) >= AUTOSTOP_SEC) {
    stopSnackSession({ auto: true });
    return true;
  }
  return false;
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
  return getSnackDay(d);
}

/** For a forgotten session that auto-stopped at the 15-min cap, use the synced
 *  intraday HR to find when the user actually stopped (HR falls back toward
 *  resting) and remove any timer minutes credited after that. Conservative: only
 *  runs once HR has synced through the auto-stop time; only trims, never adds;
 *  gives up after 2h. Never throws. */
async function reconcileAutoStop(d: string): Promise<void> {
  const s = load();
  const rec = s.reconcile;
  if (!rec || rec.date !== d) return;
  const now = Date.now();
  if (now - Date.parse(rec.stoppedAt) > HR_GIVEUP_MS) {
    s.reconcile = null;
    save(s);
    return;
  }
  let windows: { start: number; end: number; max: number }[] = [];
  let rhr: number | null = null;
  try {
    const { isConnected, fetchHeartMaxWindows } = await import("./googlehealth");
    if (!isConnected()) return;
    windows = await fetchHeartMaxWindows(d, 180);
    const { getDay } = await import("./context");
    rhr = (await getDay(d)).day.restingHeartRate ?? null;
  } catch {
    return;
  }
  if (!windows.length) return;
  const startMs = Date.parse(rec.startedAt);
  const stopMs = Date.parse(rec.stoppedAt);
  // Wait until HR has actually synced through the auto-stop window.
  if (Math.max(...windows.map((w) => w.end)) < stopMs) return;

  const threshold = Math.max((rhr ?? 70) + 25, 100); // "still exercising"
  const elevated = windows.filter((w) => w.end > startMs && w.max >= threshold);
  // Real stop = end of the last elevated window (HR has since dropped). If HR
  // never read elevated, fall back to keeping it as-is (don't nuke everything).
  const realStopMs = elevated.length ? Math.max(...elevated.map((w) => w.end)) : stopMs;

  const fresh = load();
  const arr = fresh.days[d] ?? [];
  let changed = false;
  for (const id of rec.entryIds) {
    const idx = arr.findIndex((e) => e.id === id);
    if (idx >= 0 && Date.parse(arr[idx].at) > realStopMs + 60_000) {
      arr.splice(idx, 1);
      changed = true;
    }
  }
  fresh.days[d] = arr;
  fresh.reconcile = null; // HR available → reconciled (once)
  save(fresh);
  if (!changed) return;
}

/** Resolve the carried partial circle's HR post-hoc — same lookback as a snack's
 *  pill, anchored at the stop time. Lets the partial show its max HR even though
 *  it isn't a committed minute. Never throws. */
async function resolvePartialHr(d: string): Promise<void> {
  const s = load();
  const sess = s.session;
  if (!sess || sess.date !== d || sess.startedAt || sess.carrySec <= 0) return;
  if (!sess.partialAt || sess.partialMaxHr !== undefined) return; // not pending
  const now = Date.now();
  const t = Date.parse(sess.partialAt);
  if (now - t >= HR_GIVEUP_MS) {
    sess.partialMaxHr = null;
    save(s);
    return;
  }
  let windows: { start: number; end: number; max: number }[] = [];
  try {
    const { isConnected, fetchHeartMaxWindows } = await import("./googlehealth");
    if (!isConnected()) return;
    if (hrCache && hrCache.date === d && now - hrCache.at < 60_000) windows = hrCache.windows;
    else {
      windows = await fetchHeartMaxWindows(d, 180);
      hrCache = { date: d, at: now, windows };
    }
  } catch {
    return;
  }
  const hits = windows.filter((w) => w.end > t - HR_LOOKBACK_MS && w.start < t + HR_FORWARD_MS).map((w) => w.max);
  if (hits.length) {
    const fresh = load();
    if (fresh.session && fresh.session.partialAt === sess.partialAt) {
      fresh.session.partialMaxHr = Math.max(...hits);
      save(fresh);
    }
  }
}

/** GET-path resolver: handle session auto-stop, fill HR pills (snacks + the
 *  partial circle), and reconcile a forgotten session against HR. */
export async function resolveSnackDay(date?: string): Promise<SnackDayState> {
  const d = isDate(date) ? date : localDateStr();
  maybeAutoStop(d);
  await resolveSnackHr(d);
  try {
    await reconcileAutoStop(d);
  } catch {
    // reconcile is best-effort
  }
  try {
    await resolvePartialHr(d);
  } catch {
    // partial HR is best-effort
  }
  return getSnackDay(d);
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
