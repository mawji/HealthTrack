// Scheduled per-contact report delivery. The local scheduler POSTs here (with
// the bridge secret) on each tick; due reports are built scope-filtered and sent.

import { NextRequest, NextResponse } from "next/server";
import { getBridgeSecret } from "@/lib/telegram/config";
import { runDueContactReports } from "@/lib/telegram/contact-reports";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== getBridgeSecret()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await runDueContactReports();
  return NextResponse.json(result);
}
