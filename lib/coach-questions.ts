// Coach proactive-questions store + cadence + deterministic anomaly detection.
//
// Discipline (see plans/coach-proactive-questions.md):
//  - ANOMALY questions are deterministic-to-detect (this file) so a real event is
//    never missed; the AI only phrases them (in the evaluate route).
//  - DISCOVERY questions are AI-driven (in the route) but constrained by the
//    deterministic rails here: ≤1 question/day, one open at a time, evening-only
//    discovery on calm days, per-topic cooldown, dismissal backoff, and never
//    re-asking an answered or explicitly-declined topic.
// Local only (data/coach-questions.json).

import { readJson, writeJson, newId, localDateStr, APP_TZ } from "./store";
import { getActiveMemories } from "./memory";
import { CoachQuestion, DaySummary } from "./types";

const FILE = "coach-questions.json";

// Cadence knobs.
const PER_TOPIC_COOLDOWN_DAYS = 3; // don't re-probe the same topic for a few days
const DISMISS_BACKOFF_DAYS = 3; // each dismissal adds this many days before re-asking
const EVENING_START_MIN = 18 * 60; // discovery is evening-only (things have calmed)
const EVENING_END_MIN = 21 * 60 + 30;

// ── storage ─────────────────────────────────────────────────────────────────

export function getQuestions(): CoachQuestion[] {
  return readJson<CoachQuestion[]>(FILE, []);
}
function saveQuestions(qs: CoachQuestion[]) {
  writeJson(FILE, qs);
}

/** The single currently-open (pending) question, if any. */
export function getOpenQuestion(): CoachQuestion | null {
  return getQuestions().find((q) => q.status === "pending") ?? null;
}

/** Recent questions for the management/debug surface (newest first). */
export function recentQuestions(limit = 20): CoachQuestion[] {
  return getQuestions()
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export function addQuestion(q: Omit<CoachQuestion, "id" | "status" | "createdAt" | "date">): CoachQuestion {
  const qs = getQuestions();
  // Invariant: at most one open question at a time. Re-check at write time so
  // concurrent evaluations (e.g. the popup firing twice) can't create duplicates.
  const existing = qs.find((x) => x.status === "pending");
  if (existing) return existing;
  const now = new Date();
  const created: CoachQuestion = {
    ...q,
    id: newId(),
    status: "pending",
    date: localDateStr(now),
    createdAt: now.toISOString(),
  };
  qs.push(created);
  saveQuestions(qs);
  return created;
}

export function patchQuestion(id: string, patch: Partial<CoachQuestion>): CoachQuestion | null {
  const qs = getQuestions();
  const q = qs.find((x) => x.id === id);
  if (!q) return null;
  Object.assign(q, patch);
  saveQuestions(qs);
  return q;
}

// ── cadence rails ─────────────────────────────────────────────────────────────

function tzMinutes(now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

export function isEvening(now = new Date()): boolean {
  const m = tzMinutes(now);
  return m >= EVENING_START_MIN && m <= EVENING_END_MIN;
}

/** A question was already created today → today's single slot is used. Expired
 *  questions (invalidated by fresher data) don't count, so a stale one can be
 *  replaced. */
export function createdToday(now = new Date()): boolean {
  const today = localDateStr(now);
  return getQuestions().some((q) => q.date === today && q.status !== "expired");
}

function daysBetween(aIso: string, b: Date): number {
  return (b.getTime() - Date.parse(aIso)) / 86_400_000;
}

/** Topics that may NOT be asked right now: recently answered/dismissed (with
 *  dismissal backoff), or explicitly declined (a boundary memory). */
export function blockedTopics(now = new Date()): Set<string> {
  const blocked = new Set<string>();
  for (const q of getQuestions()) {
    if (q.status === "answered" && daysBetween(q.answeredAt ?? q.createdAt, now) < PER_TOPIC_COOLDOWN_DAYS) {
      blocked.add(q.topic);
    }
    if (q.status === "dismissed") {
      const backoff = PER_TOPIC_COOLDOWN_DAYS + (q.dismissCount ?? 1) * DISMISS_BACKOFF_DAYS;
      if (daysBetween(q.createdAt, now) < backoff) blocked.add(q.topic);
    }
  }
  // Explicit opt-outs are durable boundary memories carrying the topic.
  for (const m of getActiveMemories()) {
    if (m.category === "boundary" && m.topic) blocked.add(m.topic);
  }
  return blocked;
}

/** Topics already covered by a memory — discovery shouldn't re-ask these. */
export function knownTopics(): Set<string> {
  return new Set(getActiveMemories().map((m) => m.topic).filter((t): t is string => !!t));
}

// ── deterministic anomaly detection ───────────────────────────────────────────

export interface AnomalyCandidate {
  ruleId: string;
  topic: string;
  metric: string; // concrete figure
  observation: string; // deterministic fact the question is about
  priority: number; // higher = more notable
}

function mean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
function sd(vals: number[], mu: number): number {
  if (vals.length < 2) return 0;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1));
}

