// In-app reminder delivery. The web coach page polls this on mount + on an
// interval; it runs the same idempotent firing pass as the scheduler tick (so an
// open browser surfaces due reminders even when the scheduler isn't running),
// then returns reminders fired in the recent window. The client dedups by
// id+firedAt and renders each as a coach chat bubble.

import { NextResponse } from "next/server";
import { fireDueReminders, recentlyFired } from "@/lib/reminders";

export async function GET() {
  await fireDueReminders().catch(() => []);
  return NextResponse.json({ fired: recentlyFired() });
}
