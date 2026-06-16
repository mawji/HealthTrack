import { NextRequest, NextResponse } from "next/server";
import { localDateStr } from "@/lib/store";
import {
  getHabitDefinitions,
  saveHabitDefinitions,
  sanitizeHabitDefinition,
  nextHabitId,
  getHabitRecords,
  computeHabitStatus,
} from "@/lib/habits";
import { HabitsPayload } from "@/lib/types";

function isoDate(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localDateStr();
}

/** GET /api/habits?date=yyyy-MM-dd → definitions + that day's records + status. */
export async function GET(req: NextRequest) {
  const date = isoDate(req.nextUrl.searchParams.get("date"));
  const today = localDateStr();
  const habits = getHabitDefinitions();
  const records = getHabitRecords();
  const payload: HabitsPayload = {
    date,
    habits,
    records: records.filter((r) => r.date === date),
    status: habits.map((h) => computeHabitStatus(h, records, date, today)),
  };
  return NextResponse.json(payload);
}

/** POST /api/habits → create a habit definition. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = sanitizeHabitDefinition(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const habits = getHabitDefinitions();
  const taken = new Set(habits.map((h) => h.id));
  result.id = nextHabitId(result.name, taken);
  habits.push(result);
  saveHabitDefinitions(habits);
  return NextResponse.json(result);
}

/** PATCH /api/habits?id=... → update an existing definition. */
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const habits = getHabitDefinitions();
  const idx = habits.findIndex((h) => h.id === id);
  if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const result = sanitizeHabitDefinition(body, habits[idx]);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  result.id = habits[idx].id; // id is immutable
  habits[idx] = result;
  saveHabitDefinitions(habits);
  return NextResponse.json(result);
}

/** DELETE /api/habits?id=... → archive (deactivate) by default; ?hard=1 erases
 *  the definition. Records are always kept so history survives. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const hard = req.nextUrl.searchParams.get("hard") === "1";
  let habits = getHabitDefinitions();
  const existing = habits.find((h) => h.id === id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (hard) {
    habits = habits.filter((h) => h.id !== id);
  } else {
    existing.active = false;
    existing.updatedAt = new Date().toISOString();
  }
  saveHabitDefinitions(habits);
  return NextResponse.json({ ok: true, archived: !hard });
}
