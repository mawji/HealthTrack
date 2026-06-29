// Local persistence, validation, and adherence math for medications &
// supplements. Route handlers stay thin and call into here. Medications NEVER
// sync to Google Health (the v4 API has no medication type) and are excluded
// from every cloud/social aggregate — they live only in data/medications.json +
// data/medication-records.json. Mirrors lib/habits.ts. See
// plans/medications-tracking.md.

import fs from "fs";
import { readJson, writeJson, dataPath, newId, localDateStr } from "./store";
import {
  MedicationDefinition,
  MedicationRecord,
  MedicationKind,
  MedicationFrequency,
  MedicationSchedule,
  MedicationDayStatus,
  MedicationDoseStatus,
  MedicationIngredient,
} from "./types";
import { DEFAULT_MED_SETTINGS, getMedicationSettings } from "./medication-settings";

const MEDS = "medications.json";
const RECORDS = "medication-records.json";

const KINDS: MedicationKind[] = ["medication", "supplement"];
const FREQS: MedicationFrequency[] = ["daily", "specific_days", "as_needed"];

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

/** Normalize a "HH:mm" string to a zero-padded 24h value, or undefined. */
function normTime(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Normalize an untrusted ingredients array → [{name, strength?}] (max 6),
 *  dropping entries without a name. Returns undefined when empty. */
function sanitizeIngredients(raw: unknown): MedicationIngredient[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MedicationIngredient[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const name = str((item as any).name, 80);
    if (!name) continue;
    out.push({ name, strength: str((item as any).strength, 40) });
  }
  return out.length ? out : undefined;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "med"
  );
}

// ── definitions ────────────────────────────────────────────────────────────

function sortMeds(meds: MedicationDefinition[]): MedicationDefinition[] {
  const N = meds.length;
  return meds
    .map((m, i) => ({ m, key: m.sortOrder ?? N + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.m);
}

export function getMedications(): MedicationDefinition[] {
  if (!fs.existsSync(dataPath(MEDS))) return [];
  return sortMeds(readJson<MedicationDefinition[]>(MEDS, []));
}

export function saveMedications(meds: MedicationDefinition[]) {
  writeJson(MEDS, meds);
}

function sanitizeSchedule(raw: unknown, existing?: MedicationSchedule): MedicationSchedule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const frequency: MedicationFrequency = FREQS.includes(r.frequency as MedicationFrequency)
    ? (r.frequency as MedicationFrequency)
    : existing?.frequency ?? "daily";

  let daysOfWeek = existing?.daysOfWeek;
  if (Array.isArray(r.daysOfWeek)) {
    daysOfWeek = [...new Set(r.daysOfWeek.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))].sort();
  }

  let times = existing?.times ?? [];
  if (Array.isArray(r.times)) {
    times = [...new Set(r.times.map(normTime).filter((t): t is string => !!t))].sort();
  }
  // as_needed carries no scheduled times.
  if (frequency === "as_needed") times = [];

  return { frequency, times, ...(frequency === "specific_days" ? { daysOfWeek: daysOfWeek ?? [] } : {}) };
}

