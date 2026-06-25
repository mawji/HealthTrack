import { NextRequest, NextResponse } from "next/server";
import { getProfile, saveProfile, deriveProfile } from "@/lib/profile";
import { latestDeviceWeightKg } from "@/lib/context";
import { ProfilePayload } from "@/lib/types";

/** GET /api/profile → stored profile + deterministic derived figures (age, BMI,
 *  healthy-weight range, missing-for-targets). BMI uses the latest synced device
 *  weight when available, else the manual figure. */
export async function GET() {
  const profile = getProfile();
  const derived = deriveProfile(profile, await latestDeviceWeightKg());
  const payload: ProfilePayload = { profile, derived };
  return NextResponse.json(payload);
}

/** PATCH /api/profile → merge a partial profile (clamped) and return the
 *  recomputed payload. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const profile = saveProfile(body ?? {});
  const derived = deriveProfile(profile, await latestDeviceWeightKg());
  const payload: ProfilePayload = { profile, derived };
  return NextResponse.json(payload);
}
