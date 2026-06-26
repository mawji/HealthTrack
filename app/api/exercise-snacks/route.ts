import { NextRequest, NextResponse } from "next/server";
import {
  getSnackDay,
  resolveSnackHr,
  completeSnack,
  undoSnack,
  setSnackTarget,
} from "@/lib/exercise-snacks";

/** GET /api/exercise-snacks?date=yyyy-MM-dd → that day's target + completions
 *  (defaults to today), with each completed snack's post-hoc max HR resolved
 *  where the watch has synced it. */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  try {
    return NextResponse.json(await resolveSnackHr(date ?? undefined));
  } catch {
    return NextResponse.json(getSnackDay(date ?? undefined));
  }
}

/** POST /api/exercise-snacks → credit one snack.
 *  Body: { date?, routineId?, source? }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const state = completeSnack({
    date: typeof body.date === "string" ? body.date : undefined,
    routineId: typeof body.routineId === "string" ? body.routineId : undefined,
    source: body.source,
  });
  return NextResponse.json(state);
}

/** PATCH /api/exercise-snacks → update the daily target. Body: { target }. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  setSnackTarget(body.target);
  return NextResponse.json(getSnackDay(typeof body.date === "string" ? body.date : undefined));
}

/** DELETE /api/exercise-snacks?date=&entryId= → undo a snack (a specific entry,
 *  else the most recent for the date). */
export async function DELETE(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const entryId = req.nextUrl.searchParams.get("entryId") ?? undefined;
  return NextResponse.json(undoSnack({ date: date ?? undefined, entryId: entryId ?? undefined }));
}
