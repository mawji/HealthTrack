// Minimal Telegram Bot API client — only the outbound calls the app makes
// server-side. Inbound updates are pumped in by the long-poll bridge
// (scripts/telegram-bridge.mjs), so getUpdates lives there, not here.
//
// Telegram Bot API: https://core.telegram.org/bots/api

import { getBotToken } from "@/lib/telegram/config";

const TG_MAX = 4096; // Telegram hard message-length limit

function apiUrl(method: string): string {
  const token = getBotToken();
  if (!token) throw new Error("Telegram bot token not configured");
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result;
}

/** Escape user/data text for Telegram's HTML parse mode. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Split a long HTML message at line boundaries so each chunk fits TG_MAX. */
function chunk(text: string): string[] {
  if (text.length <= TG_MAX) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (buf.length + line.length + 1 > TG_MAX) {
      if (buf) out.push(buf);
      // A single over-long line is hard-split as a last resort.
      if (line.length > TG_MAX) {
        for (let i = 0; i < line.length; i += TG_MAX) out.push(line.slice(i, i + TG_MAX));
        buf = "";
      } else {
        buf = line;
      }
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export type InlineButton = { text: string; callback_data: string };

/** Send a message (HTML parse mode), auto-chunked. Optional inline keyboard is
 *  attached to the final chunk. Returns the last sent message's id. */
export async function sendMessage(
  chatId: number,
  text: string,
  opts: { buttons?: InlineButton[][]; disablePreview?: boolean } = {}
): Promise<number | undefined> {
  const chunks = chunk(text);
  let lastId: number | undefined;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: "HTML",
      link_preview_options: { is_disabled: opts.disablePreview ?? true },
    };
    if (isLast && opts.buttons?.length) {
      body.reply_markup = { inline_keyboard: opts.buttons };
    }
    const result = await call("sendMessage", body);
    lastId = result?.message_id;
  }
  return lastId;
}

/** Send a photo from a Buffer (used later for rendered metric cards). */
export async function sendPhoto(chatId: number, png: Buffer, caption?: string): Promise<void> {
  const token = getBotToken();
  if (!token) throw new Error("Telegram bot token not configured");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("photo", new Blob([Uint8Array.from(png)], { type: "image/png" }), "card.png");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`Telegram sendPhoto failed: ${json.description ?? res.status}`);
}

/** Acknowledge a callback query (button tap) so the client stops its spinner. */
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(
    () => {}
  );
}

/** Edit an existing message's reply markup — used to disable buttons after a tap. */
export async function clearButtons(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(
    () => {}
  );
}

/** Register the slash-command menu shown in the Telegram client. */
export async function setMyCommands(
  commands: { command: string; description: string }[]
): Promise<void> {
  await call("setMyCommands", { commands }).catch(() => {});
}
