// Dynamic-reminder tick. POST → fire any due reminders and push them to the
// owner's Telegram. Secret-gated like the medication tick; called every loop by
// the local scheduler (scripts/proactive-scheduler.mjs). GET is a dry-run view
// of what fired in the recent window (never fires).

import { NextRequest, NextResponse } from "next/server";
import { getBridgeSecret } from "@/lib/telegram/config";
import { fireDueReminders, recentlyFired } from "@/lib/reminders";

export async function GET() {
  return NextResponse.json({ recent: recentlyFired() });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== getBridgeSecret()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const fired = await fireDueReminders();
  return NextResponse.json({ sent: fired.length, fired });
}
