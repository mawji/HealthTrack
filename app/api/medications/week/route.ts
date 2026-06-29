import { NextRequest, NextResponse } from "next/server";
import { getMedications, getMedicationRecords, computeMedicationStatus } from "@/lib/medications";
import { localNowParts } from "@/lib/medication-reminders";
import { sundayOf } from "@/lib/medication-display";
import { MedicationDayStatus } from "@/lib/types";

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** GET /api/medications/week?days=7&end=yyyy-MM-dd → per-day computed statuses
 *  for the pill-box organizer + per-card weekly strips, oldest first.
 *  `?week=current` returns the current Monday→Sunday week (used by the organizer);
 *  otherwise `end` defaults to today and the window is the trailing `days`. */
export async function GET(req: NextRequest) {
  const { date: today, nowMin } = localNowParts();
  const currentWeek = req.nextUrl.searchParams.get("week") === "current";
  const end = (() => {
    if (currentWeek) return sundayOf(today);
    const e = req.nextUrl.searchParams.get("end");
    return e && /^\d{4}-\d{2}-\d{2}$/.test(e) ? e : today;
  })();
  const days = currentWeek ? 7 : Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7)), 31);

  const meds = getMedications().filter((m) => m.active);
  const records = getMedicationRecords();

  const out: { date: string; status: MedicationDayStatus[] }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    out.push({ date, status: meds.map((m) => computeMedicationStatus(m, records, date, today, nowMin)) });
  }
  return NextResponse.json({ today, end, days: out, medications: meds });
}
