// Dynamic, user-set reminders — the ad-hoc counterpart to the time-anchored
// medication reminders. The user asks the coach in natural language ("remind me
// in an hour to eat", "every day at 6pm tell me to walk") and the model resolves
// the time into a structured spec we store here. A single idempotent firing pass
// (fireDueReminders) is shared by the scheduler tick (push → Telegram) and the
// web coach poll (in-app bubble), so a due reminder lands in BOTH places exactly
// once. Unlike med reminders these NEVER respect quiet hours — the user named
// the time deliberately (the coach flags a quiet-hours overlap when setting).

import { readJson, writeJson, newId, APP_TZ } from "./store";
import { localNowParts } from "./medication-reminders";
import { getMedicationSettings } from "./medication-settings";
import { sendOwnerMessage } from "./proactive/channels/telegram";
import { escapeHtml } from "./telegram/bot";

const FILE = "reminders/reminders.json";
// Don't fire a recurring slot more than this long after its time (e.g. the app
// was offline all evening) — surface it at its time, not hours late next tick.
const STALE_MAX_MIN = 180;
// How far back the web feed looks for "just fired" reminders to surface in chat.
const FEED_WINDOW_MS = 15 * 60 * 1000;

export type ReminderKind = "once" | "daily" | "weekly";

export interface ReminderRecord {
  id: string;
  text: string; // what to remind ("eat something", "go for a walk")
  kind: ReminderKind;
  dueAt?: string; // ISO local-ish timestamp — for kind "once"
  atTime?: string; // "HH:mm" local — for daily/weekly
  days?: number[]; // 0=Sun..6=Sat — for weekly
  createdAt: string;
  active: boolean;
  firedAt?: string; // ISO of the most recent firing
  lastFiredDate?: string; // yyyy-MM-dd local — per-day dedup for recurring
}

export interface FiredReminder {
  id: string;
  text: string;
  firedAt: string;
}

function readAll(): ReminderRecord[] {
  return readJson<ReminderRecord[]>(FILE, []);
}
function writeAll(list: ReminderRecord[]) {
  writeJson(FILE, list);
}

/** Local day-of-week (0=Sun..6=Sat) in APP_TZ. */
function localDow(d = new Date()): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── create / cancel ───────────────────────────────────────────────────────────

export interface SetReminderInput {
  text: string;
  kind: ReminderKind;
  dueAt?: string;
  atTime?: string;
  days?: number[];
}

