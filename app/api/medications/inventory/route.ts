import { NextRequest, NextResponse } from "next/server";
import { getMedications, setMedicationInventory, lowStockMeds, daysRemaining } from "@/lib/medications";
import { getMedicationSettings } from "@/lib/medication-settings";

/** GET /api/medications/inventory → tracking flag + current low-stock meds.
 *  Drives the page banner and the nav badge. */
export async function GET() {
  const enabled = getMedicationSettings().inventoryEnabled;
  return NextResponse.json({ enabled, lowStock: lowStockMeds() });
}

/** POST /api/medications/inventory → update one med's supply.
 *  Body: { id, addUnits?, setUnits?, track? }.
 *   - track:false stops tracking (clears inventory).
 *   - setUnits sets the absolute count (and starts tracking).
 *   - addUnits tops up the existing count (starting from 0 if untracked). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const med = getMedications().find((m) => m.id === id);
  if (!med) return NextResponse.json({ error: "not found" }, { status: 404 });

  let units: number | null;
  if (body.track === false) {
    units = null;
  } else if (body.setUnits != null && Number.isFinite(Number(body.setUnits))) {
    units = Math.max(0, Number(body.setUnits));
  } else if (body.addUnits != null && Number.isFinite(Number(body.addUnits))) {
    units = Math.max(0, (med.inventory?.units ?? 0) + Number(body.addUnits));
  } else {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const updated = setMedicationInventory(id, units);
  return NextResponse.json({ medication: updated, daysRemaining: updated ? daysRemaining(updated) : null });
}
