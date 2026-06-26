// Inbound Telegram updates, forwarded by the local long-poll bridge
// (scripts/telegram-bridge.mjs). The bridge is the only intended caller: it
// authenticates with the shared bridge secret. The bot's own owner gate lives
// deeper, in the handler — this check just keeps the endpoint from doing work
// for anything other than our local pump (it's already bound to 127.0.0.1).

import { NextRequest, NextResponse } from "next/server";
import { getBridgeSecret, isBotConfigured } from "@/lib/telegram/config";
import { handleUpdate, TgUpdate } from "@/lib/telegram/handler";

export async function POST(req: NextRequest) {
  if (!isBotConfigured()) {
    return NextResponse.json({ error: "Telegram bot not configured" }, { status: 400 });
  }
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== getBridgeSecret()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ error: "bad update" }, { status: 400 });
  }

  // Process and reply within the handler; acknowledge fast either way so the
  // bridge can advance its offset (we never want Telegram to redeliver).
  await handleUpdate(update);
  return NextResponse.json({ ok: true });
}
