import { NextRequest, NextResponse } from "next/server";
import { reorderHabits } from "@/lib/habits";

/** POST /api/habits/reorder → set a new manual display order.
 *  Body: { ids: string[] } — the desired order of (some) habit ids. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : null;
  if (!ids || !ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const habits = reorderHabits(ids);
  return NextResponse.json({ ok: true, order: habits.map((h) => h.id) });
}
