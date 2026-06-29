// Client-safe display helpers for the medications UI (pill-box organizer, dose
// compartments, weekly adherence strips). Pure functions only — NO fs/server
// imports — so client components can use them. The server adherence/scheduling
// logic stays in lib/medications.ts.

import { MedicationDayStatus, MedicationDoseStatus, MedicationDefinition } from "./types";

export type BucketKey = "morning" | "noon" | "evening" | "night";

export interface Bucket {
  key: BucketKey;
  label: string;
  icon: string;
  startMin: number; // inclusive, local minutes
  endMin: number; // exclusive
}

/** Time-of-day compartments, in order — the "rows" of the pill box. */
export const BUCKETS: Bucket[] = [
  { key: "morning", label: "Morning", icon: "🌅", startMin: 0, endMin: 11 * 60 },
  { key: "noon", label: "Noon", icon: "☀️", startMin: 11 * 60, endMin: 16 * 60 },
  { key: "evening", label: "Evening", icon: "🌆", startMin: 16 * 60, endMin: 21 * 60 },
  { key: "night", label: "Night", icon: "🌙", startMin: 21 * 60, endMin: 24 * 60 },
];

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Which compartment a dose time falls into. Untimed doses default to morning. */
export function bucketForTime(time: string | null): BucketKey {
  if (!time) return "morning";
  const min = timeToMin(time);
  const b = BUCKETS.find((x) => min >= x.startMin && min < x.endMin);
  return b?.key ?? "night";
}

export type CellState = "taken" | "skipped" | "due" | "missed" | "upcoming" | "none";

/** State of a single dose on a given day relative to `today`. */
export function doseState(dose: MedicationDoseStatus, date: string, today: string): CellState {
  if (dose.status === "taken") return "taken";
  if (dose.status === "skipped") return "skipped";
  if (date < today) return "missed";
  if (date === today) return dose.overdue ? "due" : "upcoming";
  return "upcoming"; // future
}

/** Merge several dose states into one cell/day state (worst-relevant wins). */
export function mergeStates(states: CellState[]): CellState {
  const present = states.filter((s) => s !== "none");
  if (!present.length) return "none";
  if (present.every((s) => s === "taken")) return "taken";
  if (present.every((s) => s === "skipped")) return "skipped";
  if (present.includes("due")) return "due";
  if (present.includes("missed")) return "missed";
  if (present.some((s) => s === "taken" || s === "skipped")) return "taken"; // partial → lean done
  return "upcoming";
}

/** A med's overall state for one day (drives the per-card weekly dot strip). */
export function medDayState(status: MedicationDayStatus | undefined, date: string, today: string): CellState {
  if (!status || (!status.scheduledToday && !status.asNeeded)) return "none";
  const states = status.doses.map((d) => doseState(d, date, today));
  return mergeStates(states);
}

export const STATE_COLOR: Record<CellState, string> = {
  taken: "var(--activity)",
  skipped: "var(--ink-soft)",
  due: "var(--heart)",
  missed: "var(--heart)",
  upcoming: "var(--hairline)",
  none: "transparent",
};

/** yyyy-MM-dd → short weekday + day-of-month, e.g. "Mon 23". */
export function dayHeader(date: string): { dow: string; dom: string } {
  const d = new Date(date + "T12:00:00Z");
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()], dom: String(d.getUTCDate()) };
}

/** The Sunday that ends `date`'s week (weeks run Monday→Sunday). The organizer
 *  fetches days [Mon..Sun] by asking the week endpoint for end=Sunday, days=7. */
export function sundayOf(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const daysToSunday = (7 - d.getUTCDay()) % 7; // 0=Sun→0, 1=Mon→6, 6=Sat→1
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}

/** A short 1-3 char abbreviation suggested from the med name: initials for
 *  multi-word names ("Vitamin D" → "VD"), else the first two letters. */
export function suggestNickname(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

/** Active-component label, e.g. "dapagliflozin 5 mg / metformin 1000 mg" for a
 *  combination med, falling back to the single `strength` for simple meds. */
export function componentsLabel(med: MedicationDefinition): string {
  if (med.ingredients?.length) {
    return med.ingredients.map((i) => [i.name, i.strength].filter(Boolean).join(" ")).join(" / ");
  }
  return med.strength ?? "";
}

/** Short strengths only, e.g. "5 mg / 1000 mg" — for compact amount labels. */
export function strengthsLabel(med: MedicationDefinition): string {
  if (med.ingredients?.length) {
    return med.ingredients.map((i) => i.strength).filter(Boolean).join(" / ");
  }
  return med.strength ?? "";
}

/** Days of supply remaining from a med's inventory (client mirror of the server
 *  calc), or null when not tracked / unknowable (as_needed). */
export function daysOfSupply(med: MedicationDefinition): number | null {
  if (!med.inventory) return null;
  const q = med.quantity ?? 1;
  const s = med.schedule;
  if (s.frequency === "as_needed") return null;
  const dosesPerDay = s.times.length || 1;
  let per = dosesPerDay * q;
  if (s.frequency === "specific_days") {
    const dpw = (s.daysOfWeek ?? []).length;
    if (!dpw) return null;
    per = (dosesPerDay * q * dpw) / 7;
  }
  if (per <= 0) return null;
  return med.inventory.units / per;
}

/** Common purpose-based abbreviations offered as quick picks in the editor. */
export const NICKNAME_SUGGESTIONS: { abbr: string; label: string }[] = [
  { abbr: "BP", label: "Blood pressure" },
  { abbr: "D", label: "Diabetes" },
  { abbr: "C", label: "Cholesterol" },
  { abbr: "VD", label: "Vitamin D" },
  { abbr: "FE", label: "Iron" },
  { abbr: "B12", label: "Vitamin B12" },
  { abbr: "TH", label: "Thyroid" },
  { abbr: "OM", label: "Omega-3" },
];