/** Validate + persist a new reminder. Throws on malformed input. */
export function createReminder(input: SetReminderInput): ReminderRecord {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("reminder needs text");
  const kind: ReminderKind =
    input.kind === "daily" || input.kind === "weekly" ? input.kind : "once";

  const rec: ReminderRecord = {
    id: newId(),
    text,
    kind,
    createdAt: new Date().toISOString(),
    active: true,
  };

  if (kind === "once") {
    const ms = Date.parse(String(input.dueAt ?? ""));
    if (!Number.isFinite(ms)) throw new Error("once reminder needs a valid dueAt");
    rec.dueAt = new Date(ms).toISOString();
  } else {
    const t = String(input.atTime ?? "");
    if (!/^\d{1,2}:\d{2}$/.test(t)) throw new Error("recurring reminder needs atTime HH:mm");
    const min = timeToMin(t);
    if (min < 0 || min > 24 * 60) throw new Error("bad atTime");
    rec.atTime = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    if (kind === "weekly") {
      const days = Array.isArray(input.days)
        ? [...new Set(input.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort()
        : [];
      if (!days.length) throw new Error("weekly reminder needs days");
      rec.days = days;
    }
  }

  const list = readAll();
  list.push(rec);
  writeAll(list);
  return rec;
}

/** Cancel by exact id or, failing that, the single active reminder whose text
 *  loosely matches. Returns the cancelled record, or null if nothing matched. */
export function cancelReminder(idOrMatch: string): ReminderRecord | null {
  const key = String(idOrMatch ?? "").trim();
  if (!key) return null;
  const list = readAll();

  let target = list.find((r) => r.active && r.id === key);
  if (!target) {
    const needle = key.toLowerCase();
    const matches = list.filter((r) => r.active && r.text.toLowerCase().includes(needle));
    if (matches.length === 1) target = matches[0];
  }
  if (!target) return null;
  target.active = false;
  writeAll(list);
  return target;
}

/** Active reminders, soonest-relevant first (for the coach context block). */
export function listActiveReminders(): ReminderRecord[] {
  return readAll().filter((r) => r.active);
}

// ── firing (shared by scheduler tick + web feed) ──────────────────────────────

/** One idempotent firing pass: marks due reminders fired (persisted BEFORE the
 *  Telegram send so a crash can't double-fire), pushes them to the owner's
 *  Telegram, and returns what fired so the web caller can surface it in chat. */
export async function fireDueReminders(now = new Date()): Promise<FiredReminder[]> {
  const list = readAll();
  if (!list.some((r) => r.active)) return [];

  const { date, nowMin } = localNowParts(now);
  const nowMs = now.getTime();
  const dow = localDow(now);
  const fired: FiredReminder[] = [];
  let changed = false;

  for (const r of list) {
    if (!r.active) continue;

    if (r.kind === "once") {
      if (!r.dueAt || Date.parse(r.dueAt) > nowMs) continue;
      r.firedAt = new Date(nowMs).toISOString();
      r.active = false;
      changed = true;
      fired.push({ id: r.id, text: r.text, firedAt: r.firedAt });
      continue;
    }

    // recurring (daily / weekly)
    if (!r.atTime) continue;
    if (r.lastFiredDate === date) continue; // already fired today
    if (r.kind === "weekly" && !(r.days ?? []).includes(dow)) continue; // not a scheduled day
    const slot = timeToMin(r.atTime);
    if (nowMin < slot) continue; // not yet
    if (nowMin - slot > STALE_MAX_MIN) {
      // Too late to be useful — mark today done so it doesn't fire hours off-time.
      r.lastFiredDate = date;
      changed = true;
      continue;
    }
    r.lastFiredDate = date;
    r.firedAt = new Date(nowMs).toISOString();
    changed = true;
    fired.push({ id: r.id, text: r.text, firedAt: r.firedAt });
  }

  if (changed) writeAll(list);

  for (const f of fired) {
    await sendOwnerMessage(`🔔 <b>Reminder</b> — ${escapeHtml(f.text)}`).catch(() => false);
  }
  return fired;
}

/** Reminders that fired within the recent window — what the web coach poll
 *  surfaces as chat bubbles (deduped client-side by id+firedAt). */
export function recentlyFired(now = new Date()): FiredReminder[] {
  const cutoff = now.getTime() - FEED_WINDOW_MS;
  return readAll()
    .filter((r) => r.firedAt && Date.parse(r.firedAt) >= cutoff)
    .map((r) => ({ id: r.id, text: r.text, firedAt: r.firedAt! }));
}

// ── coach context block ───────────────────────────────────────────────────────

const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeSchedule(r: ReminderRecord): string {
  if (r.kind === "once") {
    const d = r.dueAt ? new Date(r.dueAt) : null;
    if (!d) return "once";
    const when = new Intl.DateTimeFormat("en-GB", {
      timeZone: APP_TZ,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `once · ${when}`;
  }
  if (r.kind === "daily") return `daily · ${r.atTime}`;
  const days = (r.days ?? []).map((d) => DOW_LABEL[d]).join("/");
  return `weekly · ${days} · ${r.atTime}`;
}

/** The "== Reminders (active) ==" context block, or null when there are none.
 *  Also states the quiet-hours window so the coach can flag an overlap when the
 *  user sets a new reminder. */
export function remindersContextBlock(): string | null {
  const active = listActiveReminders();
  const s = getMedicationSettings();
  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const quiet = `Quiet hours: ${fmt(s.quietStartMin)}–${fmt(s.quietEndMin)} (local).`;

  if (!active.length) {
    return [
      "== Reminders (active) ==",
      "(none set)",
      `${quiet} Reminders fire regardless of quiet hours; if a NEW reminder's time falls inside this window, mention it and confirm the user still wants it then.`,
    ].join("\n");
  }

  const lines = ["== Reminders (active) =="];
  for (const r of active) lines.push(`• [${r.id}] ${r.text} — ${describeSchedule(r)}`);
  lines.push(`cancelReminder ids: ${active.map((r) => r.id).join(", ")}`);
  lines.push(
    `${quiet} Reminders fire regardless of quiet hours; if a NEW reminder's time falls inside this window, mention it and confirm the user still wants it then.`
  );
  return lines.join("\n");
}
