// Phase 3: the model layer of the nightly reflection. Tier-1 (cheap/local) takes
// a first stab at what's worth remembering from the deterministic digest + recent
// interaction notes + existing memories; Tier-2 (optional refiner) validates and
// tightens before anything is persisted. ALL writes go through the existing memory
// store with source "reflection" and hard caps + guards, so the model proposes but
// deterministic code decides what actually lands and never rewrites user-authored
// facts. See plans/coach-background-intelligence.md.

import { completeWithProvider, parseJsonReply, ProviderType } from "@/lib/ai-provider";
import {
  addMemory, updateMemory, archiveMemory, getActiveMemories, getMemoryById,
} from "@/lib/memory";
import { CoachMemoryCategory } from "@/lib/types";
import { TierConfig, CoachIntelligenceSettings } from "@/lib/coach/intelligence-settings";
import { WellbeingDigest } from "@/lib/coach/digest";
import { ScratchNote } from "@/lib/coach/scratchpad";
import { TierRunLog } from "@/lib/coach/reflection-log";

// Hard rails — the model never exceeds these regardless of what it returns.
const MAX_UPDATES = 3;
const MAX_RETIRES = 3;
const MAX_OBS = 6;
const MAX_QUESTIONS = 2;
const MAX_MEMORY_CTX = 40; // existing memories shown to the model
const MAX_NOTE_CTX = 40;

// Aggressiveness tunes the add cap + a prompt line — how readily memories form.
const AGG: Record<string, { maxAdds: number; line: string }> = {
  conservative: { maxAdds: 3, line: "Be especially conservative: only record clearly durable, high-confidence facts; when in doubt, record nothing." },
  balanced: { maxAdds: 5, line: "" },
  eager: { maxAdds: 7, line: "You may also capture emerging tendencies worth watching, worded as clearly tentative ('seems to', 'an early sign')." },
};

const ADD_CATEGORIES: CoachMemoryCategory[] = [
  "preference", "constraint", "condition", "lifestyle", "goal", "advice", "pattern", "other",
];

interface RawOp {
  op?: string;
  id?: string;
  text?: string;
  category?: string;
  topic?: string;
  confidence?: number;
}
interface RawOut {
  observations?: unknown;
  questions?: unknown;
  memories?: unknown;
}

export interface ModelOutcome {
  ran: boolean;
  skippedReason?: string;
  observations: string[];
  openQuestions: string[];
  proposed: { adds: number; updates: number; retires: number; questions: number };
  applied: { adds: number; updates: number; retires: number };
  tierRuns: TierRunLog[];
}

const SCHEMA = `{"observations":["one short sentence about how they're doing"],"questions":["a gentle non-medical open question to explore later"],"memories":[{"op":"add","text":"one durable fact, one sentence","category":"pattern|lifestyle|preference|constraint|condition|goal|advice|other","topic":"short-key","confidence":0.6},{"op":"update","id":"<existing-id>","text":"corrected wording"},{"op":"retire","id":"<existing-id>"}]}`;

function strArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, max);
}

function memoryContext(): string {
  const mems = getActiveMemories()
    .filter((m) => m.category !== "openness" && m.category !== "boundary")
    .slice(0, MAX_MEMORY_CTX);
  if (!mems.length) return "(none yet)";
  return mems.map((m) => `[${m.id} · ${m.category} · ${m.source}] ${m.text}`).join("\n");
}

function noteContext(notes: ScratchNote[], method: ProviderType): string {
  // Sensitive notes never leave to a non-local tier.
  const usable = notes.filter((n) => !(n.sensitive && method !== "ollama")).slice(-MAX_NOTE_CTX);
  if (!usable.length) return "(no recent interaction notes)";
  return usable.map((n) => `- [${n.source}] ${n.note}`).join("\n");
}

