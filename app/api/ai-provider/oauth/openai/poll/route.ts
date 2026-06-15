import { NextRequest, NextResponse } from "next/server";
import { pollOpenAiDeviceCode } from "@/lib/ai-provider";

// POST { deviceCode } → poll OpenAI for authorization.
// Returns { status: "authorized" | "pending" | "slow_down" | "error", error? }
export async function POST(req: NextRequest) {
  const { deviceCode, userCode } = await req.json().catch(() => ({}));
  if (!deviceCode || !userCode) {
    return NextResponse.json({ error: "deviceCode and userCode required" }, { status: 400 });
  }
  try {
    const result = await pollOpenAiDeviceCode(deviceCode, userCode);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e.message ?? "Poll failed" }, { status: 502 });
  }
}
