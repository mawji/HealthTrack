import { NextResponse } from "next/server";
import { startOpenAiDeviceCode } from "@/lib/ai-provider";

// POST → initiate ChatGPT device code flow.
// Returns the user_code to display and the device_code to poll with.
export async function POST() {
  try {
    const result = await startOpenAiDeviceCode();
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("Device code start failed:", e);
    return NextResponse.json({ error: e.message ?? "Failed to start device code flow" }, { status: 502 });
  }
}
