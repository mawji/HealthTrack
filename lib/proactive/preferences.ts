// Proactive guidance preferences — opt-in, with conservative guardrail defaults.

import { readJson, writeJson } from "@/lib/store";
import { ProactivePreferences, GuidanceCategory } from "@/lib/proactive/types";

const PREFS_FILE = "proactive/preferences.json";

/** Parse "HH:MM" to minutes since midnight; tolerant of bad input. */
export function hmToMin(hm: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm?.trim() ?? "");
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
}

export function minToHm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const DEFAULT_PREFS: ProactivePreferences = {
  enabled: false, // opt-in
  quietStartMin: 21 * 60 + 30, // 21:30
  quietEndMin: 8 * 60, // 08:00
  maxPerDay: 2,
  minGapHours: 3,
  categories: { water: true, steps: true, movement: true, sleep: true, habits: true },
  usualBedtimeMin: 22 * 60 + 30, // 22:30
};

export function getPreferences(): ProactivePreferences {
  const stored = readJson<Partial<ProactivePreferences> | null>(PREFS_FILE, null);
  if (!stored) return DEFAULT_PREFS;
  // Pick only known fields so removed/legacy keys (e.g. an old waterGoalMl) can't
  // leak back through the API.
  return {
    enabled: stored.enabled ?? DEFAULT_PREFS.enabled,
    quietStartMin: stored.quietStartMin ?? DEFAULT_PREFS.quietStartMin,
    quietEndMin: stored.quietEndMin ?? DEFAULT_PREFS.quietEndMin,
    maxPerDay: stored.maxPerDay ?? DEFAULT_PREFS.maxPerDay,
    minGapHours: stored.minGapHours ?? DEFAULT_PREFS.minGapHours,
    usualBedtimeMin: stored.usualBedtimeMin ?? DEFAULT_PREFS.usualBedtimeMin,
    categories: { ...DEFAULT_PREFS.categories, ...(stored.categories ?? {}) },
  };
}

export function setPreferences(patch: Partial<ProactivePreferences>) {
  const next = { ...getPreferences(), ...patch };
  if (patch.categories) next.categories = { ...getPreferences().categories, ...patch.categories };
  writeJson(PREFS_FILE, next);
  return next;
}

export const CATEGORY_LABELS: Record<GuidanceCategory, string> = {
  water: "Hydration",
  steps: "Steps",
  movement: "Movement breaks",
  sleep: "Wind-down",
  habits: "Habits",
};