function digestContext(digest: WellbeingDigest): string {
  const { w7, w30 } = digest.windows;
  const lines = [
    `Week: steps ${w7.avgSteps ?? "?"}/day (goal ${w7.stepsGoal ?? "?"}), ${w7.azmPerWeek ?? "?"} active-zone min, sleep ${w7.avgSleepMin != null ? (w7.avgSleepMin / 60).toFixed(1) + "h" : "?"}, ${w7.activeDays} active days, food logged ${w7.foodLoggedDays}/${w7.days}.`,
    `Month: steps ${w30.avgSteps ?? "?"}/day, ${w30.activeDays} active days, ${w30.shortNights} short nights.`,
    "Signals:",
    ...digest.signals.map((s) => `- (${s.severity}) ${s.area}: ${s.detail}`),
  ];
  return lines.join("\n");
}

const TIER1_SYSTEM =
  "You are a careful BACKGROUND health-reflection assistant for one person. You are not chatting with them — you are reviewing their week/month to decide what is worth remembering long-term and how they are doing. " +
  "Rules: be conservative and evidence-led — n=1 data is noisy, so prefer 'tends to' over certainty and never state a single day as a pattern. Never diagnose or give medical/dosing advice; frame anything clinical as 'discuss with their clinician'. " +
  "Do NOT duplicate facts already present in existing memories. Only propose retiring a memory if the digest clearly shows it no longer holds. Keep every memory to one short factual sentence. Avoid sensitive areas (mental health, finances, relationships) unless the notes clearly volunteer them. " +
  "Reply with STRICT JSON only — no prose, no code fences — matching: " + SCHEMA;

const TIER2_SYSTEM =
  "You refine a first-pass model's proposals before they are saved as the user's durable memories. Given the candidate JSON and the user's existing memories, return the FINAL conservative set. " +
  "Drop anything speculative, duplicated, already-known, sensitive, or not durable. Tighten wording to one factual sentence each. Keep ids on update/retire ops exactly as given. " +
  "Reply with STRICT JSON only in the same schema.";

function estTokens(promptChars: number, replyChars: number): number {
  return Math.round((promptChars + replyChars) / 4);
}

async function callTier(tier: TierConfig, system: string, user: string, label: "tier1" | "tier2"): Promise<{ raw: string; run: TierRunLog }> {
  const promptChars = system.length + user.length;
  const started = Date.now();
  try {
    const raw = await completeWithProvider(tier.method as ProviderType, tier.model, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true });
    const ms = Date.now() - started;
    return {
      raw,
      run: { tier: label, method: tier.method, model: tier.model, ms, ok: true, promptChars, replyChars: raw.length, estTokens: estTokens(promptChars, raw.length) },
    };
  } catch (e: any) {
    const ms = Date.now() - started;
    return {
      raw: "",
      run: { tier: label, method: tier.method, model: tier.model, ms, ok: false, promptChars, replyChars: 0, estTokens: estTokens(promptChars, 0), error: String(e?.message ?? e) },
    };
  }
}

function parseOut(raw: string): { observations: string[]; questions: string[]; ops: RawOp[] } {
  try {
    const j = parseJsonReply<RawOut>(raw);
    const ops = Array.isArray(j.memories) ? (j.memories as RawOp[]).filter((o) => o && typeof o === "object") : [];
    return { observations: strArr(j.observations, MAX_OBS), questions: strArr(j.questions, MAX_QUESTIONS), ops };
  } catch {
    return { observations: [], questions: [], ops: [] };
  }
}

/** Apply the (already model-refined) ops through the guarded memory store. */
function applyOps(ops: RawOp[], maxAdds: number): { adds: number; updates: number; retires: number } {
  let adds = 0, updates = 0, retires = 0;
  for (const op of ops) {
    const kind = String(op.op ?? "").toLowerCase();
    if (kind === "add" && adds < maxAdds) {
      const text = typeof op.text === "string" ? op.text.trim() : "";
      if (!text) continue;
      const category = (ADD_CATEGORIES.includes(op.category as CoachMemoryCategory) ? op.category : "pattern") as CoachMemoryCategory;
      const r = addMemory({ text, category, source: "reflection", confidence: op.confidence, topic: op.topic });
      if (!("error" in r)) adds++;
    } else if (kind === "update" && updates < MAX_UPDATES && op.id && typeof op.text === "string") {
      const m = getMemoryById(op.id);
      // Only re-word background-derived facts — never user/coach/proactive ones, never pinned.
      if (m && !m.archived && !m.pinned && (m.source === "reflection" || m.source === "derived")) {
        if (updateMemory(op.id, { text: op.text })) updates++;
      }
    } else if (kind === "retire" && retires < MAX_RETIRES && op.id) {
      const m = getMemoryById(op.id);
      if (m && !m.archived && !m.pinned && (m.source === "reflection" || m.source === "derived")) {
        if (archiveMemory(op.id)) retires++;
      }
    }
  }
  return { adds, updates, retires };
}

