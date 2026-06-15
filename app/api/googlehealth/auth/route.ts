import { NextResponse } from "next/server";
import { buildAuthUrl, hasCredentials } from "@/lib/googlehealth";

export async function GET() {
  if (!hasCredentials()) {
    return NextResponse.json(
      { error: "Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET in .env.local first." },
      { status: 400 }
    );
  }
  return NextResponse.redirect(buildAuthUrl());
}
