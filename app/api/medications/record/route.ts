import { NextRequest, NextResponse } from "next/server";
import { localDateStr } from "@/lib/store";
import {
  upsertMedicationRecord,
  deleteMedicationRecord,
  getMedications,
  getMedicationRecords,
  computeMedicationStatus,
  scheduleLabel,
} from "@/lib/medications";
import { localNowParts } from "@/lib/medication-reminders";

function daysAgo(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** GET /api/medications/record?days=N → recent records joined with their
 *  definition (name/dose) for a history view, newest first. */
export async function GET(req: NextRequest) {
  const days = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 30)), 365);
  const cutoff = daysAgo(localDateStr(), days - 1);
  const defs = new Map(getMedications().map((m) => [m.id, m]));
  const records = getMedicationRecords()
    .filter((r) => r.date >= cutoff)
    .map((r) => {
      const m = defs.get(r.medicationId);
      return {
        id: r.id,
        medicationId: r.medicationId,
        date: r.date,
        doseIndex: r.doseIndex,
        status: r.status,
        takenAt: r.takenAt,
        note: r.note,
        name: m?.name ?? r.medicationId,
        kind: m?.kind,
        schedule: m ? scheduleLabel(m) : undefined,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.takenAt ?? "").localeCompare(a.takenAt ?? "")));
  return NextResponse.json({ records });
}

/** DELETE /api/medications/record?id=… → remove one logged record. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  return NextResponse.json({ ok: deleteMedicationRecord(id) });
}

/** POST /api/medications/record → mark a dose taken/skipped (or clear) for a
 *  date. Body: { medicationId, date?, doseIndex?, status, note? }. Idempotent
 *  per (medicationId, date, doseIndex). status=null clears the record. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const medicationId = String(body.medicationId ?? "");
  if (!medicationId) return NextResponse.json({ error: "missing medicationId" }, { status: 400 });

  const med = getMedications().find((m) => m.id === medicationId);
  if (!med) return NextResponse.json({ error: "unknown medication" }, { status: 404 });

  const status =
    body.status === "taken" || body.status === "skipped" ? body.status : body.status == null ? null : undefined;
  if (status === undefined) {
    return NextResponse.json({ error: "status must be taken|skipped|null" }, { status: 400 });
  }

  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : localDateStr();

  const record = upsertMedicationRecord({
    medicationId,
    date,
    doseIndex: body.doseIndex,
    status,
    note: body.note,
  });

  const { date: today, nowMin } = localNowParts();
  const statusObj = computeMedicationStatus(med, getMedicationRecords(), date, today, nowMin);
  return NextResponse.json({ record, status: statusObj });
}