/** Validate and normalize an untrusted create/update body into a definition. */
export function sanitizeMedication(
  raw: unknown,
  existing?: MedicationDefinition
): MedicationDefinition | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid body" };
  const r = raw as Record<string, unknown>;
  const now = new Date().toISOString();

  const name = str(r.name, 80) ?? existing?.name;
  if (!name) return { error: "name is required" };

  const kind: MedicationKind = KINDS.includes(r.kind as MedicationKind)
    ? (r.kind as MedicationKind)
    : existing?.kind ?? "medication";

  // Reminder settings: enabled + lead minutes (sanitized, deduped, sorted desc).
  const remRaw = (r.reminders ?? {}) as Record<string, unknown>;
  let leadMinutes = existing?.reminders?.leadMinutes ?? DEFAULT_MED_SETTINGS.defaultLeadMinutes;
  if (Array.isArray(remRaw.leadMinutes)) {
    leadMinutes = [
      ...new Set(remRaw.leadMinutes.map((m) => Math.max(0, Math.min(720, Math.round(Number(m))))).filter((m) => Number.isFinite(m))),
    ].sort((a, b) => b - a);
  }
  if (!leadMinutes.length) leadMinutes = [0];

  const def: MedicationDefinition = {
    id: existing?.id ?? "",
    name,
    kind,
    strength: str(r.strength, 60) ?? existing?.strength,
    ingredients: "ingredients" in r ? sanitizeIngredients(r.ingredients) : existing?.ingredients,
    quantity: "quantity" in r ? num(r.quantity) : existing?.quantity,
    unit: str(r.unit, 24) ?? existing?.unit,
    form: str(r.form, 40) ?? existing?.form,
    nickname: "nickname" in r ? str(r.nickname, 4)?.toUpperCase() : existing?.nickname,
    withFood: bool(r.withFood, existing?.withFood ?? false),
    notes: str(r.notes, 400) ?? existing?.notes,
    schedule: sanitizeSchedule(r.schedule, existing?.schedule),
    critical: bool(r.critical, existing?.critical ?? false),
    reminders: {
      enabled: bool(remRaw.enabled, existing?.reminders?.enabled ?? true),
      leadMinutes,
    },
    info: existing?.info, // info is managed only by the info generator route
    inventory: existing?.inventory, // inventory is managed only by the inventory route
    active: bool(r.active, existing?.active ?? true),
    sortOrder: existing?.sortOrder,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return def;
}

/** Assign a stable, unique id derived from the name. */
export function nextMedicationId(name: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return newId();
}

// ── records ──────────────────────────────────────────────────────────────

export function getMedicationRecords(): MedicationRecord[] {
  return readJson<MedicationRecord[]>(RECORDS, []);
}

export function saveMedicationRecords(records: MedicationRecord[]) {
  writeJson(RECORDS, records);
}

/** Create / replace / clear the record for (medicationId, date, doseIndex).
 *  status=null clears any existing record (un-check). Idempotent. */
export function upsertMedicationRecord(input: {
  medicationId: string;
  date: string;
  doseIndex?: number;
  status: "taken" | "skipped" | null;
  note?: string;
}): MedicationRecord | null {
  const med = getMedications().find((m) => m.id === input.medicationId);
  if (!med) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDateStr();
  const doseIndex = Math.max(0, Math.round(Number(input.doseIndex) || 0));
  const records = getMedicationRecords();
  const idx = records.findIndex(
    (r) => r.medicationId === input.medicationId && r.date === date && r.doseIndex === doseIndex
  );
  const prevStatus = idx >= 0 ? records[idx].status : null;

  if (input.status == null) {
    if (idx >= 0) {
      records.splice(idx, 1);
      saveMedicationRecords(records);
    }
    adjustMedicationInventory(med.id, prevStatus, null);
    return null;
  }

  const now = new Date().toISOString();
  let result: MedicationRecord;
  if (idx >= 0) {
    records[idx] = {
      ...records[idx],
      status: input.status,
      takenAt: input.status === "taken" ? now : undefined,
      note: str(input.note, 280),
    };
    saveMedicationRecords(records);
    result = records[idx];
  } else {
    result = {
      id: newId(),
      medicationId: input.medicationId,
      date,
      doseIndex,
      status: input.status,
      takenAt: input.status === "taken" ? now : undefined,
      note: str(input.note, 280),
    };
    records.push(result);
    saveMedicationRecords(records);
  }
  adjustMedicationInventory(med.id, prevStatus, input.status);
  return result;
}

// ── inventory ──────────────────────────────────────────────────────────────

/** Adjust a med's supply on a taken-status transition (deduct one dose's worth
 *  when it becomes taken; add it back when un-taken). No-op when inventory
 *  tracking is off or the med has no inventory set. */
