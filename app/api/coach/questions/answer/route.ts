// Record the outcome of a proactive question.
//   action "answer"  → mark answered + create a linked coach memory (source proactive)
//   action "dismiss" → snooze with backoff (dismissCount++), no memory
//   action "decline" → permanent opt-out: write a boundary memory for the topic
//
// The web ActionRunner / server action runner POST here when the coach emits an
// answerQuestion / declineTopic block; the popup posts "dismiss" directly.

import { NextRequest, NextResponse } from "next/server";
import { getQuestions, patchQuestion } from "@/lib/coach-questions";
import { addMemory } from "@/lib/memory";
import { CoachMemoryCategory } from "@/lib/types";

const MEMORY_CATEGORIES: CoachMemoryCategory[] = [
  "preference", "constraint", "condition", "lifestyle", "goal", "advice", "pattern", "other",
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  const action = typeof body?.action === "string" ? body.action : "answer";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const q = getQuestions().find((x) => x.id === id);
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "dismiss") {
    const updated = patchQuestion(id, { status: "dismissed", dismissCount: (q.dismissCount ?? 0) + 1 });
    return NextResponse.json({ ok: true, question: updated });
  }

  if (action === "decline") {
    const topic = typeof body?.topic === "string" && body.topic ? body.topic : q.topic;
    addMemory({
      text: typeof body?.memoryText === "string" && body.memoryText
        ? body.memoryText
        : `Prefers not to discuss ${topic.replace(/-/g, " ")}.`,
      category: "boundary",
      source: "user",
      topic,
    });
    const updated = patchQuestion(id, { status: "dismissed", dismissCount: (q.dismissCount ?? 0) + 1 });
    return NextResponse.json({ ok: true, question: updated, declined: topic });
  }

  // action "answer"
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  const memoryText = typeof body?.memoryText === "string" && body.memoryText.trim() ? body.memoryText.trim() : answer;
  if (!memoryText) return NextResponse.json({ error: "answer or memoryText required" }, { status: 400 });

  const category: CoachMemoryCategory = MEMORY_CATEGORIES.includes(body?.category) ? body.category : "lifestyle";
  const mem = addMemory({ text: memoryText, category, source: "proactive", topic: q.topic });
  const memoryId = "memory" in mem ? mem.memory.id : undefined;

  const updated = patchQuestion(id, {
    status: "answered",
    answer: answer || memoryText,
    answeredAt: new Date().toISOString(),
    memoryId,
  });
  return NextResponse.json({ ok: true, question: updated, memoryId });
}
