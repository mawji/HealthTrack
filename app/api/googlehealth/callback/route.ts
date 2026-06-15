import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/googlehealth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const base = process.env.APP_BASE_URL || "http://localhost:3210";
  if (!code || !state) {
    return NextResponse.redirect(`${base}/?health=error`);
  }
  try {
    await exchangeCode(code, state);
    return NextResponse.redirect(`${base}/?health=connected`);
  } catch (e) {
    console.error("Google Health OAuth failed:", e);
    return NextResponse.redirect(`${base}/?health=error`);
  }
}
