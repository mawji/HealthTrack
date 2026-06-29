// Wellbeing Journal API — the read surface for the coach's background-intelligence
// view, plus a manual "run now" trigger. Phase 1 reflection is deterministic and
// free (no model, no outbound side effect), so POST is unguarded for the local
// single-user app — same posture as the user-initiated proactive test. The
// nightly scheduler hits this same POST. See plans/coach-background-intelligence.md.

import { NextRequest, NextResponse } from "next/server";
import { runReflection, getWellbeingEntries, getLatestEntry } from "@/lib/coach/wellbeing";
import { buildDigest } from "@/lib/coach/digest";
import { recentNotes } from "@/lib/coach/scratchpad";
import { getIntelligenceSettings } from "@/lib/coach/intelligence-settings";

export async function GET() {
  const [digest, settings] = [await buildDigest(), getIntelligenceSettings()];
  return NextResponse.json({
    settings,
    latest: getLatestEntry(),
    entries: getWellbeingEntries(20),
    digest,
    notes: recentNotes(30),
  });
}

export async function POST(req: NextRequest) {
  const trigger = new URL(req.url).searchParams.get("trigger") === "scheduled" ? "scheduled" : "manual";
  // Scheduled runs respect the on/off gate; manual "run now" always works.
  if (trigger === "scheduled" && !getIntelligenceSettings().enabled) {
    return NextResponse.json({ ran: false, reason: "background intelligence disabled" });
  }
  const result = await runReflection(trigger);
  return NextResponse.json(result);
}
