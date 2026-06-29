import { NextRequest, NextResponse } from "next/server";
import { getMedications, saveMedications } from "@/lib/medications";
import { generateMedicationInfo } from "@/lib/medications-info";

/** POST /api/medications/info?id=...&refresh=1 → generate (once) or refresh the
 *  stored research note for a medication. Returns it cached unless ?refresh=1. */
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const meds = getMedications();
  const idx = meds.findIndex((m) => m.id === id);
  if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Return the cached note unless a refresh is explicitly requested (it's
  // generated once and stored — re-running costs an AI call + a network fetch).
  if (meds[idx].info && !meds[idx].info!.error && !refresh) {
    return NextResponse.json({ info: meds[idx].info, cached: true });
  }

  const info = await generateMedicationInfo(meds[idx]);
  meds[idx] = { ...meds[idx], info, updatedAt: new Date().toISOString() };
  saveMedications(meds);
  return NextResponse.json({ info, cached: false });
}
