// Coach memory CRUD. Local-only durable facts the coach reads each turn and can
// write to as it learns. The web ActionRunner and the server-side action runner
// (Telegram parity) both POST/PATCH/DELETE here. See lib/memory.ts.

import { NextRequest, NextResponse } from "next/server";
import { getActiveMemories, addMemory, updateMemory, archiveMemory } from "@/lib/memory";

export async function GET() {
  return NextResponse.json({ memories: getActiveMemories() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = addMemory(body);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result.memory);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const updated = updateMemory(id, body);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = archiveMemory(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
