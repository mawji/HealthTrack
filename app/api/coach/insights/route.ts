import { NextRequest, NextResponse } from "next/server";
import { buildCoachContext, COACH_PERSONA } from "@/lib/context";
import { complete, hasAiKey, parseJsonReply } from "@/lib/openrouter";
import { readJson, writeJson, localDateStr } from "@/lib/store";
import { CoachInsight } from "@/lib/types";

const WINDOW: Record<string, number> = { day: 2, week: 8, month: 31, quarter: 91, year: 366 };

// Long ranges are retrospective: big-picture trajectory, no daily action list.
const LONG_RANGE = new Set(["quarter", "year"]);

export async function GET(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get("period") ?? "day") as CoachInsight["period"];
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  if (!hasAiKey()) {
    return NextResponse.json(
      { error: "Connect an AI provider in Settings to generate insights." },
      { status: 400 }
    );
  }

  // Cache one insight per period per day (v3: scaled vizCards grid).
  const cacheKey = `insight-v3-${period}`;
  const cached = readJson<CoachInsight | null>(`${cacheKey}.json`, null);
  const today = localDateStr();
  if (cached && cached.generatedAt.slice(0, 10) === today && !force) {
    return NextResponse.json(cached);
  }

  const isLong = LONG_RANGE.has(period);
  const periodLabel =
    period === "day" ? "24-48 hours" : period === "quarter" ? "3 months" : period;
  // More horizon → more worth reflecting on, but never pad past what's meaningful.
  const cardCount: Record<string, string> = {
    day: "1-2",
    week: "2-3",
    month: "3",
    quarter: "3-4",
    year: "4-5",
  };

  // Shared card schema — every period renders a grid of distinct focus-metric cards.
  const cardSpec = `"vizCards": [
    // ${cardCount[period] ?? "2-3"} cards — EACH a DIFFERENT focus metric, never repeat one.
    // Only surface a card if it is genuinely worth reflecting on; do NOT pad to a number.
    // Pick the most movement-worthy across: activity (steps/active minutes),
    // recovery (HRV and/or RHR), sleep (duration/efficiency), body (weight),
    // metabolic/nutrition (glucose, calories, protein). Each card MUST be:
    {
      "type": "metric",
      "title": "short metric name",
      "value": "headline value with unit, e.g. \\"6,294/day\\"",
      "color": "one of: activity | heart | sleep | food | breath",
      "progress": 0.0,            // optional 0-1 vs goal; omit if no clear goal
      "chartType": "line",        // \\"line\\" for trends, \\"bar\\" for counts
      "chartData": [/* the trend over the period, oldest→newest */],
      "chartLabels": [/* matching short labels */]
    }
  ]`;
  const cardRule =
    "Every card MUST include a non-empty chartData + chartLabels of equal length so each renders a visual.";

  const { text: context } = await buildCoachContext(WINDOW[period] ?? 8);

  const prompt = isLong
    ? `${COACH_PERSONA}

Write a retrospective, strategic summary of the user's health data over the last ${periodLabel}. This is a long-range review, NOT a daily action plan — focus on the overall trajectory and what materially changed across the period, not on what to do today.
Be concise.
Reply with ONLY JSON (no viz code fences anywhere — the "vizCards" field below replaces them):
{
  "headline": "one short punchy sentence — the overall trajectory over this period",
  "body": "2-3 brief sentences on the big-picture trends, grounded in specific numbers and how they changed across the period",
  ${cardSpec},
  "focusAreas": []
}
${cardRule} Return an empty focusAreas array — this is a retrospective summary with no action list.

${context}`
    : `${COACH_PERSONA}

Analyze the user's data over the last ${periodLabel} and produce a coaching insight. This is a multi-day horizon, so reflect on a few distinct focus areas, not just one.
Be concise.
Reply with ONLY JSON (no viz code fences anywhere — the "vizCards" field below replaces them):
{
  "headline": "one short punchy sentence — the single most important takeaway",
  "body": "1-2 brief sentences of plain-text analysis grounded in specific numbers",
  ${cardSpec},
  "focusAreas": [
    { "title": "2-4 words", "detail": "one concrete actionable sentence", "metric": "the number/stat it is based on" }
  ]
}
${cardRule} Give exactly 2 focusAreas.

${context}`;

  try {
    const reply = await complete([{ role: "user", content: prompt }], { json: true });
    const parsed = parseJsonReply<Omit<CoachInsight, "period" | "generatedAt">>(reply);
    const insight: CoachInsight = {
      period,
      generatedAt: new Date().toISOString(),
      ...parsed,
      // Every period renders a grid of focus-metric cards; the single viz is retired.
      viz: null,
      vizCards: parsed.vizCards ?? [],
      // Long ranges are action-free regardless of what the model returns.
      focusAreas: isLong ? [] : parsed.focusAreas ?? [],
    };
    writeJson(`${cacheKey}.json`, insight);
    return NextResponse.json(insight);
  } catch (e: any) {
    console.error("Insight generation failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 502 });
  }
}
