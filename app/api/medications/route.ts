import { NextRequest, NextResponse } from "next/server";
import { localDateStr } from "@/lib/store";
import {
  getMedications,
  saveMedications,
  sanitizeMedication,
  nextMedicationId,
  getMedicationRecords,
  computeMedicationStatus,
} from "@/lib/medications";
import { localNowParts } from "@/lib/medication-reminders";
import { MedicationsPayload } from "@/lib/types";

function isoDate(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localDateStr();
}

/** GET /api/medications?date=yyyy-MM-dd → definitions + that day's records + status. */
export async function GET(req: NextRequest) {
  const date = isoDate(req.nextUrl.searchParams.get("date"));
  const { date: today, nowMin } = localNowParts();
  const meds = getMedications();
  const records = getMedicationRecords();
  const payload: MedicationsPayload = {
    date,
    medications: meds,
    records: records.filter((r) => r.date === date),
    status: meds.map((m) => computeMedicationStatus(m, records, date, today, nowMin)),
  };
  return NextResponse.json(payload);
}

/** POST /api/medications → create a medication definition. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = sanitizeMedication(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const meds = getMedications();
  result.id = nextMedicationId(result.name, new Set(meds.map((m) => m.id)));
  meds.push(result);
  saveMedications(meds);
  return NextResponse.json(result);
}

/** PATCH /api/medications?id=... → update an existing definition. */
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const meds = getMedications();
  const idx = meds.findIndex((m) => m.id === id);
  if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const result = sanitizeMedication(body, meds[idx]);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  result.id = meds[idx].id; // id is immutable
  meds[idx] = result;
  saveMedications(meds);
  return NextResponse.json(result);
}

/** DELETE /api/medications?id=... → archive (deactivate) by default; ?hard=1
 *  erases the definition. Records are always kept so history survives. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const hard = req.nextUrl.searchParams.get("hard") === "1";
  let meds = getMedications();
  const existing = meds.find((m) => m.id === id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (hard) {
    meds = meds.filter((m) => m.id !== id);
  } else {
    existing.active = false;
    existing.updatedAt = new Date().toISOString();
  }
  saveMedications(meds);
  return NextResponse.json({ ok: true, archived: !hard });
}