/** Sleep markedly below the user's own rolling baseline (duration). */
function sleepAnomaly(today: DaySummary, history: DaySummary[]): AnomalyCandidate | null {
  if (!today.sleep) return null;
  const hist = history.map((d) => d.sleep?.durationMin).filter((v): v is number => v != null && v > 0);
  if (hist.length < 5) return null; // need a baseline
  const mu = mean(hist);
  const s = sd(hist, mu);
  const todayMin = today.sleep.durationMin;
  const deficit = mu - todayMin;
  const z = s > 0 ? (todayMin - mu) / s : 0;
  // Notable: clearly below baseline (≥ ~1 SD) AND a real ≥45-min shortfall.
  if (deficit < 45 || (s > 0 && z > -1)) return null;
  return {
    ruleId: "sleep.below_baseline",
    topic: "sleep",
    metric: `${(todayMin / 60).toFixed(1)}h vs ~${(mu / 60).toFixed(1)}h usual`,
    observation: `slept ${(todayMin / 60).toFixed(1)}h last night vs a usual ~${(mu / 60).toFixed(1)}h (about ${Math.round(deficit)} min short)`,
    priority: 2,
  };
}

/** A heart-rate spike with little/no recorded activity for the day. Coarse but
 *  conservative: a high intraday peak vs resting while whole-day active-zone
 *  minutes stayed low (the v4 API gives no per-interval activity). */
function hrSpikeAnomaly(today: DaySummary): AnomalyCandidate | null {
  const rhr = today.restingHeartRate;
  if (!rhr || !today.heartIntraday?.length) return null;
  if (today.activeZoneMinutes >= 15) return null; // there WAS activity → not unexplained
  let peak = 0;
  let peakTime = "";
  for (const p of today.heartIntraday) {
    const hi = p.max ?? p.bpm ?? 0;
    if (hi > peak) { peak = hi; peakTime = p.time; }
  }
  if (peak < 110 || peak < rhr + 45) return null;
  return {
    ruleId: "hr.spike_no_activity",
    topic: "hr-spike",
    metric: `~${peak}bpm peak (resting ${rhr})`,
    observation: `heart rate rose to about ${peak} bpm${peakTime ? ` around ${peakTime}` : ""} with little recorded activity (resting is ~${rhr} bpm)`,
    priority: 3,
  };
}

/** All anomalies detected for today, most notable first. */
export function detectAnomalies(today: DaySummary, history: DaySummary[]): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  const hr = hrSpikeAnomaly(today);
  if (hr) out.push(hr);
  const sleep = sleepAnomaly(today, history);
  if (sleep) out.push(sleep);
  return out.sort((a, b) => b.priority - a.priority);
}

/** Does an open anomaly question still hold against the latest data? Discovery
 *  questions aren't data-bound, so they always hold. Used to expire a question
 *  built from partial/early data (e.g. a 2.7h "short night" that's really ~6h
 *  once the full night syncs). */
export function anomalyStillHolds(q: CoachQuestion, today: DaySummary, history: DaySummary[]): boolean {
  if (q.kind !== "anomaly") return true;
  return detectAnomalies(today, history).some((a) => a.ruleId === q.ruleId);
}

/** Seed topics that discovery may explore, with a one-line intent. Not
 *  exhaustive — the AI may pick a better-fitting angle; these are priors. The
 *  sensitive-topics policy (politics/religion excluded; mental-health/finances/
 *  relationships volunteered-only) is enforced in the evaluate route. */
export const DISCOVERY_SEED_TOPICS: { topic: string; intent: string }[] = [
  { topic: "sleep-environment", intent: "what their sleep setup / nighttime environment is like" },
  { topic: "work-pattern", intent: "their work rhythm — hours, shifts, desk vs active, travel" },
  { topic: "caffeine", intent: "coffee/tea habits and timing" },
  { topic: "alcohol", intent: "whether and when they drink" },
  { topic: "movement-style", intent: "what kinds of activity they actually enjoy" },
  { topic: "meals-rhythm", intent: "their typical eating rhythm and who they cook/eat with" },
  { topic: "stress-load", intent: "general day-to-day busyness/stress (lightly, non-clinical)" },
  { topic: "home-life", intent: "household/living situation that shapes routine (kids, pets, commute)" },
];