function adjustMedicationInventory(
  medId: string,
  prev: "taken" | "skipped" | null,
  next: "taken" | "skipped" | null
) {
  if (!getMedicationSettings().inventoryEnabled) return;
  let delta = 0;
  if (prev !== "taken" && next === "taken") delta = -1;
  else if (prev === "taken" && next !== "taken") delta = +1;
  if (delta === 0) return;

  const meds = getMedications();
  const i = meds.findIndex((m) => m.id === medId);
  if (i < 0 || !meds[i].inventory) return;
  const perDose = meds[i].quantity ?? 1;
  const units = Math.max(0, Math.round((meds[i].inventory!.units + delta * perDose) * 100) / 100);
  meds[i] = { ...meds[i], inventory: { units, updatedAt: new Date().toISOString() } };
  saveMedications(meds);
}

/** Set (or clear, with null) a med's supply on hand. */
export function setMedicationInventory(id: string, units: number | null): MedicationDefinition | null {
  const meds = getMedications();
  const i = meds.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const now = new Date().toISOString();
  meds[i] = {
    ...meds[i],
    inventory: units == null ? undefined : { units: Math.max(0, Math.round(units * 100) / 100), updatedAt: now },
    updatedAt: now,
  };
  saveMedications(meds);
  return meds[i];
}

/** Average units consumed per day from the schedule (null when unknowable, e.g.
 *  as_needed). Used to convert remaining units → days of supply. */
export function avgDailyUnits(med: MedicationDefinition): number | null {
  const q = med.quantity ?? 1;
  const s = med.schedule;
  if (s.frequency === "as_needed") return null;
  const dosesPerDay = s.times.length || 1;
  if (s.frequency === "specific_days") {
    const dpw = (s.daysOfWeek ?? []).length;
    if (!dpw) return null;
    return (dosesPerDay * q * dpw) / 7;
  }
  return dosesPerDay * q;
}

/** Whole days of supply remaining, or null when not tracked / unknowable. */
export function daysRemaining(med: MedicationDefinition): number | null {
  if (!med.inventory) return null;
  const per = avgDailyUnits(med);
  if (!per || per <= 0) return null;
  return med.inventory.units / per;
}

export interface LowStockMed {
  id: string;
  name: string;
  units: number;
  daysRemaining: number | null;
}

/** Active meds whose supply is down to ≤ 7 days (when inventory tracking is on). */
export function lowStockMeds(): LowStockMed[] {
  if (!getMedicationSettings().inventoryEnabled) return [];
  return getMedications()
    .filter((m) => m.active && m.inventory)
    .map((m) => ({ id: m.id, name: m.name, units: m.inventory!.units, daysRemaining: daysRemaining(m) }))
    .filter((x) => x.daysRemaining != null && x.daysRemaining <= 7);
}

export function deleteMedicationRecord(id: string): boolean {
  const records = getMedicationRecords();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  saveMedicationRecords(next);
  return true;
}

// ── scheduling + adherence ───────────────────────────────────────────────

/** Weekday (0=Sun..6=Sat) for a yyyy-MM-dd date, in a TZ-stable way. */
function weekday(date: string): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

/** Is this med scheduled on `date`? as_needed is never a scheduled obligation. */
export function scheduledOn(med: MedicationDefinition, date: string): boolean {
  const s = med.schedule;
  if (s.frequency === "as_needed") return false;
  if (s.frequency === "specific_days") return (s.daysOfWeek ?? []).includes(weekday(date));
  return true; // daily
}

/** The dose slots for `date`: each scheduled time → a (doseIndex, time). A
 *  scheduled med with no explicit times yields a single untimed dose. */
export function dosesForDay(med: MedicationDefinition, date: string): { doseIndex: number; time: string | null }[] {
  if (!scheduledOn(med, date)) return [];
  const times = med.schedule.times;
  if (!times.length) return [{ doseIndex: 0, time: null }];
  return times.map((time, doseIndex) => ({ doseIndex, time }));
}

function prevDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Trailing-N-day adherence %: taken ÷ scheduled doses, ignoring as_needed.
 *  Returns null when nothing was scheduled in the window. */
