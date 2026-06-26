// Coach conversation history CRUD (local-only). The coach page saves the current
// chat after each exchange and lists/opens past ones. Messages (incl. viz/log
// fences) are stored verbatim so visuals re-render on reopen. See lib/conversations.ts.

import { NextRequest, NextResponse } from "next/server";
import {
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
} from "@/lib/conversations";
import { ChatMessage } from "@/lib/types";

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
  return NextResponse.json(saved);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  return NextResponse.json({ ok: deleteConversation(id) });
}
