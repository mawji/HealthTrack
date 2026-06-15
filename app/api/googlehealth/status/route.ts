import { NextResponse } from "next/server";
import { hasCredentials, isConnected, disconnect } from "@/lib/googlehealth";
import { hasAiKey } from "@/lib/openrouter";

export async function GET() {
  return NextResponse.json({
    healthConfigured: hasCredentials(),
    healthConnected: isConnected(),
    aiConfigured: hasAiKey(),
  });
}

export async function DELETE() {
  disconnect();
  return NextResponse.json({ ok: true });
}
