// Coach proactive-questions endpoint.
//   GET  → the open question (if any) + recent history, for the popup/Daily card.
//   POST → evaluate: run detection under the cadence rails and create AT MOST one
//          pending question. ?dry=1 returns the candidate without persisting.
//
// Anomaly detection is deterministic (lib/coach-questions.ts); the AI only phrases
// the opener and picks the discovery topic — both fenced by the rails here.

import { NextRequest, NextResponse } from "next/server";
import { getDay, getRecentDays } from "@/lib/context";
import { localDateStr } from "@/lib/store";
import { hasAiKey, complete } from "@/lib/ai-provider";
import {
  AnomalyCandidate,
  DISCOVERY_SEED_TOPICS,
  addQuestion,
  anomalyStillHolds,
  blockedTopics,
  createdToday,
  detectAnomalies,
  getOpenQuestion,
  isEvening,
  knownTopics,
  patchQuestion,
  recentQuestions,
} from "@/lib/coach-questions";
import { getActiveMemories } from "@/lib/memory";

export async function GET() {
  return NextResponse.json({ open: getOpenQuestion(), recent: recentQuestions(12) });
}

export async function POST(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  // ?force=1 bypasses only the evening-window gate for discovery (manual "ask me
  // something now" trigger); all other rails — one-open, once/day, cooldowns,
  // sensitive-topics, AI selection — still apply.
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await evaluate(dry, force);
  return NextResponse.json(result);
}

type EvalResult = {
  created: ReturnType<typeof addQuestion> | null;
  candidate?: { kind: "anomaly" | "discovery"; topic: string; prompt: string; observation?: string };
  open?: ReturnType<typeof getOpenQuestion>;
  reason: string;
};

async function evaluate(dry: boolean, force = false): Promise<EvalResult> {
  const now = new Date();

  // Today + recent history (fetched first so we can re-validate an open question
  // against the LATEST data before showing it).
  let today;
  try {
    today = (await getDay(localDateStr(now))).day;
  } catch {
    return { created: null, reason: "no live data for today" };
  }
  const { days } = await getRecentDays(14);
  const history = days.filter((d) => d.date < today.date);

  // Reconcile: an open anomaly question built from partial/early data (e.g. a
  // 2.7h "short night" that's really ~6h once the full night syncs) is expired
  // and the slot freed, so it self-corrects like the silent watchers.
  const open = getOpenQuestion();
  if (open) {
    if (anomalyStillHolds(open, today, history)) {
      return { created: null, open, reason: "a question is already open" };
    }
    if (dry) return { created: null, reason: "open question is stale (would expire)" };
    patchQuestion(open.id, { status: "expired" });
  }
  // Manual "ask me something" (force) bypasses the once-a-day cap so the user can
  // answer several back-to-back to build context fast; passive triggers don't.
  if (!force && createdToday(now)) return { created: null, reason: "already asked today (one per day)" };

  const blocked = blockedTopics(now);

  // 1) Anomalies — any time of day, prioritized.
  const anomalies = detectAnomalies(today, history).filter((a) => !blocked.has(a.topic));
  if (anomalies.length) {
    const a = anomalies[0];
    const prompt = await phraseAnomaly(a);
    if (dry) return { created: null, candidate: { kind: "anomaly", topic: a.topic, prompt, observation: a.observation }, reason: "anomaly (dry-run)" };
    const q = addQuestion({ kind: "anomaly", ruleId: a.ruleId, topic: a.topic, metric: a.metric, observation: a.observation, prompt });
    return { created: q, reason: `anomaly: ${a.ruleId}` };
  }

  // 2) Discovery — evening only (unless force-triggered), on a calm day.
  if (!force && !isEvening(now)) return { created: null, reason: "no anomaly; outside the evening discovery window" };
  const disc = await pickDiscovery(blocked, knownTopics());
  if (!disc) return { created: null, reason: "no discovery topic available" };
  if (dry) return { created: null, candidate: { kind: "discovery", topic: disc.topic, prompt: disc.prompt }, reason: "discovery (dry-run)" };
  const q = addQuestion({ kind: "discovery", topic: disc.topic, prompt: disc.prompt });
  return { created: q, reason: `discovery: ${disc.topic}` };
}

