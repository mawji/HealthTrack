import { NextRequest, NextResponse } from "next/server";
import {
  getPlanItems,
  getUpcoming,
  addPlanItem,
  updatePlanItem,
  deletePlanItem,
  completePlanItem,
} from "@/lib/training-plan";
import { getProfile, deriveProfile } from "@/lib/profile";
import { latestDeviceWeightKg } from "@/lib/context";

/** Weight used for MET calorie estimates (device-preferred, else manual). */
async function planWeight(): Promise<number | null> {
  return deriveProfile(getProfile(), await latestDeviceWeightKg()).weightKgResolved;
}

/** GET /api/workout-plans            → all plan items
 *  GET /api/workout-plans?upcoming=1 → planned items, today + next 7 days */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("upcoming") === "1") {
    return NextResponse.json({ items: getUpcoming() });
  }
  return NextResponse.json({ items: getPlanItems() });
}

/** POST → create a plan item. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const item = addPlanItem(body, await planWeight());
  return NextResponse.json(item);
}

/** PATCH ?id=… → edit, or { action: "complete" | "skip" } the item. */
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "complete") {
    const item = await completePlanItem(id);
    return item ? NextResponse.json(item) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (body.action === "skip") {
    const item = updatePlanItem(id, { status: "skipped" }, await planWeight());
    return item ? NextResponse.json(item) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const item = updatePlanItem(id, body, await planWeight());
  return item ? NextResponse.json(item) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** DELETE ?id=… → remove a plan item (never touches workout history). */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  return NextResponse.json({ ok: deletePlanItem(id) });
}
