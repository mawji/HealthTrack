import { NextRequest, NextResponse } from "next/server";
import { startSnackSession, stopSnackSession } from "@/lib/exercise-snacks";

/** POST /api/exercise-snacks/session → control the live timer.
 *  Body: { action: "start" | "stop", auto?: boolean }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "start") return NextResponse.json(startSnackSession());
  if (body.action === "stop") return NextResponse.json(stopSnackSession({ auto: body.auto === true }));
  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
