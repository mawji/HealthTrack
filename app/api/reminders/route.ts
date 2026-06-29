// CRUD for dynamic user-set reminders. The coach's setReminder / cancelReminder
// actions POST/DELETE here (same path for web ActionRunner and the Telegram
// action runner — one logging implementation). GET lists active reminders.

import { NextRequest, NextResponse } from "next/server";
import { createReminder, cancelReminder, listActiveReminders } from "@/lib/reminders";

export async function GET() {
  return NextResponse.json({ reminders: listActiveReminders() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rec = createReminder({
      text: body.text,
      kind: body.kind,
      dueAt: body.dueAt,
      atTime: body.atTime,
      days: body.days,
    });
    return NextResponse.json(rec);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("id") || searchParams.get("match") || "";
  const rec = cancelReminder(key);
  if (!rec) return NextResponse.json({ error: "no matching reminder" }, { status: 404 });
  return NextResponse.json(rec);
}
