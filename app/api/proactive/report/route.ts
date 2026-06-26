// Scheduled self-report delivery. The local scheduler POSTs here (with the
// bridge secret) at the owner's report time; we build the deterministic digest
// and send it to the owner's Telegram. Only sends when proactive guidance is
// enabled and the bot is paired.

import { NextRequest, NextResponse } from "next/server";
import { getBridgeSecret } from "@/lib/telegram/config";
import { getPreferences } from "@/lib/proactive/preferences";
import { buildDailyReport } from "@/lib/proactive/report";
import { canDeliverTelegram, sendOwnerMessage } from "@/lib/proactive/channels/telegram";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== getBridgeSecret()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!getPreferences().enabled) return NextResponse.json({ sent: false, reason: "disabled" });
  if (!canDeliverTelegram()) return NextResponse.json({ sent: false, reason: "telegram unavailable" });

  const html = await buildDailyReport();
  const sent = await sendOwnerMessage(html).catch(() => false);
  return NextResponse.json({ sent });
}
