// Append-only audit trail of every outbound share to a contact: when, to whom,
// which scopes, and a short digest of what was sent. Local JSON; viewable in the
// in-app share review. Never trimmed below a generous cap so the owner keeps a
// real record.

import { readJson, writeJson } from "@/lib/store";

const FILE = "telegram/share-audit.json";
const KEEP = 1000;

export interface ShareAuditRecord {
  at: string;
  contactId: string;
  contactName: string;
  scopes: string[];
  kind: "reply" | "report" | "leaderboard";
  digest: string; // short, non-sensitive summary (scope labels, not values)
}

export function getAudit(): ShareAuditRecord[] {
  return readJson<ShareAuditRecord[]>(FILE, []);
}

export function recordShare(rec: Omit<ShareAuditRecord, "at">) {
  const log = getAudit();
  log.push({ ...rec, at: new Date().toISOString() });
  writeJson(FILE, log.slice(-KEEP));
}

export function auditForContact(contactId: string): ShareAuditRecord[] {
  return getAudit().filter((r) => r.contactId === contactId);
}
