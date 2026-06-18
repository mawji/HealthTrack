import { NextRequest, NextResponse } from "next/server";
import { isConnected, fetchPairedDevices } from "@/lib/googlehealth";
import { setDeviceOverride } from "@/lib/devices";

// Paired devices with local label overrides applied — feeds the global
// battery indicator and the Settings account card.
export async function GET() {
  if (!isConnected()) return NextResponse.json({ devices: [] });
  try {
    return NextResponse.json({ devices: await fetchPairedDevices() });
  } catch (e) {
    console.error("Device fetch failed:", e);
    return NextResponse.json({ devices: [] });
  }
}

// Relabel a device locally (Google often returns only a numeric id).
export async function PATCH(req: NextRequest) {
  const { deviceId, label } = await req.json().catch(() => ({}));
  if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  setDeviceOverride(String(deviceId), String(label ?? ""));
  const devices = isConnected() ? await fetchPairedDevices().catch(() => []) : [];
  return NextResponse.json({ ok: true, devices });
}
