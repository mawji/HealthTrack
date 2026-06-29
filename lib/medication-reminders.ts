// Time-anchored medication reminders. UNLIKE the proactive guidance engine
// (anti-nag: daily cap, min-gap, "only when behind pace"), a med reminder is a
// scheduled obligation: it fires at the dose time (and optional lead times) and,
// for CRITICAL meds, re-nudges until the dose is marked taken — bypassing quiet
// hours. It reuses the Telegram owner channel + the scheduler PROCESS, but none
// of the nudge guardrails. See plans/medications-tracking.md.

import { readJson, writeJson, APP_TZ } from "./store";
import { MedicationDefinition, MedicationRecord } from "./types";
import {
  getMedications,
  getMedicationRecords,
  scheduledOn,
  doseLabel,
} from "./medications";
import {
  getMedicationSettings,
  inMedQuietHours,
} from "./medication-settings";
import { sendOwnerMessage } from "./proactive/channels/telegram";
import { escapeHtml } from "./telegram/bot";

const LOG_FILE = "medications/reminder-log.json";
const STALE_MAX_MIN = 90; // don't fire a slot more than this long after it was due

type SentEntry = { key: string; at: string };

export type ReminderKind = "lead" | "due" | "renudge";

export interface DueReminder {
  medicationId: string;
  medName: string;
  doseIndex: number;
  time: string; // "HH:mm" the dose is scheduled for
  kind: ReminderKind;
  leadMin?: number; // for kind "lead"
  renudgeNum?: number; // for kind "renudge"
  critical: boolean;
  key: string; // dedup key
  /** Keys superseded by this firing (older eligible slots, marked sent too). */
  supersedes: string[];
}

// ── local clock ────────────────────────────────────────────────────────────

