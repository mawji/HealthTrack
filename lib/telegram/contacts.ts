// Shared-contact store: the owner's allow-list of people who may DM the bot and
// the per-contact scopes that bound what each can ever see. Local JSON only,
// never uploaded. Binding a contact requires the contact to complete a pairing
// code, so the bot only ever answers a confirmed Telegram user id.

import { readJson, writeJson, newId } from "@/lib/store";
import { sanitizeScopes, PRESET_SCOPES, PresetName } from "@/lib/telegram/scopes";
import crypto from "crypto";

const FILE = "telegram/contacts.json";
const PAIRING_TTL_MS = 24 * 60 * 60 * 1000; // contact codes last 24h

export type ContactStatus = "pending" | "active" | "revoked";

export interface ReportSubscription {
  id: string;
  cadence: "daily" | "weekly";
  timeLocal: string; // "07:00"
  scopes: string[]; // subset of the contact's allowed scopes
}

export interface SharedContact {
  id: string;
  name: string;
  phone?: string;
  telegramUserId?: number; // bound after pairing; the bot only answers this id
  telegramChatId?: number;
  status: ContactStatus;
  preset?: PresetName;
  scopes: string[]; // explicit allowed scope keys (default-deny: starts empty)
  leaderboard: boolean;
  reports: ReportSubscription[];
  pairing?: { code: string; expiresAt: number };
  consentAt?: string;
  expiresAt?: string; // optional auto-expiry (ISO)
  createdAt: string;
  updatedAt: string;
}

export function listContacts(): SharedContact[] {
  return readJson<SharedContact[]>(FILE, []);
}

function saveAll(list: SharedContact[]) {
  writeJson(FILE, list);
}

export function getContact(id: string): SharedContact | null {
  return listContacts().find((c) => c.id === id) ?? null;
}

/** True when a contact is active, bound, and not past its expiry. */
export function isContactUsable(c: SharedContact, now = Date.now()): boolean {
  if (c.status !== "active") return false;
  if (c.telegramUserId == null) return false;
  if (c.expiresAt && Date.parse(c.expiresAt) < now) return false;
  return true;
}

/** Resolve an inbound Telegram user id to a usable contact, or null. The single
 *  read-side gate the handler trusts for "is this an allowed contact?". */
export function resolveContact(telegramUserId: number, now = Date.now()): SharedContact | null {
  return listContacts().find((c) => c.telegramUserId === telegramUserId && isContactUsable(c, now)) ?? null;
}

export function createContact(input: {
  name: string;
  phone?: string;
  preset?: PresetName;
  scopes?: string[];
  leaderboard?: boolean;
}): SharedContact {
  const now = new Date().toISOString();
  const preset = input.preset ?? "custom";
  const scopes =
    input.scopes != null
      ? sanitizeScopes(input.scopes)
      : preset !== "custom"
        ? [...PRESET_SCOPES[preset]]
        : [];
  const contact: SharedContact = {
    id: newId(),
    name: input.name.trim().slice(0, 80) || "Contact",
    phone: input.phone?.trim().slice(0, 40) || undefined,
    status: "pending",
    preset,
    scopes,
    leaderboard: Boolean(input.leaderboard),
    reports: [],
    createdAt: now,
    updatedAt: now,
  };
  const list = listContacts();
  list.push(contact);
  saveAll(list);
  return contact;
}

export function updateContact(
  id: string,
  patch: Partial<Pick<SharedContact, "name" | "phone" | "preset" | "scopes" | "leaderboard" | "expiresAt" | "reports">>
): SharedContact | null {
  const list = listContacts();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  if (patch.name != null) c.name = patch.name.trim().slice(0, 80) || c.name;
  if (patch.phone !== undefined) c.phone = patch.phone?.trim().slice(0, 40) || undefined;
  if (patch.preset != null) c.preset = patch.preset;
  if (patch.scopes != null) c.scopes = sanitizeScopes(patch.scopes);
  if (patch.leaderboard != null) c.leaderboard = Boolean(patch.leaderboard);
  if (patch.expiresAt !== undefined) c.expiresAt = patch.expiresAt || undefined;
  if (patch.reports != null) c.reports = patch.reports;
  c.updatedAt = new Date().toISOString();
  saveAll(list);
  return c;
}

export function deleteContact(id: string): boolean {
  const list = listContacts();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  saveAll(next);
  return true;
}

/** Revoke immediately: unbind and stop all access/reports. Kept (not deleted)
 *  so the audit trail and the owner's record of the share remain. */
export function revokeContact(id: string): SharedContact | null {
  const list = listContacts();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  c.status = "revoked";
  c.telegramUserId = undefined;
  c.telegramChatId = undefined;
  c.pairing = undefined;
  c.updatedAt = new Date().toISOString();
  saveAll(list);
  return c;
}

/** Generate (or reuse) a pairing code for a contact to send as /start <code>. */
export function startContactPairing(id: string): { code: string; expiresAt: number } | null {
  const list = listContacts();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  const now = Date.now();
  if (c.pairing && c.pairing.expiresAt > now) return c.pairing;
  c.pairing = { code: crypto.randomBytes(5).toString("hex"), expiresAt: now + PAIRING_TTL_MS };
  c.status = c.status === "revoked" ? "pending" : c.status;
  c.updatedAt = new Date().toISOString();
  saveAll(list);
  return c.pairing;
}

/** Complete a contact's pairing from an inbound /start <code>. Binds the user id,
 *  records consent, sets status active. Returns the bound contact or null. */
export function completeContactPairing(
  code: string,
  telegramUserId: number,
  telegramChatId: number
): SharedContact | null {
  const list = listContacts();
  const now = Date.now();
  const c = list.find((x) => x.pairing && x.pairing.code.toLowerCase() === code.trim().toLowerCase());
  if (!c || !c.pairing || c.pairing.expiresAt < now) return null;
  // Don't let one code bind two people: refuse if already bound to someone else.
  if (c.telegramUserId != null && c.telegramUserId !== telegramUserId) return null;
  c.telegramUserId = telegramUserId;
  c.telegramChatId = telegramChatId;
  c.status = "active";
  c.consentAt = new Date().toISOString();
  c.pairing = undefined;
  c.updatedAt = c.consentAt;
  saveAll(list);
  return c;
}
