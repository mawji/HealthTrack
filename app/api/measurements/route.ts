import { NextRequest, NextResponse } from "next/server";
import {
  recentMeasurements,
  getMeasurements,
  addMeasurement,
  updateMeasurement,
  deleteMeasurement,
  deleteMeasurementFromHealth,
  syncMeasurementToHealth,
  markMeasurementSynced,
} from "@/lib/measurements";
import { MeasurementKind } from "@/lib/types";
import { runMemoryWatchers } from "@/lib/memory-watchers";

/** GET /api/measurements?kind=&limit= → recent manual measurements, newest first. */
export async function GET(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get("kind") as MeasurementKind | null) ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit")) || undefined;
  return NextResponse.json({ measurements: recentMeasurements({ kind, limit }) });
}

/** POST /api/measurements → log one measurement. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const m = addMeasurement(body);
  if ("error" in m) return NextResponse.json(m, { status: 400 });
  // Best-effort write-back to Google Health (no-ops to local-only until the
  // measurements writeonly scope is granted via a reconnect).
  try {
    const googleName = await syncMeasurementToHealth(m);
    if (googleName !== null) {
      markMeasurementSynced(m.id, googleName);
      m.syncedToHealth = true;
      if (googleName) m.googleName = googleName;
    }
  } catch (e) {
    console.error("Measurement Google Health sync failed:", e);
  }
  // Silent watchers: a new BP/weight reading may reveal (or resolve) a pattern.
  try {
    runMemoryWatchers();
  } catch (e) {
    console.error("Memory watchers failed:", e);
  }
  return NextResponse.json(m);
}

/** PATCH /api/measurements?id=... → edit a logged measurement. */
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const m = updateMeasurement(id, body);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(m);
}

/** DELETE /api/measurements?id=... */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const existing = getMeasurements().find((m) => m.id === id);
  if (existing) await deleteMeasurementFromHealth(existing).catch(() => {});
  return NextResponse.json({ ok: deleteMeasurement(id) });
}
