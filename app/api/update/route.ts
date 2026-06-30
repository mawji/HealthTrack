import { NextResponse } from "next/server";
import { CURRENT_VERSION, fetchLatest, isNewer, watchtowerConfigured, triggerUpdate } from "@/lib/update";

export const dynamic = "force-dynamic";

// GET — current vs latest version, and whether one-click apply is available.
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const latest = await fetchLatest(force);
  const updateAvailable = Boolean(latest?.tag && isNewer(latest.tag, CURRENT_VERSION));
  return NextResponse.json({
    current: CURRENT_VERSION,
    latest: latest?.tag ?? null,
    name: latest?.name ?? null,
    url: latest?.url ?? null,
    updateAvailable,
    canApply: watchtowerConfigured(),
  });
}

// POST — kick off the Watchtower update. Fire-and-forget: Watchtower recreates
// this container mid-request, so we respond immediately and let the client
// reconnect to the new version.
export async function POST() {
  if (!watchtowerConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "no-watchtower", command: "docker compose pull && docker compose up -d" },
      { status: 400 },
    );
  }
  triggerUpdate(); // intentionally not awaited
  return NextResponse.json({ ok: true, triggered: true });
}
