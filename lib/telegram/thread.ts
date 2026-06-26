// The owner's Telegram conversation history, for coach context continuity —
// the equivalent of the in-memory message list the web chat keeps. Capped so the
// stored thread (and the slice sent to the model) stays bounded.

import { readJson, writeJson } from "@/lib/store";
import { ChatMessage } from "@/lib/types";

const THREAD_FILE = "telegram/owner-thread.json";
const MAX_TURNS = 30; // keep the last N messages on disk

export function getThread(): ChatMessage[] {
  return readJson<ChatMessage[]>(THREAD_FILE, []);
}

export function appendTurn(role: ChatMessage["role"], content: string) {
  const thread = getThread();
  thread.push({ role, content });
  writeJson(THREAD_FILE, thread.slice(-MAX_TURNS));
}

export function resetThread() {
  writeJson(THREAD_FILE, []);
}
