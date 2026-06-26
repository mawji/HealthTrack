// Telegram delivery channel for proactive guidance (item 14's locked channel).
// Reuses the same bot client and owner identity as the coach interface (item 20)
// — proactive nudges land in the owner's existing chat.

import { sendMessage, escapeHtml } from "@/lib/telegram/bot";
import { isBotConfigured } from "@/lib/telegram/config";
import { getOwner } from "@/lib/telegram/owner";
import { GuidanceCandidate } from "@/lib/proactive/types";

export function canDeliverTelegram(): boolean {
  return isBotConfigured() && typeof getOwner().chatId === "number";
}

/** Send a single nudge to the owner. Returns true if it was sent. */
export async function deliverToTelegram(c: GuidanceCandidate): Promise<boolean> {
  const chatId = getOwner().chatId;
  if (!isBotConfigured() || chatId == null) return false;
  const text = `🔔 <b>${escapeHtml(c.title)}</b>\n${escapeHtml(c.body)}`;
  await sendMessage(chatId, text);
  return true;
}

/** Send an arbitrary report/digest message to the owner (used by scheduled reports). */
export async function sendOwnerMessage(html: string): Promise<boolean> {
  const chatId = getOwner().chatId;
  if (!isBotConfigured() || chatId == null) return false;
  await sendMessage(chatId, html);
  return true;
}
