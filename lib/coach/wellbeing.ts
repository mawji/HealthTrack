// The Wellbeing Journal — the coach's own evolving, human-readable view of how
// the person is doing, plus a deterministic audit scorecard. The deterministic
// digest → narrative + audit baseline is always written for free (Phase 1). When
// background-intelligence model tiers are configured (Phase 3), Tier-1→Tier-2
// passes enrich the entry with the coach's read + open questions and write/refine
// durable memories under hard guards.
//
// Stored as structured JSON (data/coach-wellbeing.json) — each entry carries a
// pre-rendered Markdown narrative for display and a structured audit so the
// surface can show either. See plans/coach-background-intelligence.md.

import { readJson, writeJson, newId } from "@/lib/store";
import { rotateNotes, readNotes } from "@/lib/coach/scratchpad";
import { buildDigestData, computeDigest, WellbeingDigest, DigestArea, DigestSignal } from "@/lib/coach/digest";
import { getIntelligenceSettings } from "@/lib/coach/intelligence-settings";
import { runModelPasses, ModelOutcome } from "@/lib/coach/reflection-model";
import { decayStaleReflectionMemories } from "@/lib/memory";
import { appendReflectionLog } from "@/lib/coach/reflection-log";

const FILE = "coach-wellbeing.json";
const MAX_ENTRIES = 90;

export type AuditBand = "good" | "ok" | "attention";

export interface AuditDomain {
  domain: "movement" | "sleep" | "consistency" | "nutrition" | "cardiometabolic";
  score: number; // 0-100
  band: AuditBand;
  note: string;
}

export interface WellbeingAudit {
  at: string;
  scores: AuditDomain[];
  topActions: string[]; // the 2-3 highest-leverage next actions
}

export interface WellbeingEntry {
  id: string;
  at: string; // ISO
  date: string; // the digest's latest day
  trigger: "scheduled" | "manual";
  narrative: string; // Markdown
  audit: WellbeingAudit;
  signalCount: number;
  notesRolled: number; // scratchpad notes rotated out into this reflection
  modelRan?: boolean; // Tier-1/Tier-2 model passes ran this reflection
  memoriesApplied?: { adds: number; updates: number; retires: number };
}

interface Store {
  entries: WellbeingEntry[];
}

function load(): Store {
  return readJson<Store>(FILE, { entries: [] });
}
function save(s: Store) {
  writeJson(FILE, s);
}

// ── scoring helpers ───────────────────────────────────────────────────────────
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
function band(score: number): AuditBand {
  return score >= 75 ? "good" : score >= 50 ? "ok" : "attention";
}

function computeAudit(digest: WellbeingDigest, now: Date): WellbeingAudit {
  const { w7 } = digest.windows;
  const scores: AuditDomain[] = [];

  // Movement — blend step-vs-goal and AZM-vs-150.
  {
    const stepRatio = w7.avgSteps != null && w7.stepsGoal ? w7.avgSteps / w7.stepsGoal : null;
    const azmRatio = w7.azmPerWeek != null ? w7.azmPerWeek / 150 : null;
    const parts = [stepRatio, azmRatio].filter((v): v is number => v != null);
    const score = parts.length ? clamp((parts.reduce((a, b) => a + Math.min(1.1, b), 0) / parts.length) * 100) : 60;
    scores.push({
      domain: "movement", score, band: band(score),
      note: w7.avgSteps != null ? `~${w7.avgSteps.toLocaleString()} steps/day, ${w7.azmPerWeek ?? 0} active-zone min/week` : "not enough movement data",
    });
  }
  // Sleep — average duration vs 7h, penalised for short nights.
  {
    if (w7.avgSleepMin != null) {
      const base = (w7.avgSleepMin / 420) * 100;
      const score = clamp(base - w7.shortNights * 6);
      scores.push({
        domain: "sleep", score, band: band(score),
        note: `${(w7.avgSleepMin / 60).toFixed(1)}h avg, ${w7.shortNights} short night(s)`,
      });
    } else {
      scores.push({ domain: "sleep", score: 60, band: "ok", note: "no sleep data this week" });
    }
  }
  // Consistency — active days out of 7.
  {
    const score = clamp((w7.activeDays / 5) * 100);
    scores.push({
      domain: "consistency", score, band: band(score),
      note: `${w7.activeDays} active day(s) in the last week`,
    });
  }
  // Nutrition — logging coverage (Phase 1 proxy; intake-vs-target lands later).
  {
    const cover = w7.days ? w7.foodLoggedDays / w7.days : 0;
    const score = clamp(cover * 100);
    scores.push({
      domain: "nutrition", score, band: band(score),
      note: `food logged ${w7.foodLoggedDays}/${w7.days} days`,
    });
  }
  // Cardiometabolic — 100 minus a penalty per persistent lab/BP flag.
  {
    const flags = digest.signals.filter((s) => s.area === "cardiometabolic");
    const score = clamp(100 - flags.length * 30);
    scores.push({
      domain: "cardiometabolic", score, band: band(score),
      note: flags.length ? `${flags.length} persistent pattern(s) to watch with a clinician` : "no persistent out-of-range patterns",
    });
  }

  return { at: now.toISOString(), scores, topActions: topActions(digest.signals) };
}

