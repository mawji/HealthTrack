import { NextRequest, NextResponse } from "next/server";
import { buildCoachContext, COACH_PERSONA } from "@/lib/context";
import { complete, hasAiKey, parseJsonReply } from "@/lib/openrouter";
import { readJson, writeJson, localDateStr } from "@/lib/store";
import { CoachInsight } from "@/lib/types";

const WINDOW: Record<string, number> = { day: 2, week: 8, month: 31 };

export async function GET(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get("period") ?? "day") as CoachInsight["period"];
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  if (!hasAiKey()) {
    return NextResponse.json(
      { error: "Connect an AI provider in Settings to generate insights." },
      { status: 400 }
    );
  }

  // Cache one insight per period per day (v2: viz card spec field).
  const cacheKey = `insight-v2-${period}`;
  const cached = readJson<CoachInsight | null>(`${cacheKey}.json`, null);
  const today = localDateStr();
  if (cached && cached.generatedAt.slice(0, 10) === today && !force) {
    return NextResponse.json(cached);
  }

  const { text: context } = await buildCoachContext(WINDOW[period] ?? 8);
  const prompt = `${COACH_PERSONA}

Analyze the user's data over the last ${period === "day" ? "24-48 hours" : period} and produce a coaching insight.
Be extremely concise.
Reply with ONLY JSON (no viz code fences anywhere — the "viz" field below replaces them):
{
  "headline": "one short punchy sentence — the single most important takeaway",
  "body": "1-2 brief sentences of plain-text analysis grounded in specific numbers",
  "viz": { one card spec object visualizing the key takeaway, same schema as the chat viz JSON, e.g. {"type":"metric","title":"Sleep Quality","value":"7h 11m","color":"sleep","progress":0.87,"chartType":"bar","chartData":[…last days…],"chartLabels":[…]} },
  "focusAreas": [
    { "title": "2-4 words", "detail": "one concrete actionable sentence", "metric": "the number/stat it is based on" }
  ]
}
Give exactly 2 focusAreas.

${context}`;

  try {
    const reply = await complete([{ role: "user", content: prompt }], { json: true });
    const parsed = parseJsonReply<Omit<CoachInsight, "period" | "generatedAt">>(reply);
    const insight: CoachInsight = {
      period,
      generatedAt: new Date().toISOString(),
      ...parsed,
    };
    writeJson(`${cacheKey}.json`, insight);
    return NextResponse.json(insight);
  } catch (e: any) {
    console.error("Insight generation failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 502 });
  }
}
