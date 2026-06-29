// Global medication reminder defaults + critical-dose escalation knobs.
// Opt-in (remindersEnabled defaults false), like the proactive guidance system.
// Stored in data/medications/settings.json. Per-med reminder overrides live on
// the definition; these are the app-wide defaults + the escalation policy.

import { readJson, writeJson } from "./store";
import { MedicationSettings } from "./types";

const FILE = "medications/settings.json";

export const DEFAULT_MED_SETTINGS: MedicationSettings = {
  remindersEnabled: false, // opt-in
  defaultLeadMinutes: [0], // remind at the dose time by default
  renudgeMinutes: 30, // re-nudge a missed CRITICAL dose every 30 min
  maxRenudges: 3,
  criticalBypassQuietHours: true, // a must-take dose still reminds at night
  quietStartMin: 22 * 60, // 22:00
  quietEndMin: 7 * 60, // 07:00
  inventoryEnabled: true, // track supply + low-stock reminders
};

export function getMedicationSettings(): MedicationSettings {
  const s = readJson<Partial<MedicationSettings> | null>(FILE, null);
  if (!s) return DEFAULT_MED_SETTINGS;
  return {
    remindersEnabled: s.remindersEnabled ?? DEFAULT_MED_SETTINGS.remindersEnabled,
    defaultLeadMinutes:
      Array.isArray(s.defaultLeadMinutes) && s.defaultLeadMinutes.length
        ? s.defaultLeadMinutes
        : DEFAULT_MED_SETTINGS.defaultLeadMinutes,
    renudgeMinutes: s.renudgeMinutes ?? DEFAULT_MED_SETTINGS.renudgeMinutes,
    maxRenudges: s.maxRenudges ?? DEFAULT_MED_SETTINGS.maxRenudges,
    criticalBypassQuietHours:
      s.criticalBypassQuietHours ?? DEFAULT_MED_SETTINGS.criticalBypassQuietHours,
    quietStartMin: s.quietStartMin ?? DEFAULT_MED_SETTINGS.quietStartMin,
    quietEndMin: s.quietEndMin ?? DEFAULT_MED_SETTINGS.quietEndMin,
    inventoryEnabled: s.inventoryEnabled ?? DEFAULT_MED_SETTINGS.inventoryEnabled,
  };
}

export function setMedicationSettings(patch: Partial<MedicationSettings>): MedicationSettings {
  const next = { ...getMedicationSettings(), ...patch };
  // Sanitize the numeric knobs.
  next.renudgeMinutes = Math.max(5, Math.min(240, Math.round(next.renudgeMinutes)));
  next.maxRenudges = Math.max(0, Math.min(10, Math.round(next.maxRenudges)));
  if (Array.isArray(patch.defaultLeadMinutes)) {
    const cleaned = [
      ...new Set(
        patch.defaultLeadMinutes
          .map((m) => Math.max(0, Math.min(720, Math.round(Number(m)))))
          .filter((m) => Number.isFinite(m))
      ),
    ].sort((a, b) => b - a);
    next.defaultLeadMinutes = cleaned.length ? cleaned : [0];
  }
  writeJson(FILE, next);
  return next;
}

/** Is `nowMin` inside the quiet window? Handles windows that wrap midnight. */
export function inMedQuietHours(nowMin: number, s: MedicationSettings): boolean {
  const { quietStartMin: a, quietEndMin: b } = s;
  return a <= b ? nowMin >= a && nowMin < b : nowMin >= a || nowMin < b;
}