/** Turn the highest-severity signals into short, concrete next actions. */
function topActions(signals: DigestSignal[]): string[] {
  const actions: string[] = [];
  const seen = new Set<DigestArea>();
  for (const s of signals) {
    if (s.severity === "info") continue;
    if (seen.has(s.area)) continue;
    seen.add(s.area);
    actions.push(actionFor(s));
    if (actions.length >= 3) break;
  }
  return actions;
}

function actionFor(s: DigestSignal): string {
  switch (s.area) {
    case "movement":
      return "Add a couple of short walks or an active-zone session to lift the week back toward the movement goal.";
    case "sleep":
      return "Protect an earlier wind-down on a few nights to pull the sleep average back toward 7h.";
    case "workouts":
      return "Pencil in one or two workouts this week to rebuild consistency.";
    case "nutrition":
      return "Log meals on a few more days so nutrition guidance has something to work with.";
    case "habits":
      return "Pick the one slipping habit to restart first, rather than all at once.";
    case "cardiometabolic":
      return "Raise the persistent lab/BP pattern with a clinician at the next visit — it is a tracking item, not a diagnosis.";
    case "weight":
      return "Note the weight trend and decide with your plan whether it is intended.";
  }
}

// ── narrative rendering ───────────────────────────────────────────────────────
const AREA_LABEL: Record<DigestArea, string> = {
  movement: "Movement", sleep: "Sleep", workouts: "Workouts",
  nutrition: "Nutrition", habits: "Habits", cardiometabolic: "Cardiometabolic", weight: "Weight",
};

