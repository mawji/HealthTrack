// Proactive evaluation endpoint.
//   GET  → dry-run: rank candidates and report what WOULD be sent (never sends).
//   POST → live run: actually delivers one nudge if guardrails allow. Restricted
//          to the local scheduler/bridge via the shared bridge secret.

import { NextRequest, NextResponse } from "next/server";
import { evaluate } from "@/lib/proactive/engine";
import { getBridgeSecret } from "@/lib/telegram/config";

export async function GET() {
  const result = await evaluate({ send: false });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== getBridgeSecret()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await evaluate({ send: true });
  return NextResponse.json(result);
}