// ── AI phrasing (anomaly) ─────────────────────────────────────────────────────

function templateAnomaly(a: AnomalyCandidate): string {
  if (a.topic === "sleep") return `Looks like a short night — you ${a.observation}. Anything that kept you up?`;
  if (a.topic === "hr-spike") return `I noticed your ${a.observation}. Any idea what that was — stress, a coffee, something else?`;
  return `I noticed something: you ${a.observation}. Any idea what was behind it?`;
}

async function phraseAnomaly(a: AnomalyCandidate): Promise<string> {
  if (!hasAiKey()) return templateAnomaly(a);
  const system =
    "You are a warm, perceptive health coach. Turn a deterministic observation into ONE short, INDIRECT, non-accusatory question that invites the person to share what might explain it. Tone: curious and supportive ('any idea why?' not 'why did you'). No medical claims, no diagnosis, no advice — just the question. Plain text, one sentence, no emoji, no quotes.";
  const user = `Observation (already computed from their data, factual): ${a.observation}.\nWrite the one-sentence question.`;
  try {
    const t = (await complete([{ role: "system", content: system }, { role: "user", content: user }])).trim().replace(/^["']|["']$/g, "");
    return t && t.length <= 240 ? t : templateAnomaly(a);
  } catch {
    return templateAnomaly(a);
  }
}

// ── AI discovery selection (within deterministic rails) ───────────────────────

async function pickDiscovery(blocked: Set<string>, known: Set<string>): Promise<{ topic: string; prompt: string } | null> {
  // Rail: only ever choose from the vetted seed topics, minus anything blocked
  // (cooldown / declined) or already known. This keeps the sensitive-topics
  // policy enforced deterministically — the seeds exclude politics/religion and
  // never probe mental-health/finances/relationships.
  const allowed = DISCOVERY_SEED_TOPICS.filter((s) => !blocked.has(s.topic) && !known.has(s.topic));
  if (!allowed.length) return null;
  if (!hasAiKey()) return null; // discovery needs the model to phrase well; skip quietly

  const knownFacts = getActiveMemories()
    .filter((m) => ["preference", "constraint", "condition", "lifestyle", "goal"].includes(m.category))
    .map((m) => `- ${m.text}`)
    .slice(0, 20)
    .join("\n");

  const topicList = allowed.map((s) => `- ${s.topic}: ${s.intent}`).join("\n");
  const system =
    "You are a warm health coach getting to know someone over time, the way a thoughtful clinician builds a picture of a patient's life. You ask ONE short, INDIRECT question to learn a lifestyle fact that will help you coach better. Never ask directly for personal data ('how many kids?'); ask gently and let them share. Never probe politics, religion, mental health, finances, or relationships — only learn those if the person volunteers them. No medical claims. Plain, friendly, one sentence.";
  const user = `What you ALREADY know about them (do not re-ask these):\n${knownFacts || "(nothing yet)"}\n\nTopics you may explore (pick the single most useful gap):\n${topicList}\n\nReply with ONLY JSON: {"ask": true|false, "topic": "<one topic id from the list>", "prompt": "<your one-sentence indirect question>"}. Set ask=false if none feels natural right now.`;

  try {
    const raw = await complete([{ role: "system", content: system }, { role: "user", content: user }], { json: true });
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!parsed?.ask) return null;
    const topic = String(parsed.topic ?? "");
    const prompt = String(parsed.prompt ?? "").trim();
    if (!allowed.some((s) => s.topic === topic) || !prompt || prompt.length > 240) return null;
    return { topic, prompt };
  } catch {
    return null;
  }
}
