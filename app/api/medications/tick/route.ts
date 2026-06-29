// Medication reminder tick.
//   GET  → dry-run: which reminders WOULD fire now (never sends). For the UI/debug.
//   POST → live run: deliver due reminders to the owner's Telegram. Restricted to
//          the local scheduler via the shared bridge secret. Runs more often than
//          the 15-min proactive tick so an "at 11:00" (± lead) dose is timely.

import { NextRequest, NextResponse } from "next/server";
import { getBridgeSecret } from "@/lib/telegram/config";
import {
  runMedicationReminderTick,
  computeDueReminders,
  localNowParts,
} from "@/lib/medication-reminders";
import { getMedications, getMedicationRecords } from "@/lib/medications";

export async function GET() {
  const { date, nowMin } = localNowParts();
  const due = computeDueReminders(getMedications(), getMedicationRecords(), date, nowMin, new Set());
  return NextResponse.json({ date, nowMin, due });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== getBridgeSecret()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await runMedicationReminderTick();
  return NextResponse.json(result);
}
