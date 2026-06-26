// The single server-side enforcement choke point for contact sharing. Every
// contact-facing reply and every scheduled per-contact push MUST pass through
// filterForContact → buildScopedReply; there is no other path to a contact's
// data. filterForContact is pure (no I/O) so it's exhaustively testable, and it
// is default-deny: an inactive/expired/unbound contact, or a request for a scope
// the owner never granted, yields nothing.

import { SharedContact, isContactUsable } from "@/lib/telegram/contacts";
import { SCOPE_BY_KEY, sanitizeScopes, LEADERBOARD_SCOPES } from "@/lib/telegram/scopes";
import { buildShareData } from "@/lib/telegram/share-context";
import { recordShare } from "@/lib/telegram/audit";
import { ownerLabel } from "@/lib/telegram/owner";
import { escapeHtml } from "@/lib/telegram/bot";

/**
 * THE CHOKE POINT. Returns the scope keys this contact is allowed to receive
 * right now, intersected with `requested` when a specific request is made.
 * Pure and default-deny — usable contacts only, granted scopes only.
 */
export function filterForContact(contact: SharedContact, requested?: string[], now = Date.now()): string[] {
  if (!isContactUsable(contact, now)) return [];
  const granted = sanitizeScopes(contact.scopes);
  if (!requested) return granted;
  const want = new Set(sanitizeScopes(requested));
  return granted.filter((k) => want.has(k));
}

// Best-effort mapping of a contact's free-form question to specific scope keys.
// Returns null when nothing specific was asked (→ send their full allowed set).
const KEYWORDS: { re: RegExp; scopes: string[] }[] = [
  { re: /\bstep|walk/i, scopes: ["steps"] },
  { re: /\bworkout|train|exercise|gym|session/i, scopes: ["workout_duration", "workout_detail"] },
  { re: /\breadi|recover/i, scopes: ["readiness"] },
  { re: /\bcalorie|intake|\beat|food|nutrition/i, scopes: ["kcal_intake"] },
  { re: /\bwater|hydrat/i, scopes: ["hydration"] },
  { re: /\bactive\b/i, scopes: ["active_days"] },
  { re: /\bsleep/i, scopes: ["sleep"] },
  { re: /\bblood pressure|\bbp\b|systolic/i, scopes: ["bp"] },
  { re: /\bglucose|sugar|a1c/i, scopes: ["glucose"] },
  { re: /\bweight|weigh/i, scopes: ["weight"] },
  // Friends/family aggregate view — only ever the non-clinical, leaderboard-eligible set.
  { re: /\bleaderboard|standings|\bboard\b|\bstats\b/i, scopes: LEADERBOARD_SCOPES },
];

export function requestedScopesFromText(text: string): string[] | null {
  const hits = new Set<string>();
  for (const { re, scopes } of KEYWORDS) if (re.test(text)) scopes.forEach((s) => hits.add(s));
  return hits.size ? [...hits] : null;
}

export interface ScopedReply {
  /** Allowed scopes that actually had data, formatted. Empty if none. */
  text: string;
  /** Scope keys that were sent (for the audit digest). */
  sentScopes: string[];
  /** True when the contact asked for something specific they're not allowed. */
  deniedRequest: boolean;
}

/**
 * Build a contact-facing reply: resolve allowed scopes, format only those, audit
 * the send. `requested` narrows to a specific ask; omit for their full summary.
 */
export async function buildScopedReply(
  contact: SharedContact,
  requested: string[] | null,
  kind: "reply" | "report" = "reply"
): Promise<ScopedReply> {
  const allowed = filterForContact(contact, requested ?? undefined);
  // A specific request that maps entirely outside their grants → polite deny,
  // without revealing what exists.
  const deniedRequest = requested != null && requested.length > 0 && allowed.length === 0;

  if (!allowed.length) return { text: "", sentScopes: [], deniedRequest };

  const data = await buildShareData();
  const sent: string[] = [];
  const lines: string[] = [];
  for (const key of allowed) {
    const def = SCOPE_BY_KEY.get(key);
    if (!def) continue;
    const line = def.format(data);
    if (line) {
      lines.push(line);
      sent.push(key);
    }
  }
  if (!lines.length) return { text: "", sentScopes: [], deniedRequest: false };

  // Audit by scope LABEL, never the values themselves.
  recordShare({
    contactId: contact.id,
    contactName: contact.name,
    scopes: sent,
    kind,
    digest: sent.map((k) => SCOPE_BY_KEY.get(k)?.label ?? k).join(", "),
  });

  const header = `<b>${escapeHtml(ownerLabel())}</b>\n\n`;
  return { text: header + lines.join("\n"), sentScopes: sent, deniedRequest: false };
}
