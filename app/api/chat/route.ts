import { NextRequest, NextResponse } from "next/server";
import { buildCoachContext, COACH_PERSONA } from "@/lib/context";
import { hasAiKey, streamCompletion } from "@/lib/openrouter";
import { ChatMessage } from "@/lib/types";
import { localDateStr } from "@/lib/store";

export async function POST(req: NextRequest) {
  if (!hasAiKey()) {
    return NextResponse.json(
      { error: "Connect an AI provider in Settings to chat with the coach." },
      { status: 400 }
    );
  }
  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  const { text: context } = await buildCoachContext(14);

  const system = `${COACH_PERSONA}\n\nCurrent date: ${localDateStr()}\n\n${context}`;

  try {
    const stream = await streamCompletion([
      { role: "system", content: system },
      ...messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
    ]);
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no" },
    });
  } catch (e: any) {
    console.error("Chat failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 502 });
  }
}
