// Local persistence for coach chat conversations, so the user can revisit or
// continue a past chat. Messages are stored verbatim — including the ```viz and
// ```log fenced blocks the coach emits — so the visuals re-render exactly when a
// conversation is reopened (the renderer rebuilds cards from the fenced JSON in
// the message text; no separate visual store needed). Local only
// (data/coach-conversations.json), never synced.

import { readJson, writeJson, newId } from "./store";
import { ChatMessage } from "./types";

const FILE = "coach-conversations.json";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

/** Lightweight row for the history list (no message bodies). */
export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function getAll(): Conversation[] {
  return readJson<Conversation[]>(FILE, []);
}
function saveAll(rows: Conversation[]) {
  writeJson(FILE, rows);
}

/** A short title from the first user message (falls back to a generic label). */
function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user")?.content?.trim();
  if (!firstUser) return "New chat";
  const oneLine = firstUser.replace(/\s+/g, " ").slice(0, 60);
  return oneLine.length < firstUser.trim().length ? `${oneLine}…` : oneLine;
}

export function listConversations(): ConversationMeta[] {
  return getAll()
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }));
}

export function getConversation(id: string): Conversation | null {
  return getAll().find((c) => c.id === id) ?? null;
}

/** Create or replace a conversation by id. Returns the saved conversation. An
 *  empty message list is ignored (nothing to save). The title is re-derived each
 *  save so it tracks the first user message. */
export function saveConversation(id: string | null | undefined, messages: ChatMessage[]): Conversation | null {
  const cleaned = (messages ?? []).filter((m) => m && typeof m.content === "string");
  // Don't persist a bare seeded question with no real exchange yet.
  if (!cleaned.some((m) => m.role === "user")) return null;

  const rows = getAll();
  const now = new Date().toISOString();
  const existing = id ? rows.find((c) => c.id === id) : null;

  if (existing) {
    existing.messages = cleaned;
    existing.title = deriveTitle(cleaned);
    existing.updatedAt = now;
    saveAll(rows);
    return existing;
  }

  const conversation: Conversation = {
    id: id || newId(),
    title: deriveTitle(cleaned),
    createdAt: now,
    updatedAt: now,
    messages: cleaned,
  };
  rows.push(conversation);
  saveAll(rows);
  return conversation;
}

export function deleteConversation(id: string): boolean {
  const rows = getAll();
  const next = rows.filter((c) => c.id !== id);
  if (next.length === rows.length) return false;
  saveAll(next);
  return true;
}
