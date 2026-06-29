// Manual measurements logged from the global "+ Log" sheet (weight, glucose,
// body temperature, body fat, sleep). Plain local JSON, same conventions as the
// other stores. Google Health write-back is added separately and guarded by
// granted scopes; until then these are local-only. See the "+ Log" backlog item.

import { readJson, writeJson, newId } from "./store";
import { logWeightToGoogleHealth, logBodyFatToGoogleHealth, deleteDataPoint } from "./googlehealth";
import { appendNote } from "./coach/scratchpad";
import { Measurement, MeasurementKind } from "./types";

// Manual kinds the Google Health v4 API accepts dataPoints:create for (others
// — glucose, body temp, sleep, muscle mass, blood pressure — are read-only or
// unexposed there, so they stay local). When the API adds a create/read path
// for muscle mass or blood pressure, wire it here + in syncMeasurementToHealth.
const HEALTH_DATATYPE: Partial<Record<MeasurementKind, string>> = {
  weight: "weight",
  "body-fat": "body-fat",
};

const FILE = "measurements.json";

const KINDS: MeasurementKind[] = ["weight", "glucose", "body-temp", "body-fat", "sleep", "muscle-mass", "blood-pressure"];

// Kinds that carry a second value (value2). Blood pressure stores systolic in
// `value` and diastolic in `value2`.
const DUAL_KINDS: MeasurementKind[] = ["blood-pressure"];

// Default display unit per kind (the editor can override glucose/temperature).
export const MEASUREMENT_UNITS: Record<MeasurementKind, string> = {
  weight: "kg",
  glucose: "mmol/L",
  "body-temp": "°C",
  "body-fat": "%",
  sleep: "min",
  "muscle-mass": "kg",
  "blood-pressure": "mmHg",
};

export const MEASUREMENT_LABELS: Record<MeasurementKind, string> = {
  weight: "Weight",
  glucose: "Glucose",
  "body-temp": "Body temperature",
  "body-fat": "Body fat",
  sleep: "Sleep",
  "muscle-mass": "Muscle mass",
  "blood-pressure": "Blood pressure",
};

const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
};

export function getMeasurements(): Measurement[] {
  return readJson<Measurement[]>(FILE, []);
}

export function saveMeasurements(rows: Measurement[]) {
  writeJson(FILE, rows);
}

/** Recent measurements, newest first, optionally filtered by kind and capped. */
export function recentMeasurements(opts: { kind?: MeasurementKind; limit?: number } = {}): Measurement[] {
  let rows = getMeasurements().slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  if (opts.kind) rows = rows.filter((r) => r.kind === opts.kind);
  return rows.slice(0, opts.limit ?? 50);
}

/** Validate + normalize an untrusted body into a Measurement (id assigned). */
export function buildMeasurement(raw: unknown): Measurement | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid body" };
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as MeasurementKind) ? (r.kind as MeasurementKind) : null;
  if (!kind) return { error: "invalid kind" };

  const value = num(r.value);
  if (value == null) return { error: "value is required" };

  // Dual-value kinds (blood pressure) require a second reading (diastolic).
  const value2 = num(r.value2);
  if (DUAL_KINDS.includes(kind) && value2 == null) return { error: "value2 is required" };

  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : new Date().toISOString();

  return {
    id: newId(),
    kind,
    at,
    value,
    value2: DUAL_KINDS.includes(kind) ? value2 ?? undefined : undefined,
    unit: str(r.unit, 16) ?? MEASUREMENT_UNITS[kind],
    context: str(r.context, 24),
    startTime: /^\d{2}:\d{2}$/.test(String(r.startTime ?? "")) ? String(r.startTime) : undefined,
    endTime: /^\d{2}:\d{2}$/.test(String(r.endTime ?? "")) ? String(r.endTime) : undefined,
    note: str(r.note, 280),
    syncedToHealth: false,
  };
}

export function addMeasurement(raw: unknown): Measurement | { error: string } {
  const m = buildMeasurement(raw);
  if ("error" in m) return m;
  const rows = getMeasurements();
  rows.push(m);
  saveMeasurements(rows);
  // Scratchpad: a concrete vitals reading (a specific value the digest's rollups
  // don't surface — e.g. a high glucose). Best-effort, never blocks the log.
  const v2 = m.value2 != null ? `/${m.value2}` : "";
  const ctx = m.context ? ` (${m.context})` : "";
  appendNote({
    source: "measurement",
    note: `logged ${MEASUREMENT_LABELS[m.kind].toLowerCase()}: ${m.value}${v2} ${m.unit}${ctx}`,
    tags: ["vitals", m.kind],
  });
  return m;
}

/** Patch an existing measurement's value/unit/context/time/note (not its kind). */
export function updateMeasurement(id: string, raw: unknown): Measurement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rows = getMeasurements();
  const idx = rows.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  const cur = rows[idx];
  const value = num(r.value);
  const value2 = num(r.value2);
  rows[idx] = {
    ...cur,
    value: value ?? cur.value,
    value2: DUAL_KINDS.includes(cur.kind) ? value2 ?? cur.value2 : cur.value2,
    unit: str(r.unit, 16) ?? cur.unit,
    context: "context" in r ? str(r.context, 24) : cur.context,
    at: typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : cur.at,
    note: "note" in r ? str(r.note, 280) : cur.note,
  };
  saveMeasurements(rows);
  return rows[idx];
}

/** Mark a measurement as written back to Google Health (provenance for dedup). */
export function markMeasurementSynced(id: string, googleName: string): void {
  const rows = getMeasurements();
  const m = rows.find((r) => r.id === id);
  if (!m) return;
  m.syncedToHealth = true;
  if (googleName) m.googleName = googleName;
  saveMeasurements(rows);
}

/**
 * Write a measurement back to Google Health where the v4 API exposes a path,
 * converting to the API's canonical unit (grams, mg/dL, °C). Returns the created
 * dataPoint name, "" if created without a name, or null when not synced (scope
 * not granted, not connected, sleep, or the write failed). Sleep has no simple
 * write path here and stays local-only.
 */
export async function syncMeasurementToHealth(m: Measurement): Promise<string | null> {
  const at = new Date(m.at);
  switch (m.kind) {
    case "weight":
      return logWeightToGoogleHealth(m.unit === "lb" ? m.value * 0.45359237 : m.value, at);
    case "body-fat":
      return logBodyFatToGoogleHealth(m.value, at);
    // glucose, body temperature and sleep have no third-party create path in the
    // v4 API — kept local-only.
    default:
      return null;
  }
}

/** Remove a measurement's Google Health dataPoint when it was synced. */
export async function deleteMeasurementFromHealth(m: Measurement): Promise<void> {
  const dataType = HEALTH_DATATYPE[m.kind];
  if (!m.googleName || !dataType) return;
  try {
    await deleteDataPoint(dataType, m.googleName);
  } catch {
    // best-effort
  }
}

export function deleteMeasurement(id: string): boolean {
  const rows = getMeasurements();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  saveMeasurements(next);
  return true;
}