export function adherencePct(
  med: MedicationDefinition,
  records: MedicationRecord[],
  date: string,
  days = 7
): number | null {
  if (med.schedule.frequency === "as_needed") return null;
  let scheduled = 0;
  let taken = 0;
  let cursor = date;
  for (let i = 0; i < days; i++) {
    const slots = dosesForDay(med, cursor);
    scheduled += slots.length;
    for (const slot of slots) {
      const rec = records.find(
        (r) => r.medicationId === med.id && r.date === cursor && r.doseIndex === slot.doseIndex
      );
      if (rec?.status === "taken") taken++;
    }
    cursor = prevDate(cursor);
  }
  if (scheduled === 0) return null;
  return Math.round((taken / scheduled) * 100);
}

/** Minutes since local midnight for a "HH:mm" time. */
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Full computed status for a med on `date`. `nowMin` is the local minutes-of-day
 *  used to decide overdue (only meaningful when date === today). */
export function computeMedicationStatus(
  med: MedicationDefinition,
  records: MedicationRecord[],
  date: string,
  today: string,
  nowMin: number
): MedicationDayStatus {
  const asNeeded = med.schedule.frequency === "as_needed";
  const slots = dosesForDay(med, date);
  const isToday = date === today;

  const doses: MedicationDoseStatus[] = slots.map((slot) => {
    const rec = records.find(
      (r) => r.medicationId === med.id && r.date === date && r.doseIndex === slot.doseIndex
    );
    const status = rec?.status ?? null;
    const overdue =
      isToday && status == null && slot.time != null && timeToMin(slot.time) < nowMin;
    return { doseIndex: slot.doseIndex, time: slot.time, status, overdue };
  });

  // as_needed: surface any taken/skipped logs for the day as informational doses.
  if (asNeeded) {
    for (const rec of records.filter((r) => r.medicationId === med.id && r.date === date)) {
      doses.push({ doseIndex: rec.doseIndex, time: null, status: rec.status, overdue: false });
    }
  }

  const takenCount = doses.filter((d) => d.status === "taken").length;
  return {
    medicationId: med.id,
    date,
    scheduledToday: scheduledOn(med, date),
    asNeeded,
    doses,
    takenCount,
    scheduledCount: slots.length,
    adherence7d: adherencePct(med, records, date, 7),
  };
}

// ── coach formatting ───────────────────────────────────────────────────────

/** Short "1 tablet (5 mg)" style amount label. */
export function doseLabel(med: MedicationDefinition): string {
  const parts: string[] = [];
  if (med.quantity != null) parts.push(`${med.quantity}${med.unit ? " " + med.unit : ""}`);
  else if (med.unit) parts.push(med.unit);
  if (med.strength) parts.push(`(${med.strength})`);
  return parts.join(" ").trim();
}

/** Human schedule summary, e.g. "daily at 08:00, 22:00" / "Mon, Thu" / "as needed". */
export function scheduleLabel(med: MedicationDefinition): string {
  const s = med.schedule;
  if (s.frequency === "as_needed") return "as needed";
  const times = s.times.length ? ` at ${s.times.join(", ")}` : "";
  if (s.frequency === "specific_days") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (s.daysOfWeek ?? []).map((d) => names[d]).join(", ") || "specific days";
    return `${days}${times}`;
  }
  return `daily${times}`;
}

/** One compact line per med for the coach context. */
export function formatMedicationForCoach(med: MedicationDefinition, status: MedicationDayStatus): string {
  const amount = doseLabel(med);
  const sched = scheduleLabel(med);
  const flags = [
    med.critical ? "CRITICAL" : null,
    med.withFood ? "with food" : null,
    med.info && !med.info.error ? "info on file" : null,
  ].filter(Boolean);
  let progress: string;
  if (status.asNeeded) {
    progress = status.takenCount ? `${status.takenCount} taken today` : "as-needed, none logged today";
  } else {
    const overdue = status.doses.filter((d) => d.overdue).length;
    progress =
      `today ${status.takenCount}/${status.scheduledCount} taken` +
      (overdue ? `, ${overdue} overdue` : "") +
      (status.adherence7d != null ? `, 7d adherence ${status.adherence7d}%` : "");
  }
  return (
    `${med.name} (${med.kind}${amount ? ", " + amount : ""}): ${sched}` +
    (flags.length ? ` [${flags.join(", ")}]` : "") +
    ` — ${progress}`
  );
}
