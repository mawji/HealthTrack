// Evidence registry: the single entry point the coach context uses. Phase 1
// injects ALL active rules (the set is small enough not to need intent-based
// retrieval yet); when it grows, add a buildEvidenceContext(intent) selector
// here without changing callers.

import { EVIDENCE_RULES } from "./rules";
import { getSource } from "./sources";
import { EvidenceRule } from "./types";

export { SOURCE_CARDS, getSource } from "./sources";
export { EVIDENCE_RULES } from "./rules";
export type { EvidenceRule, SourceCard, EvidenceDomain } from "./types";

export function getActiveRules(): EvidenceRule[] {
  return EVIDENCE_RULES;
}

/** One citation line per rule: publisher names + url, deduped. */
function citation(rule: EvidenceRule): string {
  const parts = rule.sourceIds
    .map((id) => getSource(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => `${s.attribution} — ${s.url}`);
  return [...new Set(parts)].join("; ");
}

/**
 * Render the sourced rules as a compact, citable block for the coach system
 * prompt. The coach may quote these and MUST name the source when it does.
 */
export function formatEvidenceForCoach(rules: EvidenceRule[] = getActiveRules()): string {
  if (!rules.length) return "";
  const lines = [
    "== Evidence (sourced guidelines you may cite; general population guidance, not the user's own measured numbers) ==",
  ];
  for (const r of rules) {
    const limits = r.limits ? ` Limits: ${r.limits}` : "";
    lines.push(`- [${r.domain}] ${r.claim} (${r.population}.${limits}) ${citation(r)}`);
  }
  return lines.join("\n");
}
