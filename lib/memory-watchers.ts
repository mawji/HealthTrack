// Always-on silent watchers: deterministic functions that turn data events into
// durable coach memories WITHOUT asking. Each derives a *pattern/interpretation*
// (never a duplicated raw value — the numbers already live in Records/Trends),
// keyed by a stable topic so it self-corrects: when the pattern no longer holds,
// the runner archives the stale derived memory. Run on measurement logs, record
// uploads, and on demand via /api/coach/memory/derive. See plans/coach-memory-system.md.

import { readJson } from "./store";
import { recentMeasurements } from "./measurements";
import { upsertDerivedMemory, getActiveMemories, archiveMemory } from "./memory";
import { LabMetric, MedicalRecord } from "./types";

const RECORDS = "records-index.json";

// A pattern the watchers believe currently holds. `topic` is namespaced
// ("labs:ldl-cholesterol", "bp", "weight") so the runner can reconcile a whole
// family at once.
type DerivedCandidate = { topic: string; text: string; confidence?: number };

const NAMESPACES = ["labs", "bp", "weight"];
const namespaceOf = (topic: string) => topic.split(":")[0];

// ── labs: a cardiometabolic metric flagged out-of-range across ≥2 reports ─────
// We trust the report's OWN flag (no invented thresholds) and only remember a
// *persistent* abnormality — a single flagged report is already surfaced live by
// the prevention block, so it isn't memory-worthy on its own.
const CARDIOMETABOLIC: Record<string, string> = {
  "ldl-cholesterol": "LDL cholesterol",
  "total-cholesterol": "total cholesterol",
  triglycerides: "triglycerides",
  "glucose-fasting": "fasting glucose",
  hba1c: "HbA1c",
  crp: "CRP (inflammation)",
};

function recordDate(r: MedicalRecord): string {
  return r.reportDate || r.uploadedAt.slice(0, 10);
}

/** All (date, metric) pairs for a key across records, newest first. */
function metricHistory(key: string, records: MedicalRecord[]): { date: string; m: LabMetric }[] {
  const out: { date: string; m: LabMetric }[] = [];
  for (const r of records) {
    if (!r.metrics?.length) continue;
    const date = recordDate(r);
    for (const m of r.metrics) {
      if (m.key === key && m.value != null) out.push({ date, m });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function labsWatcher(): DerivedCandidate[] {
  const records = readJson<MedicalRecord[]>(RECORDS, []);
  const out: DerivedCandidate[] = [];
  for (const [key, name] of Object.entries(CARDIOMETABOLIC)) {
    const hist = metricHistory(key, records);
    if (hist.length < 2) continue; // need a trend across reports
    const recent = hist.slice(0, 3);
    const abnormal = recent.filter((h) => h.m.flag !== "normal");
    // Persistent only: the two most recent reports both out of range.
    if (recent[0].m.flag === "normal" || recent[1].m.flag === "normal") continue;
    const dir = recent[0].m.flag; // high / low / abnormal / critical
    out.push({
      topic: `labs:${key}`,
      text: `${name} has been flagged ${dir} on the last ${abnormal.length} lab reports — a persistent pattern worth tracking with their clinician (not a diagnosis).`,
      confidence: 0.9,
    });
  }
  return out;
}

// ── blood pressure: most recent readings sitting in stage-1+ ──────────────────
function bpCategory(sys: number, dia: number): "normal" | "elevated" | "stage1" | "stage2" | "crisis" {
  if (sys >= 180 || dia >= 120) return "crisis";
  if (sys >= 140 || dia >= 90) return "stage2";
  if (sys >= 130 || dia >= 80) return "stage1";
  if (sys >= 120 && dia < 80) return "elevated";
  return "normal";
}

function bpWatcher(): DerivedCandidate[] {
  const rows = recentMeasurements({ kind: "blood-pressure", limit: 6 });
  const usable = rows.filter((r) => r.value != null && r.value2 != null);
  if (usable.length < 3) return [];
  const cats = usable.map((r) => bpCategory(r.value, r.value2!));
  const elevated = cats.filter((c) => c === "stage1" || c === "stage2" || c === "crisis").length;
  if (elevated / usable.length < 0.6) return []; // not a clear pattern
  const worst = cats.includes("stage2") || cats.includes("crisis") ? "stage 2" : "stage 1";
  return [
    {
      topic: "bp",
      text: `Blood pressure has been in the ${worst}+ range (AHA/CDC) in most recent readings (${elevated} of ${usable.length}) — a standing pattern to manage with their clinician, not a diagnosis.`,
      confidence: 0.85,
    },
  ];
}

// ── weight: a sustained directional trend over several weeks ──────────────────
function toKg(value: number, unit: string): number {
  return /lb/i.test(unit) ? value * 0.45359237 : value;
}

function weightWatcher(): DerivedCandidate[] {
  const rows = recentMeasurements({ kind: "weight", limit: 16 });
  if (rows.length < 3) return [];
  // newest first → oldest first for a clean span
  const pts = rows
    .map((r) => ({ at: Date.parse(r.at), kg: toKg(r.value, r.unit) }))
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.kg))
    .sort((a, b) => a.at - b.at);
  if (pts.length < 3) return [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const spanDays = (last.at - first.at) / 86_400_000;
  if (spanDays < 21) return []; // need a few weeks to call it a trend
  const deltaKg = last.kg - first.kg;
  const pct = Math.abs(deltaKg) / first.kg;
  if (pct < 0.015) return []; // < ~1.5% is noise, not a trend
  const dir = deltaKg < 0 ? "down" : "up";
  const weeks = Math.round(spanDays / 7);
  const mag = Math.abs(deltaKg).toFixed(1);
  return [
    {
      topic: "weight",
      text: `Weight has been trending ${dir} gradually — about ${mag} kg over the past ~${weeks} weeks.`,
      confidence: 0.8,
    },
  ];
}

/** Pure: the patterns the watchers believe currently hold. No writes — used by
 *  the dry-run endpoint. */
export function collectDerivedCandidates(): DerivedCandidate[] {
  return [...labsWatcher(), ...bpWatcher(), ...weightWatcher()];
}

/** Run every watcher, upsert the patterns that currently hold, and archive any
 *  previously-derived pattern in an evaluated namespace that no longer holds. */
export function runMemoryWatchers(): { candidates: DerivedCandidate[]; upserted: number; archived: number } {
  const candidates = collectDerivedCandidates();
  const present = new Set(candidates.map((c) => c.topic));

  let upserted = 0;
  for (const c of candidates) {
    const r = upsertDerivedMemory({ topic: c.topic, text: c.text, category: "pattern", confidence: c.confidence });
    if (!("error" in r)) upserted++;
  }

  // Reconcile: a derived memory in a namespace we just evaluated, but whose topic
  // isn't in the current candidate set, means the pattern resolved — archive it.
  let archived = 0;
  for (const m of getActiveMemories()) {
    if (m.source !== "derived" || !m.topic) continue;
    if (!NAMESPACES.includes(namespaceOf(m.topic))) continue;
    if (!present.has(m.topic)) {
      if (archiveMemory(m.id)) archived++;
    }
  }
  return { candidates, upserted, archived };
}
