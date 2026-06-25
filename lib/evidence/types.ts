// Local evidence layer: typed source cards + rules. The coach cites these to
// ground advice; deterministic app values (readiness, goals, profile BMI) still
// own the user's OWN numbers — evidence rules are general population guidance.
//
// Rules are CODE, not a JSON mini-language (move to data only if a non-coder
// must edit them). Source cards stay lean: id/publisher/url/license/attribution
// + a publication marker. We deliberately omit lastReviewedAt/expiresAt/review-
// cadence fields until a real review cadence is committed — otherwise they're
// decorative and lie about freshness.

export type EvidenceDomain =
  | "nutrition"
  | "exercise"
  | "sleep"
  | "readiness"
  | "prevention"
  | "vitals"
  | "safety";

export interface SourceCard {
  id: string;
  name: string; // short name, e.g. "Physical Activity Guidelines for Americans"
  publisher: string; // e.g. "U.S. Dept. of Health & Human Services (ODPHP)"
  url: string;
  jurisdiction: string; // e.g. "US"
  license: string; // usage posture, e.g. "U.S. federal public domain; attribute, no implied endorsement"
  attribution: string; // short display attribution, e.g. "Source: ODPHP"
  published?: string; // edition/year marker, e.g. "2nd ed., 2018"
}

export interface EvidenceRule {
  id: string;
  sourceIds: string[]; // ids into SOURCE_CARDS
  domain: EvidenceDomain;
  population: string; // who it applies to, e.g. "Adults 18–64 without contraindications"
  claim: string; // the citable factual statement / threshold the coach may quote
  limits?: string; // caveats / when it does not apply
  grade?: string; // evidence grade or strength, when meaningful
}