function countOps(ops: RawOp[]) {
  const c = { adds: 0, updates: 0, retires: 0 };
  for (const o of ops) {
    const k = String(o.op ?? "").toLowerCase();
    if (k === "add") c.adds++;
    else if (k === "update") c.updates++;
    else if (k === "retire") c.retires++;
  }
  return c;
}

const empty = (skippedReason?: string): ModelOutcome => ({
  ran: false, skippedReason, observations: [], openQuestions: [],
  proposed: { adds: 0, updates: 0, retires: 0, questions: 0 }, applied: { adds: 0, updates: 0, retires: 0 }, tierRuns: [],
});

/**
 * Run the model passes. Tier-1 drafts; Tier-2 (if configured) refines; only the
 * refined ops are applied (if a refiner is configured but fails, NO memory writes
 * happen — we don't persist unrefined output). With no Tier-2, Tier-1 ops apply
 * directly under the same caps. Returns observations + open questions for the
 * journal narrative and the per-tier run logs for the audit trail.
 */
export async function runModelPasses(
  digest: WellbeingDigest,
  notes: ScratchNote[],
  settings: CoachIntelligenceSettings
): Promise<ModelOutcome> {
  if (!settings.tier1) return empty("no Tier-1 model configured");
  if (!digest.signals.length && !notes.length) return empty("nothing notable to reflect on");

  const tierRuns: TierRunLog[] = [];
  const agg = AGG[settings.aggressiveness] ?? AGG.balanced;
  const memCtx = memoryContext();
  const t1user =
    `EXISTING MEMORIES:\n${memCtx}\n\nDETERMINISTIC DIGEST:\n${digestContext(digest)}\n\n` +
    `RECENT INTERACTION NOTES:\n${noteContext(notes, settings.tier1.method as ProviderType)}\n\n` +
    `Propose what's worth remembering and a couple of gentle open questions. JSON only.`;

  const t1 = await callTier(settings.tier1, TIER1_SYSTEM + (agg.line ? "\n" + agg.line : ""), t1user, "tier1");
  tierRuns.push(t1.run);
  if (!t1.run.ok) return { ...empty("Tier-1 call failed"), tierRuns };

  const draft = parseOut(t1.raw);
  if (!draft.ops.length && !draft.observations.length) {
    return { ran: true, observations: [], openQuestions: [], proposed: { adds: 0, updates: 0, retires: 0, questions: 0 }, applied: { adds: 0, updates: 0, retires: 0 }, tierRuns };
  }

  // Tier-2 refine (only when configured and there's something to refine).
  let finalOps = draft.ops;
  let observations = draft.observations;
  let questions = draft.questions;
  if (settings.tier2) {
    const t2user =
      `EXISTING MEMORIES:\n${memCtx}\n\nFIRST-PASS CANDIDATE (refine this):\n${t1.raw.slice(0, 4000)}\n\nReturn the final conservative JSON.`;
    const t2 = await callTier(settings.tier2, TIER2_SYSTEM, t2user, "tier2");
    tierRuns.push(t2.run);
    if (t2.run.ok) {
      const refined = parseOut(t2.raw);
      finalOps = refined.ops;
      observations = refined.observations.length ? refined.observations : draft.observations;
      questions = refined.questions.length ? refined.questions : draft.questions;
    } else {
      // Refiner requested but failed → don't persist unrefined memory writes.
      finalOps = [];
    }
  }

  const proposedCounts = countOps(finalOps);
  const applied = applyOps(finalOps, agg.maxAdds);
  return {
    ran: true,
    observations: observations.slice(0, MAX_OBS),
    openQuestions: questions.slice(0, MAX_QUESTIONS),
    proposed: { ...proposedCounts, questions: questions.length },
    applied,
    tierRuns,
  };
}
