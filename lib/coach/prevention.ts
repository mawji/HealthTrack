// Deterministic prevention / health-review layer. Conservative, educational, and
// never diagnostic: it surfaces the user's own out-of-range labs (using the
// REPORT'S OWN flag/reference range first) and classifies blood pressure and A1C
// into widely-published public-health categories, each with a citation. The coach
// turns these into "worth discussing with your clinician" prompts and routes
// genuine red flags (e.g. hypertensive crisis) to urgent care. No copied prose;
// thresholds are cited facts. See lib/evidence for the source cards.

import { readJson } from "../store";
import { recentMeasurements } from "../measurements";
import { LabMetric, MedicalRecord } from "../types";

export type PreventionSeverity = "info" | "review" | "urgent";

export interface PreventionFlag {
  domain: "labs" | "bp" | "a1c";
  text: string; // the educational line (value + category, no diagnosis)
  severity: PreventionSeverity;
  source: string; // citation attribution (e.g. "CDC", "AHA/CDC")
}

const RECORDS = "records-index.json";

// Cardiometabolic lab keys we surface when the REPORT flags them abnormal, with
// friendly names. We trust the lab's own reference range — we don't re-threshold.
const CARDIOMETABOLIC: Record<string, string> = {
  "ldl-cholesterol": "LDL cholesterol",
  "total-cholesterol": "total cholesterol",
  "hdl-cholesterol": "HDL cholesterol",
  triglycerides: "triglycerides",
  "glucose-fasting": "fasting glucose",
  crp: "CRP (inflammation)",
  egfr: "eGFR (kidney)",
  creatinine: "creatinine (kidney)",
};

function recordDate(r: MedicalRecord): string {
  return r.reportDate || r.uploadedAt.slice(0, 10);
}

/** Newest full metric (incl. flag) for a canonical key across all records. */
function latestMetric(key: string, records: MedicalRecord[]): { m: LabMetric; date: string } | null {
  let best: { m: LabMetric; date: string } | null = null;
  for (const r of records) {
    if (!r.metrics?.length) continue;
    const date = recordDate(r);
    for (const m of r.metrics) {
      if (m.key !== key) continue;
      if (!best || date > best.date) best = { m, date };
    }
  }
  return best;
}

/** A1C → CDC category, only when in prediabetes range or above (value is %). */
function a1cFlag(records: MedicalRecord[]): PreventionFlag | null {
  const latest = latestMetric("hba1c", records);
  if (!latest || latest.m.value == null) return null;
  const v = latest.m.value;
  if (v < 5.7) return null; // normal — don't alarm
  const cat = v < 6.5 ? "the prediabetes range" : "the diabetes range";
  return {
    domain: "a1c",
    text: `Your latest A1C is ${v}% (${latest.date}), in ${cat} per CDC categories. Track it and review with your clinician; if you already manage this, this is just context.`,
    severity: "review",
    source: "CDC",
  };
}

/** Latest blood pressure → AHA/CDC category, with urgent routing for crisis. */
function bpFlag(): PreventionFlag | null {
  const [bp] = recentMeasurements({ kind: "blood-pressure", limit: 1 });
  if (!bp || bp.value == null || bp.value2 == null) return null;
  const sys = bp.value;
  const dia = bp.value2;
  const when = bp.at.slice(0, 10);

  if (sys >= 180 || dia >= 120) {
    return {
      domain: "bp",
      text: `Your last blood pressure was ${sys}/${dia} mmHg (${when}) — in the hypertensive-crisis range (AHA/CDC). If you have symptoms (chest pain, shortness of breath, vision changes), seek urgent care; otherwise recheck soon and contact your clinician promptly.`,
      severity: "urgent",
      source: "AHA/CDC",
    };
  }
  let cat: string | null = null;
  if (sys >= 140 || dia >= 90) cat = "stage 2 high blood pressure";
  else if (sys >= 130 || dia >= 80) cat = "stage 1 high blood pressure";
  else if (sys >= 120 && dia < 80) cat = "elevated";
  if (!cat) return null; // normal

  return {
    domain: "bp",
    text: `Your last blood pressure was ${sys}/${dia} mmHg (${when}), in the ${cat} category (AHA/CDC). Based on averaged readings — worth discussing with your clinician.`,
    severity: "review",
    source: "AHA/CDC",
  };
}

/** Out-of-range cardiometabolic labs, using the report's OWN flag. */
function labFlags(records: MedicalRecord[]): PreventionFlag[] {
  const out: PreventionFlag[] = [];
  for (const [key, name] of Object.entries(CARDIOMETABOLIC)) {
    const latest = latestMetric(key, records);
    if (!latest || latest.m.value == null) continue;
    const flag = latest.m.flag;
    if (flag === "normal") continue;
    const severity: PreventionSeverity = flag === "critical" ? "urgent" : "review";
    const unit = latest.m.unit ? ` ${latest.m.unit}` : "";
    const range = latest.m.refText ? ` (ref ${latest.m.refText})` : "";
    out.push({
      domain: "labs",
      text: `Your latest ${name} is ${latest.m.value}${unit}${range}, flagged ${flag} on your ${latest.date} report. Worth reviewing with your clinician.`,
      severity,
      source: "lab report reference range",
    });
  }
  return out;
}

const RANK: Record<PreventionSeverity, number> = { urgent: 2, review: 1, info: 0 };

/** Build the conservative prevention review from the user's own data. */
export function buildPreventionReview(): PreventionFlag[] {
  const records = readJson<MedicalRecord[]>(RECORDS, []);
  const flags: PreventionFlag[] = [];
  const bp = bpFlag();
  if (bp) flags.push(bp);
  const a1c = a1cFlag(records);
  if (a1c) flags.push(a1c);
  flags.push(...labFlags(records));
  return flags.sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, 6);
}

/** Render the prevention review as a coach-context block. */
export function formatPreventionForCoach(flags: PreventionFlag[] = buildPreventionReview()): string {
  if (!flags.length) return "";
  const lines = [
    "== Health review (educational, from your own labs/readings — NOT a diagnosis; discuss with your clinician) ==",
  ];
  for (const f of flags) {
    lines.push(`- ${f.severity === "urgent" ? "URGENT: " : ""}${f.text} [${f.source}]`);
  }
  return lines.join("\n");
}
