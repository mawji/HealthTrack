// Structured lab-report extraction: turns raw document text into LabMetric
// rows keyed canonically so the same test lines up across reports over time.

import { complete, hasAiKey, parseJsonReply } from "./openrouter";
import { LabFlag, LabMetric } from "./types";

export interface ParsedReport {
  docType: string | null;
  labName: string | null;
  reportDate: string | null; // yyyy-MM-dd specimen collection date
  metrics: LabMetric[];
}

// Canonical keys for common tests so trends match across differently-worded
// reports ("25-OH Vitamin D" vs "Vitamin D, 25-Hydroxy" both → vitamin-d).
const CANONICAL_KEYS = [
  "glucose-fasting",
  "glucose-random",
  "hba1c",
  "total-cholesterol",
  "ldl-cholesterol",
  "hdl-cholesterol",
  "triglycerides",
  "vldl-cholesterol",
  "chol-hdl-ratio",
  "creatinine",
  "egfr",
  "bun",
  "uric-acid",
  "sodium",
  "potassium",
  "chloride",
  "bicarbonate",
  "calcium",
  "magnesium",
  "phosphate",
  "alt",
  "ast",
  "alp",
  "ggt",
  "bilirubin-total",
  "albumin",
  "total-protein",
  "tsh",
  "free-t4",
  "free-t3",
  "ferritin",
  "iron",
  "transferrin-saturation",
  "vitamin-d",
  "vitamin-b12",
  "folate",
  "crp",
  "esr",
  "hemoglobin",
  "hematocrit",
  "wbc",
  "rbc",
  "platelets",
  "mcv",
  "mch",
  "mchc",
  "rdw",
  "neutrophils",
  "lymphocytes",
  "monocytes",
  "eosinophils",
  "basophils",
  "psa",
  "testosterone-total",
  "cortisol",
  "insulin-fasting",
  "homa-ir",
];

const FLAGS: LabFlag[] = ["normal", "high", "low", "abnormal", "critical"];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[<>,≤≥\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Recomputes a flag from the numeric value vs range; used when the model omits one. */
function inferFlag(value: number | null, refLow: number | null, refHigh: number | null): LabFlag {
  if (value === null) return "normal";
  if (refHigh !== null && value > refHigh) return "high";
  if (refLow !== null && value < refLow) return "low";
  return "normal";
}

function normalizeMetric(raw: any): LabMetric | null {
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const value = toNum(raw.value);
  const refLow = toNum(raw.refLow);
  const refHigh = toNum(raw.refHigh);
  const keyRaw = typeof raw.key === "string" ? slugify(raw.key) : "";
  const flag: LabFlag = FLAGS.includes(raw.flag) ? raw.flag : inferFlag(value, refLow, refHigh);
  return {
    key: keyRaw || slugify(name),
    name,
    panel: typeof raw.panel === "string" && raw.panel.trim() ? raw.panel.trim() : "Results",
    value,
    valueText: typeof raw.valueText === "string" && raw.valueText ? raw.valueText : value !== null ? String(value) : "",
    unit: typeof raw.unit === "string" ? raw.unit : "",
    refLow,
    refHigh,
    refText: typeof raw.refText === "string" ? raw.refText : "",
    flag,
  };
}

/**
 * DD/MM vs MM/DD guard: models still occasionally misread day-first dates
 * even when told not to. A collection date can't be in the future, so when
 * it is, swapping day and month is the likely correct reading.
 */
function fixFutureDate(d: string | null): string | null {
  if (!d) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (d <= today) return d;
  const [y, m, day] = d.split("-");
  const swapped = `${y}-${day}-${m}`;
  if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(swapped) && swapped <= today) {
    return swapped;
  }
  return null;
}

/**
 * Extracts structured metrics + report metadata from document text.
 * Returns null when there's no AI key or no usable text — callers treat the
 * record as unstructured (summary only).
 */
export async function extractLabReport(text: string): Promise<ParsedReport | null> {
  if (!hasAiKey() || !text.trim()) return null;
  const reply = await complete(
    [
      {
        role: "user",
        content: `Parse this medical document into structured JSON. Return ONLY a JSON object:
{
  "docType": string,            // short label, e.g. "Lab report — General Chemistry & Endocrinology"
  "labName": string|null,       // performing lab / hospital
  "reportDate": "YYYY-MM-DD"|null,  // specimen COLLECTION date (not print date). Many labs write dates as DD/MM/YYYY: when ambiguous, choose the reading that keeps collected <= verified <= printed and puts no date in the future.
  "metrics": [
    {
      "key": string,            // canonical key when the test matches one of: ${CANONICAL_KEYS.join(", ")}. Otherwise a lowercase-hyphenated slug of the test name.
      "name": string,           // test name as printed
      "panel": string,          // section heading it appears under, e.g. "Lipid Panel", "General Chemistry"
      "value": number|null,     // numeric result; null for qualitative results
      "valueText": string,      // result exactly as printed (e.g. "7.2", "Negative")
      "unit": string,
      "refLow": number|null,    // numeric lower bound of reference range (">=60" -> refLow 60)
      "refHigh": number|null,   // numeric upper bound ("<=49" -> refHigh 49)
      "refText": string,        // reference range as printed
      "flag": "normal"|"high"|"low"|"abnormal"|"critical"  // use printed markers (H/L/@/C) when present, else compare value to range
    }
  ]
}
Rules: one entry per test result; skip legends, addresses, interpretive comments, and page footers. If the document is not a lab report (e.g. a prescription or imaging report), return what fits: metrics may be empty but still set docType/labName/reportDate.

---
${text.slice(0, 16000)}`,
      },
    ],
    { json: true }
  );
  const parsed = parseJsonReply<any>(reply);
  const metrics = Array.isArray(parsed.metrics)
    ? (parsed.metrics.map(normalizeMetric).filter(Boolean) as LabMetric[])
    : [];
  const dateOk = typeof parsed.reportDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.reportDate);
  return {
    docType: typeof parsed.docType === "string" ? parsed.docType : null,
    labName: typeof parsed.labName === "string" ? parsed.labName : null,
    reportDate: fixFutureDate(dateOk ? parsed.reportDate : null),
    metrics,
  };
}