function renderNarrative(digest: WellbeingDigest, audit: WellbeingAudit, model?: ModelOutcome | null): string {
  const { w7 } = digest.windows;
  const lines: string[] = [];
  lines.push(`## Reflection — ${digest.date}`);
  lines.push("");

  // This week snapshot
  const snap: string[] = [];
  if (w7.avgSteps != null) snap.push(`steps ~${w7.avgSteps.toLocaleString()}/day${w7.stepsGoal ? ` (goal ${w7.stepsGoal.toLocaleString()})` : ""}`);
  if (w7.azmPerWeek != null) snap.push(`${w7.azmPerWeek} active-zone min/week`);
  if (w7.avgSleepMin != null) snap.push(`sleep ${(w7.avgSleepMin / 60).toFixed(1)}h avg`);
  snap.push(`${w7.activeDays} active day(s)`);
  lines.push(`**This week:** ${snap.join(" · ")}.`);
  lines.push("");

  // What the coach is noticing
  if (digest.signals.length) {
    lines.push("**Noticing:**");
    for (const s of digest.signals.slice(0, 6)) {
      lines.push(`- _${AREA_LABEL[s.area]}_ — ${s.detail}`);
    }
  } else {
    lines.push("**Noticing:** a steady week — nothing stood out against the recent baseline.");
  }
  lines.push("");

  // The coach's own read (model observations) + open questions it's chasing.
  if (model?.observations.length) {
    lines.push("**Coach's read:**");
    for (const o of model.observations) lines.push(`- ${o}`);
    lines.push("");
  }
  if (model?.openQuestions.length) {
    lines.push("**Open questions it's chasing:**");
    for (const q of model.openQuestions) lines.push(`- ${q}`);
    lines.push("");
  }

  // Audit scorecard
  lines.push("**Wellbeing audit:**");
  for (const d of audit.scores) {
    lines.push(`- ${cap(d.domain)}: ${d.score}/100 (${d.band}) — ${d.note}`);
  }
  lines.push("");

  if (audit.topActions.length) {
    lines.push("**Suggested focus:**");
    for (const a of audit.topActions) lines.push(`- ${a}`);
    lines.push("");
  }

  // Memory changes this run (auditable on /memory).
  if (model?.ran) {
    const a = model.applied;
    const total = a.adds + a.updates + a.retires;
    lines.push(
      total
        ? `**Memory:** ${a.adds} added, ${a.updates} updated, ${a.retires} retired (see Memory).`
        : "**Memory:** nothing new worth remembering this run."
    );
    lines.push("");
  }

  return lines.join("\n").trim();
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── the deterministic reflection run ──────────────────────────────────────────
export interface ReflectionResult {
  ran: boolean;
  reason?: string; // why it didn't run (e.g. demo / not connected)
  entry?: WellbeingEntry;
}

/**
 * Reflection run: build the digest, compute the audit, optionally run the model
 * tiers (when configured) to enrich the narrative + write/refine memories, then
 * write the journal entry, run hygiene, and log the run. The deterministic part
 * is always free; the model part only spends when tiers are configured. Skips on
 * demo data (not connected) so the journal never records placeholder conclusions.
 */
export async function runReflection(trigger: "scheduled" | "manual" = "manual", now = new Date()): Promise<ReflectionResult> {
  const digest = computeDigest(await buildDigestData(), now);
  if (digest.demo) return { ran: false, reason: "not connected (demo data) — nothing reflected" };

  const audit = computeAudit(digest, now);
  const settings = getIntelligenceSettings();

  // Model passes read the scratchpad BEFORE it's rotated. No tier configured →
  // graceful deterministic-only run (model = null).
  const notes = readNotes();
  let model: ModelOutcome | null = null;
  if (settings.tier1) {
    model = await runModelPasses(digest, notes, settings).catch(() => null);
  }

  const narrative = renderNarrative(digest, audit, model);

  // Roll old scratchpad notes out (their content is now reflected here), then
  // decay stale background-derived memories (hygiene).
  const { removed } = rotateNotes(30);
  const decayed = decayStaleReflectionMemories(45);

  const entry: WellbeingEntry = {
    id: newId(),
    at: now.toISOString(),
    date: digest.date,
    trigger,
    narrative,
    audit,
    signalCount: digest.signals.length,
    notesRolled: removed.length,
    modelRan: !!model?.ran,
    memoriesApplied: model?.applied,
  };

  const store = load();
  store.entries.push(entry);
  if (store.entries.length > MAX_ENTRIES) store.entries = store.entries.slice(-MAX_ENTRIES);
  save(store);

  // Run/cost log for the Settings → Intelligence audit trail.
  appendReflectionLog({
    at: now.toISOString(),
    trigger,
    date: digest.date,
    demo: false,
    signalsSeen: digest.signals.length,
    notesSeen: notes.length,
    modelRan: !!model?.ran,
    skippedReason: model?.skippedReason,
    tierRuns: model?.tierRuns ?? [],
    proposed: model?.proposed ?? { adds: 0, updates: 0, retires: 0, questions: 0 },
    applied: model?.applied ?? { adds: 0, updates: 0, retires: 0 },
    decayed,
    estTokensTotal: (model?.tierRuns ?? []).reduce((a, r) => a + r.estTokens, 0),
  });

  return { ran: true, entry };
}

// ── read surface ──────────────────────────────────────────────────────────────
export function getWellbeingEntries(limit = 30): WellbeingEntry[] {
  return load().entries.slice(-limit).reverse(); // newest first
}
export function getLatestEntry(): WellbeingEntry | null {
  const e = load().entries;
  return e.length ? e[e.length - 1] : null;
}
