// Proactive guidance preferences for the Settings UI. The wire format exposes
// times as HH:MM strings (easy for <input type=time>) alongside the stored
// minute values; POST accepts either.

import { NextRequest, NextResponse } from "next/server";
import { getPreferences, setPreferences, hmToMin, minToHm } from "@/lib/proactive/preferences";
import { getLog } from "@/lib/proactive/log";
import { ProactivePreferences } from "@/lib/proactive/types";

function shape(p: ProactivePreferences) {
  return {
    ...p,
    quietStart: minToHm(p.quietStartMin),
    quietEnd: minToHm(p.quietEndMin),
    usualBedtime: minToHm(p.usualBedtimeMin),
    recentDeliveries: getLog().slice(-5).reverse(),
  };
}

export async function GET() {
  return NextResponse.json(shape(getPreferences()));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const patch: Partial<ProactivePreferences> = {};

  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.maxPerDay === "number") patch.maxPerDay = Math.max(1, Math.min(6, body.maxPerDay));
  if (typeof body.minGapHours === "number") patch.minGapHours = Math.max(1, Math.min(12, body.minGapHours));
  if (typeof body.quietStart === "string") patch.quietStartMin = hmToMin(body.quietStart, getPreferences().quietStartMin);
  if (typeof body.quietEnd === "string") patch.quietEndMin = hmToMin(body.quietEnd, getPreferences().quietEndMin);
  if (typeof body.usualBedtime === "string") patch.usualBedtimeMin = hmToMin(body.usualBedtime, getPreferences().usualBedtimeMin);
  if (body.categories && typeof body.categories === "object") patch.categories = body.categories;

  const next = setPreferences(patch);
  return NextResponse.json(shape(next));
}
