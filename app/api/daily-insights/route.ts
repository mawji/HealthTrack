import { NextRequest, NextResponse } from "next/server";
import { getRecentDays } from "@/lib/context";
import { isConnected, fetchWaterTotal, fetchWorkouts } from "@/lib/googlehealth";
import { gateDaily, gateHabits, buildInsightPrompt, HabitGateInput } from "@/lib/daily-insights";
import {
  getHabitDefinitions,
  getHabitRecords,
  computeHabitStatus,
  habitTargetLabel,
} from "@/lib/habits";
import { complete, hasAiKey, parseJsonReply } from "@/lib/openrouter";
import { readJson, writeJson, localDateStr, APP_TZ } from "@/lib/store";
import {
  DailyInsightsResponse,
  DailyInsightSection,
  InsightSection,
  WorkoutSession,
} from "@/lib/types";

const SECTIONS: InsightSection[] = ["movement", "readiness", "hydration", "sleep", "nutrition", "habits"];

// Trailing window large enough to give readiness a stable rolling baseline.
const WINDOW = 45;

function tzHour(now = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hour: "2-digit", hour12: false }).format(now)
    ) % 24;
  } catch {
    return now.getHours();
  }
}

/** Stable key over the inputs that should trigger regeneration when they move. */
function inputHash(parts: (string | number | null)[]): string {
  let h = 0;
  const s = JSON.stringify(parts);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function GET(req: NextRequest) {
  const today = localDateStr();
  const date = req.nextUrl.searchParams.get("date") ?? today;
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const isCurrentDay = date === today;

  const { days } = await getRecentDays(WINDOW);
  const idx = days.findIndex((d) => d.date === date);

  // Day not in the window (older than ~45d or no data) → nothing to show.
  if (idx === -1) {
    const empty: DailyInsightsResponse = {
      date,
      generatedAt: new Date().toISOString(),
      today: isCurrentDay,
      readiness: null,
      sections: [],
    };
    return NextResponse.json(empty);
  }

  const day = days[idx];
  const history = days.slice(0, idx);

  // Today-only signals for the pace-based gates.
  let waterMl: number | null = null;
  let todaysWorkouts = 0;
  if (isCurrentDay) {
    if (isConnected()) {
      try {
        waterMl = await fetchWaterTotal(date);
      } catch {
        // optional
      }
    }
    try {
      const journal = readJson<WorkoutSession[]>("workout-journal.json", []);
      const names = new Set(journal.map((w) => w.googleName).filter(Boolean));
      const remote = isConnected() ? await fetchWorkouts(date, date) : [];
      todaysWorkouts = [...journal.filter((w) => w.date === date), ...remote.filter((w) => !names.has(w.googleName))].length;
    } catch {
      // optional
    }
  }

  const { readiness, gates } = gateDaily(day, history, waterMl, todaysWorkouts);

  // Habits (current day only): gate on exceeded avoid-limits / at-risk streaks.
  let habitSignal = "";
  if (isCurrentDay) {
    try {
      const defs = getHabitDefinitions().filter((h) => h.active && h.showOnDaily);
      const records = getHabitRecords();
      const inputs: HabitGateInput[] = defs.map((h) => {
        const s = computeHabitStatus(h, records, date, today);
        return {
          name: h.name,
          kind: h.kind,
          completed: s.completed,
          value: s.value,
          streak: s.streak,
          targetLabel: habitTargetLabel(h),
        };
      });
      habitSignal = inputs.map((i) => `${i.name}:${i.completed ? 1 : 0}:${i.value}`).join("|");
      const hg = gateHabits(inputs);
      if (hg) gates.push(hg);
    } catch {
      // habits are optional context
    }
  }

  // Previous days: show the historical readiness dial, never generate snippets.
  if (!isCurrentDay) {
    const resp: DailyInsightsResponse = {
      date,
      generatedAt: new Date().toISOString(),
      today: false,
      readiness,
      sections: [],
    };
    return NextResponse.json(resp);
  }

  // No gated sections, or no AI configured → dial only, no snippets, no model call.
  if (gates.length === 0 || !hasAiKey()) {
    const resp: DailyInsightsResponse = {
      date,
      generatedAt: new Date().toISOString(),
      today: true,
      readiness,
      sections: [],
    };
    return NextResponse.json(resp);
  }

  // Cache keyed by date + the live inputs (incl. the hour, so pace-based advice
  // refreshes through the day rather than freezing at first generation).
  const hash = inputHash([
    date,
    tzHour(),
    day.steps,
    day.activeZoneMinutes,
    day.caloriesIn,
    day.caloriesOut,
    day.hrv,
    day.restingHeartRate,
    day.sleep?.durationMin ?? null,
    day.sleep?.efficiency ?? null,
    waterMl,
    todaysWorkouts,
    habitSignal,
    gates.map((g) => g.section).join(","),
  ]);
  const cacheFile = `daily-insights-${date}-${hash}.json`;
  if (!force) {
    const cached = readJson<DailyInsightsResponse | null>(cacheFile, null);
    if (cached) return NextResponse.json(cached);
  }

  let sections: DailyInsightSection[] = [];
  try {
    const reply = await complete([{ role: "user", content: buildInsightPrompt(gates) }], { json: true });
    const parsed = parseJsonReply<{ sections?: { section?: string; text?: string }[] }>(reply);
    const bySection = new Map(gates.map((g) => [g.section, g.metric]));
    const seen = new Set<string>();
    sections = (parsed.sections ?? [])
      .map((s) => ({ section: s.section as InsightSection, text: (s.text ?? "").trim() }))
      .filter((s) => SECTIONS.includes(s.section) && bySection.has(s.section) && s.text.length > 0)
      .filter((s) => (seen.has(s.section) ? false : (seen.add(s.section), true)))
      .map((s) => ({ section: s.section, text: s.text, metric: bySection.get(s.section)! }));
  } catch (e) {
    console.error("Daily insights generation failed:", e);
    // Degrade to dial-only rather than erroring the dashboard.
  }

  const resp: DailyInsightsResponse = {
    date,
    generatedAt: new Date().toISOString(),
    today: true,
    readiness,
    sections,
  };
  writeJson(cacheFile, resp);
  return NextResponse.json(resp);
}
