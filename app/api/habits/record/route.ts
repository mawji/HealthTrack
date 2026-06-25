import { NextRequest, NextResponse } from "next/server";
import { localDateStr } from "@/lib/store";
import {
  upsertHabitRecord,
  getHabitDefinitions,
  getHabitRecords,
  computeHabitStatus,
  deleteHabitRecord,
} from "@/lib/habits";

function daysAgo(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** GET /api/habits/record?days=N → recent habit records joined with their
 *  definition (name/unit/type) for the Journal, newest first. */
export async function GET(req: NextRequest) {
  const days = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 60)), 365);
  const cutoff = daysAgo(localDateStr(), days - 1);
  const defs = new Map(getHabitDefinitions().map((h) => [h.id, h]));
  const records = getHabitRecords()
    .filter((r) => r.date >= cutoff)
    .map((r) => {
      const h = defs.get(r.habitId);
      return {
        id: r.id, habitId: r.habitId, date: r.date, value: r.value, note: r.note, completed: r.completed,
        name: h?.name ?? r.habitId, unit: h?.unit, targetType: h?.targetType, iconKey: h?.iconKey ?? "check", kind: h?.kind,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return NextResponse.json({ records });
}

/** DELETE /api/habits/record?id=… → remove one logged habit record. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  return NextResponse.json({ ok: deleteHabitRecord(id) });
}

/** POST /api/habits/record → log (or clear) one habit's value for a date.
 *  Body: { habitId, date?, value, note? }. value=null clears the record.
 *  Returns the saved record plus the recomputed status (streak, completed). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const habitId = String(body.habitId ?? "");
  if (!habitId) return NextResponse.json({ error: "missing habitId" }, { status: 400 });

  const habit = getHabitDefinitions().find((h) => h.id === habitId);
  if (!habit) return NextResponse.json({ error: "unknown habit" }, { status: 404 });

  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : localDateStr();

  const record = upsertHabitRecord({
    habitId,
    date,
    value: body.value ?? null,
    note: body.note,
  });

  const status = computeHabitStatus(habit, getHabitRecords(), date, localDateStr());
  return NextResponse.json({ record, status });
}
