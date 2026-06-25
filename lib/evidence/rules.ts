// Evidence rules as code. Each is a small, citable factual claim with the
// source(s) it rests on and the population it applies to. Phase 1 seeds a
// handful across exercise / sleep / weight so the coach can ground advice with
// provenance; Phases 2–3 add the deterministic evaluators (weekly-activity vs
// these targets, calorie/macro calculators) that consume them.
//
// Keep claims to copyright-free FACTS and thresholds — never copied prose.

import { EvidenceRule } from "./types";

export const EVIDENCE_RULES: EvidenceRule[] = [
  {
    id: "exercise-aerobic-adults",
    sourceIds: ["odphp-pag"],
    domain: "exercise",
    population: "Adults 18–64 without contraindications",
    claim:
      "Aim for 150–300 min/week of moderate-intensity aerobic activity, or 75–150 min/week vigorous (or an equivalent mix). More yields additional benefit.",
    limits: "General guidance for healthy adults; adjust for injury, illness, pregnancy, or clinician advice.",
    grade: "Federal guideline (strong)",
  },
  {
    id: "exercise-strength-adults",
    sourceIds: ["odphp-pag"],
    domain: "exercise",
    population: "Adults 18–64 without contraindications",
    claim: "Do muscle-strengthening activities working all major muscle groups on 2 or more days/week.",
    limits: "Separate from aerobic minutes; count strength days, not cardio minutes.",
    grade: "Federal guideline (strong)",
  },
  {
    id: "sleep-duration-adults",
    sourceIds: ["cdc-sleep"],
    domain: "sleep",
    population: "Adults 18–60",
    claim: "Adults should get 7 or more hours of sleep per night on a regular schedule.",
    limits: "Duration is one signal; quality and consistency also matter. Needs vary by individual.",
    grade: "Public-health guidance",
  },
  {
    id: "prevention-a1c-categories",
    sourceIds: ["cdc-diabetes-a1c"],
    domain: "prevention",
    population: "Non-pregnant adults",
    claim:
      "A1C below 5.7% is normal, 5.7–6.4% is prediabetes range, and 6.5% or higher is in the diabetes range (screening categories).",
    limits: "Categories are educational, not a diagnosis; diagnosis and management belong to a clinician. People already managing diabetes have individualized targets.",
    grade: "Public-health category",
  },
  {
    id: "prevention-bp-categories",
    sourceIds: ["aha-cdc-bp"],
    domain: "vitals",
    population: "Adults",
    claim:
      "BP categories (mmHg): normal <120/<80; elevated 120–129/<80; stage 1 130–139 or 80–89; stage 2 ≥140 or ≥90; hypertensive crisis ≥180 and/or ≥120 (seek urgent care).",
    limits: "Based on averaged, properly measured readings — a single high reading isn't a diagnosis. Confirm with a clinician.",
    grade: "Public-health category",
  },
  {
    id: "prevention-screening-prompt",
    sourceIds: ["uspstf"],
    domain: "prevention",
    population: "Adults (varies by age/risk)",
    claim:
      "Adults should ask their clinician whether routine screening (blood pressure, lipids, and diabetes/blood-sugar by age and risk) is due — these are discussion prompts, not directives.",
    limits: "Exact age/interval depends on individual risk; the clinician decides. Not applicable as a 'get screened' nudge to someone already under care for that condition.",
    grade: "Screening guidance (USPSTF)",
  },
  {
    id: "weight-healthy-bmi-adults",
    sourceIds: ["cdc-healthy-weight"],
    domain: "nutrition",
    population: "Adults 20+ (non-pregnant)",
    claim:
      "A BMI of 18.5–24.9 is the 'healthy weight' range; 25.0–29.9 is overweight and 30.0+ is obesity (population screening categories).",
    limits:
      "BMI is a screening proxy, not a diagnosis or a measure of body composition; it can misclassify very muscular or older individuals.",
    grade: "Population screening category",
  },
];
