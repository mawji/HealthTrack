import { NextResponse } from "next/server";
import { getProfile, deriveProfile } from "@/lib/profile";
import { latestDeviceWeightKg } from "@/lib/context";
import { computeTargets } from "@/lib/coach/nutrition-targets";

/** GET /api/nutrition/targets → deterministic calorie/macro/hydration targets
 *  from the profile (device weight preferred), or { ok:false, missing } when the
 *  profile lacks a required field. */
export async function GET() {
  const profile = getProfile();
  const derived = deriveProfile(profile, await latestDeviceWeightKg());
  const targets = computeTargets(profile, derived.weightKgResolved, derived.age);
  return NextResponse.json(targets);
}