/** Local yyyy-MM-dd + minutes-since-midnight in APP_TZ. */
export function localNowParts(d = new Date()): { date: string; nowMin: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some engines emit "24" at midnight
  return { date, nowMin: hour * 60 + Number(get("minute")) };
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── dedup log ───────────────────────────────────────────────────────────────

function readLog(): SentEntry[] {
  return readJson<SentEntry[]>(LOG_FILE, []);
}

/** Keep only today's + yesterday's entries (reminders are per-day). */
function pruneLog(entries: SentEntry[], today: string): SentEntry[] {
  const yesterday = new Date(today + "T12:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const cutoff = yesterday.toISOString().slice(0, 10);
  return entries.filter((e) => e.key.split("|")[0] >= cutoff);
}

function markSent(keys: string[], today: string) {
  const now = new Date().toISOString();
  const entries = pruneLog(readLog(), today);
  const have = new Set(entries.map((e) => e.key));
  for (const k of keys) if (!have.has(k)) entries.push({ key: k, at: now });
  writeJson(LOG_FILE, entries);
}

// ── due-reminder computation (pure given its inputs) ─────────────────────────

interface Slot {
  slotMin: number;
  kind: ReminderKind;
  leadMin?: number;
  renudgeNum?: number;
}

/** Build the ordered reminder slots for one timed dose. */
function slotsForDose(med: MedicationDefinition, timeMin: number, settings = getMedicationSettings()): Slot[] {
  const slots: Slot[] = [];
  for (const L of med.reminders.leadMinutes) {
    if (L > 0) slots.push({ slotMin: timeMin - L, kind: "lead", leadMin: L });
  }
  slots.push({ slotMin: timeMin, kind: "due" });
  if (med.critical) {
    for (let n = 1; n <= settings.maxRenudges; n++) {
      slots.push({ slotMin: timeMin + settings.renudgeMinutes * n, kind: "renudge", renudgeNum: n });
    }
  }
  return slots;
}

/**
 * Which reminders are due to fire right now? Returns at most ONE reminder per
 * pending timed dose (the most current eligible slot), with the older eligible
 * slots listed in `supersedes` so the caller marks them sent too (no back-fill).
 */
export function computeDueReminders(
  meds: MedicationDefinition[],
  records: MedicationRecord[],
  today: string,
  nowMin: number,
  sentKeys: Set<string>
): DueReminder[] {
  const settings = getMedicationSettings();
  if (!settings.remindersEnabled) return [];
  const out: DueReminder[] = [];

  for (const med of meds) {
    if (!med.active || !med.reminders.enabled) continue;
    if (!scheduledOn(med, today)) continue;
    // Quiet-hours gate (by current local time). Critical may bypass.
    if (inMedQuietHours(nowMin, settings) && !(med.critical && settings.criticalBypassQuietHours)) {
      continue;
    }

    med.schedule.times.forEach((time, doseIndex) => {
      const rec = records.find(
        (r) => r.medicationId === med.id && r.date === today && r.doseIndex === doseIndex
      );
      if (rec) return; // already taken or skipped → no reminders for this dose

      const timeMin = timeToMin(time);
      const slots = slotsForDose(med, timeMin, settings);

      const eligible = slots
        .map((s) => ({
          ...s,
          key: `${today}|${med.id}|${doseIndex}|${s.kind}${s.leadMin ? "-" + s.leadMin : ""}${s.renudgeNum ? "-" + s.renudgeNum : ""}`,
        }))
        .filter((s) => s.slotMin <= nowMin && nowMin - s.slotMin < STALE_MAX_MIN && !sentKeys.has(s.key));
      if (!eligible.length) return;

      eligible.sort((a, b) => a.slotMin - b.slotMin);
      const chosen = eligible[eligible.length - 1];
      const superseded = eligible.slice(0, -1).map((s) => s.key);

      out.push({
        medicationId: med.id,
        medName: med.name,
        doseIndex,
        time,
        kind: chosen.kind,
        leadMin: chosen.leadMin,
        renudgeNum: chosen.renudgeNum,
        critical: med.critical,
        key: chosen.key,
        supersedes: superseded,
      });
    });
  }
  return out;
}

// ── message + delivery ───────────────────────────────────────────────────────

export function reminderMessage(med: MedicationDefinition, r: DueReminder): string {
  const amount = doseLabel(med);
  const what = `<b>${escapeHtml(med.name)}</b>${amount ? " — " + escapeHtml(amount) : ""}`;
  const withFood = med.withFood ? " (with food)" : "";
  if (r.kind === "lead") {
    return `💊 ${what} in ${r.leadMin} min — due at ${r.time}${withFood}.`;
  }
  if (r.kind === "renudge") {
    return `⚠️ Still not marked taken: ${what} was due at ${r.time}${withFood}. ${med.critical ? "This one matters — please don't skip it." : ""}`.trim();
  }
  // due
  return `💊 Time for ${what} — ${r.time}${withFood}.${med.critical ? " Don't miss this one." : ""}`;
}

export interface ReminderTickResult {
  enabled: boolean;
  due: number;
  sent: number;
  delivered: boolean;
}

/**
 * One reminder tick: compute due reminders, deliver them to the owner's
 * Telegram, and record what was sent (incl. superseded slots). Called by the
 * scheduler (and the secret-gated /api/medications/tick route).
 */
export async function runMedicationReminderTick(): Promise<ReminderTickResult> {
  const { date, nowMin } = localNowParts();
  const settings = getMedicationSettings();
  if (!settings.remindersEnabled) return { enabled: false, due: 0, sent: 0, delivered: false };

  const meds = getMedications();
  const records = getMedicationRecords();
  const sentKeys = new Set(readLog().map((e) => e.key));
  const due = computeDueReminders(meds, records, date, nowMin, sentKeys);
  if (!due.length) return { enabled: true, due: 0, sent: 0, delivered: false };

  const byId = new Map(meds.map((m) => [m.id, m]));
  let sent = 0;
  let delivered = false;
  for (const r of due) {
    const med = byId.get(r.medicationId);
    if (!med) continue;
    const ok = await sendOwnerMessage(reminderMessage(med, r)).catch(() => false);
    // Mark sent regardless of delivery success: a failed Telegram send (unpaired)
    // shouldn't cause an endless retry loop; the Daily card still surfaces it.
    markSent([r.key, ...r.supersedes], date);
    if (ok) {
      sent++;
      delivered = true;
    }
  }
  return { enabled: true, due: due.length, sent, delivered };
}

/** Critical doses that were scheduled earlier today but are still not taken —
 *  surfaced in the daily report. */
export function missedCriticalToday(): { name: string; time: string }[] {
  const { date, nowMin } = localNowParts();
  const records = getMedicationRecords();
  const out: { name: string; time: string }[] = [];
  for (const med of getMedications()) {
    if (!med.active || !med.critical || !scheduledOn(med, date)) continue;
    med.schedule.times.forEach((time, doseIndex) => {
      const [h, m] = time.split(":").map(Number);
      if (h * 60 + m >= nowMin) return; // not due yet
      const rec = records.find(
        (r) => r.medicationId === med.id && r.date === date && r.doseIndex === doseIndex
      );
      if (rec?.status === "taken") return;
      out.push({ name: med.name, time });
    });
  }
  return out;
}
