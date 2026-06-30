// Coach conversation history CRUD (local-only). The coach page saves the current
// chat after each exchange and lists/opens past ones. Messages (incl. viz/log
// fences) are stored verbatim so visuals re-render on reopen. See lib/conversations.ts.

import { NextRequest, NextResponse } from "next/server";
import {
  listConversations,
  getConversation,
  saveConversation,
  renameConversation,
  deleteConversation,
} from "@/lib/conversations";
import { hasAiKey, complete } from "@/lib/ai-provider";
import { ChatMessage } from "@/lib/types";

/** A concise, specific title for the chat from its opening exchange. Falls back
 *  (returns null) when there's no AI configured or it doesn't answer cleanly —
 *  the caller then keeps the instant derived title. */
async function generateTitle(messages: ChatMessage[]): Promise<string | null> {
  if (!hasAiKey()) return null;
  // Strip the ```viz / ```log fenced JSON so the model titles the conversation,
  // not the embedded payloads. Keep it to the first couple of turns.
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, 4)
    .map((m) => {
      const text = m.content.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
      return `${m.role === "user" ? "User" : "Coach"}: ${text.slice(0, 400)}`;
    })
    .filter((l) => l.length > 6)
    .join("\n");
  if (!transcript) return null;

  const system =
    "You title a health-coach chat. Reply with ONLY a short, specific title (3–6 words, Title Case, no quotes, no trailing punctuation) capturing what the conversation is about.";
  try {
    const raw = await complete([
      { role: "system", content: system },
      { role: "user", content: transcript },
    ]);
    const title = raw.split("\n")[0].trim().replace(/^["']|["']$/g, "").replace(/[.\s]+$/, "");
    return title && title.length <= 70 ? title : null;
  } catch {
    return null;
  }
}

/** GET            → list (metadata only)
 *  GET ?id=<id>   → one full conversation */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const conversation = getConversation(id);
    if (!conversation) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(conversation);
  }
  return NextResponse.json({ conversations: listConversations() });
}

/** POST {id?, messages} → upsert; returns the saved conversation (or null if it
 *  had no real exchange yet). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  const messages = Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : [];
  const saved = saveConversation(id, messages);

  // On first save (a brand-new conversation with a real exchange), upgrade the
  // instant derived title to an AI-generated one. Preserved on later saves.
  if (saved && !id && saved.messages.some((m) => m.role === "assistant" && m.content.trim())) {
    const aiTitle = await generateTitle(saved.messages);
    if (aiTitle) return NextResponse.json(renameConversation(saved.id, aiTitle) ?? saved);
  }
  return NextResponse.json(saved);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  return NextResponse.json({ ok: deleteConversation(id) });
}
