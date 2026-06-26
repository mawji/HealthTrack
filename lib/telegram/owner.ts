// Owner identity + pairing for the Telegram bot.
//
// HARD GATE: until the owner is paired, the bot answers nobody. After pairing,
// the bot answers ONLY the verified owner chat. This file is the single
// authorization choke point — item 24 (multi-person sharing) later widens
// `authorize()` from "owner only" to "owner OR an allow-listed scoped contact"
// without any other caller needing to change.

import crypto from "crypto";
import { readJson, writeJson } from "@/lib/store";

const OWNER_FILE = "telegram/owner.json";
const PAIRING_TTL_MS = 15 * 60 * 1000; // a fresh code is valid for 15 minutes

export type OwnerStore = {
  /** The verified owner's Telegram chat id; set once pairing completes. */
  chatId?: number;
  username?: string;
  pairedAt?: string;
  /** Owner's display name, shown to shared contacts as "<name>'s HealthTrack".
   *  Owner-entered in Settings; the Google profile carries no name. */
  ownerName?: string;
  /** A pending one-time pairing code shown in Settings, awaiting /start <code>. */
  pairing?: { code: string; expiresAt: number };
};

export function getOwner(): OwnerStore {
  return readJson<OwnerStore>(OWNER_FILE, {});
}

function save(store: OwnerStore) {
  writeJson(OWNER_FILE, store);
}

export function isPaired(): boolean {
  return typeof getOwner().chatId === "number";
}

/** Owner display name for sharing headers; falls back to "HealthTrack". */
export function getOwnerName(): string {
  return getOwner().ownerName?.trim() || "HealthTrack";
}

/** Possessive label shown to contacts: "Shams's HealthTrack", or just
 *  "HealthTrack" when the owner hasn't set a name (avoids "HealthTrack's
 *  HealthTrack"). */
export function ownerLabel(): string {
  const name = getOwner().ownerName?.trim();
  return name ? `${name}'s HealthTrack` : "HealthTrack";
}

export function setOwnerName(name: string) {
  const store = getOwner();
  store.ownerName = name.trim().slice(0, 60) || undefined;
  save(store);
}

/** Generate (or reuse a still-valid) pairing code for the Settings screen. */
export function startPairing(): { code: string; expiresAt: number } {
  const store = getOwner();
  const now = Date.now();
  if (store.pairing && store.pairing.expiresAt > now) return store.pairing;
  const code = crypto.randomBytes(4).toString("hex"); // 8 hex chars, easy to type
  store.pairing = { code, expiresAt: now + PAIRING_TTL_MS };
  save(store);
  return store.pairing;
}

/** Complete pairing when an inbound `/start <code>` matches the pending code.
 *  Returns true on success (and binds the chat id). */
export function completePairing(code: string, chatId: number, username?: string): boolean {
  const store = getOwner();
  const p = store.pairing;
  if (!p || p.expiresAt < Date.now()) return false;
  if (code.trim().toLowerCase() !== p.code.toLowerCase()) return false;
  store.chatId = chatId;
  store.username = username;
  store.pairedAt = new Date().toISOString();
  store.pairing = undefined;
  save(store);
  return true;
}

/** Unpair the bot — forgets the owner chat id and any pending code. */
export function unpair() {
  save({});
}

/** Authorization choke point. Returns the role for an inbound chat id.
 *  Today: only the owner is recognized. Item 24 extends this. */
export function authorize(chatId: number): "owner" | null {
  return getOwner().chatId === chatId ? "owner" : null;
}
