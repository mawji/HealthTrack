import { NextRequest, NextResponse } from "next/server";
import { getActiveSession, startSession, patchSession, discardSession, elapsedMs } from "@/lib/workout-session";

/** GET → the in-progress session (+ elapsed ms), or { session: null }. */
export async function GET() {
  const session = getActiveSession();
  return NextResponse.json({ session, elapsedMs: session ? elapsedMs(session) : 0 });
}

/** POST → start a session (or return the one already running). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const session = startSession(body ?? {});
  return NextResponse.json({ session, elapsedMs: elapsedMs(session) });
}

/** PATCH → { action: "pause"|"resume" } or update name/exercises. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const session = patchSession(body ?? {});
  if (!session) return NextResponse.json({ error: "no active session" }, { status: 404 });
  return NextResponse.json({ session, elapsedMs: elapsedMs(session) });
}

/** DELETE → discard the in-progress session (writes nothing to history). */
export async function DELETE() {
  discardSession();
  return NextResponse.json({ ok: true });
}
