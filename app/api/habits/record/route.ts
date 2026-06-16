import { NextRequest, NextResponse } from "next/server";
import { localDateStr } from "@/lib/store";
import {
  upsertHabitRecord,
  getHabitDefinitions,
  getHabitRecords,
  computeHabitStatus,
} from "@/lib/habits";

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
