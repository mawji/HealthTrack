// "Send a test nudge" — user-initiated from Settings to confirm the Telegram
// channel works. Unlike POST /evaluate (the scheduler's guarded path), this
// bypasses enabled/quiet-hours/caps and does NOT record a delivery, so testing
// never eats the daily budget. Local-only endpoint; no bridge secret needed
// because it's triggered from the in-app Settings UI.

import { NextResponse } from "next/server";
import { getPreferences } from "@/lib/proactive/preferences";
import { buildProactiveContext } from "@/lib/proactive/context";
import { RULES } from "@/lib/proactive/rules";
import { canDeliverTelegram, deliverToTelegram, sendOwnerMessage } from "@/lib/proactive/channels/telegram";
import { GuidanceCandidate, GuidancePriority } from "@/lib/proactive/types";

const RANK: Record<GuidancePriority, number> = { high: 0, medium: 1, low: 2 };

export async function POST() {
  if (!canDeliverTelegram()) {
    return NextResponse.json(
      { sent: false, error: "Pair your Telegram bot first (Settings → Telegram)." },
      { status: 400 }
    );
  }

  // Pick the most relevant real candidate right now (ignoring time windows so a
  // test always has something to show); fall back to a generic confirmation.
  const ctx = await buildProactiveContext(getPreferences());
  const fired = RULES.map((r) => r.evaluate(ctx)).filter(Boolean) as GuidanceCandidate[];
  fired.sort((a, b) => RANK[a.priority] - RANK[b.priority]);

  if (fired[0]) {
    await deliverToTelegram(fired[0]);
    return NextResponse.json({ sent: true, sample: fired[0].title });
  }
  await sendOwnerMessage("🔔 <b>Test nudge</b>\nYour proactive channel is working. Nothing needs your attention right now — nudges will arrive when a goal is behind.");
  return NextResponse.json({ sent: true, sample: "generic test" });
}
