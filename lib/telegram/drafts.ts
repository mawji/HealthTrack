// Pending log-action drafts awaiting the owner's Confirm/Cancel tap.
//
// Coach replies sent over Telegram can carry log actions. Because Telegram is a
// remote channel — and the watch-voice route (item 12) dictates over it, where
// speech-to-text errors are common — log actions are held as a draft and only
// executed when the owner taps Confirm. Drafts expire so a forgotten one can't
// fire later.

import { readJson, writeJson, newId } from "@/lib/store";
import { CoachAction } from "@/lib/coach/parse";

const DRAFTS_FILE = "telegram/drafts.json";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // unconfirmed drafts expire after 24h

type Draft = {
  id: string;
  chatId: number;
  actions: CoachAction[];
  createdAt: number;
};

function load(): Draft[] {
  const all = readJson<Draft[]>(DRAFTS_FILE, []);
  const cutoff = Date.now() - DRAFT_TTL_MS;
  const live = all.filter((d) => d.createdAt >= cutoff);
  if (live.length !== all.length) writeJson(DRAFTS_FILE, live);
  return live;
}

export function createDraft(chatId: number, actions: CoachAction[]): string {
  const drafts = load();
  const id = newId();
  drafts.push({ id, chatId, actions, createdAt: Date.now() });
  writeJson(DRAFTS_FILE, drafts);
  return id;
}

/** Pop a draft by id (removing it), or null if missing/expired. */
export function takeDraft(id: string): Draft | null {
  const drafts = load();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const [draft] = drafts.splice(idx, 1);
  writeJson(DRAFTS_FILE, drafts);
  return draft;
}
