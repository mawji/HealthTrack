import { NextRequest, NextResponse } from "next/server";
import { getMedicationSettings, setMedicationSettings } from "@/lib/medication-settings";

/** GET /api/medications/settings → global reminder defaults + escalation knobs. */
export async function GET() {
  return NextResponse.json(getMedicationSettings());
}

/** PATCH /api/medications/settings → update the global reminder settings. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const next = setMedicationSettings(body ?? {});
  return NextResponse.json(next);
}
