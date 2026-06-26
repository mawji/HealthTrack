// Local persistence, validation, dedup/consolidation, and context selection for
// the coach memory — durable, human-readable facts about the person that the
// coach reads each turn and writes to as it learns. Route handlers stay thin and
// call into here. Memories never sync to Google Health; they live only in
// data/coach-memory.json. See plans/coach-memory-system.md.

import { readJson, writeJson, newId } from "./store";
import { CoachMemory, CoachMemoryCategory, CoachMemorySource } from "./types";

const FILE = "coach-memory.json";

const CATEGORIES: CoachMemoryCategory[] = [
  "preference", "constraint", "condition", "lifestyle",
  "goal", "advice", "pattern", "openness", "boundary", "other",
];
const SOURCES: CoachMemorySource[] = ["coach", "user", "proactive", "derived"];

// How many memories (and chars) the context block is allowed to spend. Pinned
// memories always surface; the rest fill the remaining budget by recency.
const MAX_LINES = 24;
const MAX_CHARS = 1600;

// ── small input helpers (untrusted bodies) ─────────────────────────────────
const str = (v: unknown, max = 280): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/\s+/g, " ").slice(0, max);
  return s || undefined;
};
const clamp01 = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
};
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Normalize text for dedup comparison: lowercase, strip punctuation, collapse. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Two facts are "the same" when one normalized text contains the other (covers
 *  rephrasings like "has a baby" vs "has an infant who wakes them"). */
function sameFact(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  // Only treat as duplicate when the shorter is a meaningful (≥ 3 word) subset.
  return short.split(" ").length >= 3 && long.includes(short);
}

// ── storage ─────────────────────────────────────────────────────────────────

export function getMemories(): CoachMemory[] {
  return readJson<CoachMemory[]>(FILE, []);
}

function saveMemories(memories: CoachMemory[]) {
  writeJson(FILE, memories);
}

/** Active (unarchived) memories. */
export function getActiveMemories(): CoachMemory[] {
  return getMemories().filter((m) => !m.archived);
}

function coerceCategory(v: unknown, fallback: CoachMemoryCategory = "other"): CoachMemoryCategory {
  return CATEGORIES.includes(v as CoachMemoryCategory) ? (v as CoachMemoryCategory) : fallback;
}
function coerceSource(v: unknown, fallback: CoachMemorySource = "coach"): CoachMemorySource {
  return SOURCES.includes(v as CoachMemorySource) ? (v as CoachMemorySource) : fallback;
}

export type AddMemoryInput = {
  text?: unknown;
  category?: unknown;
  source?: unknown;
  confidence?: unknown;
  topic?: unknown;
  pinned?: unknown;
};

/** Create a memory, deduping against existing active memories in the same
 *  category. A near-identical incoming fact updates the existing record
 *  (bumping updatedAt, keeping the longer/more-specific wording) instead of
 *  inserting a duplicate — the mechanical half of consolidation. */
export function addMemory(input: AddMemoryInput): { memory: CoachMemory; deduped: boolean } | { error: string } {
  const text = str(input.text);
  if (!text) return { error: "text is required" };
  const category = coerceCategory(input.category);
  const source = coerceSource(input.source);
  const confidence = clamp01(input.confidence);
  const topic = str(input.topic, 40);
  const now = new Date().toISOString();

  const memories = getMemories();

  // Dedup: same category + same fact → update the existing one in place.
  const dup = memories.find((m) => !m.archived && m.category === category && sameFact(m.text, text));
  if (dup) {
    // Keep the longer wording (usually more specific); refresh timestamps.
    if (text.length > dup.text.length) dup.text = text;
    if (topic && !dup.topic) dup.topic = topic;
    if (confidence != null) dup.confidence = Math.max(dup.confidence ?? 0, confidence);
    dup.updatedAt = now;
    saveMemories(memories);
    return { memory: dup, deduped: true };
  }

  const memory: CoachMemory = {
    id: newId(),
    text,
    category,
    source,
    confidence,
    topic,
    pinned: bool(input.pinned) ?? false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  memories.push(memory);
  saveMemories(memories);
  return { memory, deduped: false };
}

export type UpdateMemoryPatch = {
  text?: unknown;
  category?: unknown;
  topic?: unknown;
  pinned?: unknown;
  confidence?: unknown;
  archived?: unknown;
};

/** Patch an existing memory by id. Only provided fields change. */
export function updateMemory(id: string, patch: UpdateMemoryPatch): CoachMemory | null {
  const memories = getMemories();
  const m = memories.find((x) => x.id === id);
  if (!m) return null;
  const text = str(patch.text);
  if (text) m.text = text;
  if (patch.category !== undefined) m.category = coerceCategory(patch.category, m.category);
  if (patch.topic !== undefined) m.topic = str(patch.topic, 40);
  const pinned = bool(patch.pinned);
  if (pinned !== undefined) m.pinned = pinned;
  const confidence = clamp01(patch.confidence);
  if (confidence !== undefined) m.confidence = confidence;
  const archived = bool(patch.archived);
  if (archived !== undefined) m.archived = archived;
  m.updatedAt = new Date().toISOString();
  saveMemories(memories);
  return m;
}

/** Soft-delete (archive) a memory. Returns false if no such id. */
export function archiveMemory(id: string): boolean {
  const memories = getMemories();
  const m = memories.find((x) => x.id === id);
  if (!m || m.archived) return false;
  m.archived = true;
  m.updatedAt = new Date().toISOString();
  saveMemories(memories);
  return true;
}

/** Upsert a single derived (silent-watcher) memory keyed by topic: one durable
 *  record per topic that re-derives each run. If the wording changed, update it;
 *  if unchanged, leave it untouched (no churn). This is how the always-on data
 *  watchers keep one self-correcting "pattern" memory per signal rather than
 *  piling up duplicates. See lib/memory-watchers.ts. */
export function upsertDerivedMemory(input: {
  topic: string;
  text: string;
  category?: CoachMemoryCategory;
  confidence?: number;
}): CoachMemory | { error: string } {
  const text = str(input.text);
  const topic = str(input.topic, 60);
  if (!text || !topic) return { error: "text and topic are required" };
  const category = coerceCategory(input.category, "pattern");
  const now = new Date().toISOString();
  const memories = getMemories();
  const existing = memories.find((m) => !m.archived && m.source === "derived" && m.topic === topic);
  if (existing) {
    let changed = false;
    if (existing.text !== text) { existing.text = text; changed = true; }
    if (input.confidence != null && existing.confidence !== input.confidence) { existing.confidence = input.confidence; changed = true; }
    if (existing.category !== category) { existing.category = category; changed = true; }
    if (changed) { existing.updatedAt = now; saveMemories(memories); }
    return existing;
  }
  const memory: CoachMemory = {
    id: newId(),
    text,
    category,
    source: "derived",
    topic,
    confidence: input.confidence,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  memories.push(memory);
  saveMemories(memories);
  return memory;
}

/** Find existing same-topic memories — the hook the proactive loop / silent
 *  watchers use to consolidate repeated observations into one pattern memory
 *  (they supply the consolidated wording; the store keeps the grouping). */
export function memoriesForTopic(topic: string): CoachMemory[] {
  const t = normalize(topic);
  if (!t) return [];
  return getActiveMemories().filter((m) => m.topic && normalize(m.topic) === t);
}

// ── context selection ────────────────────────────────────────────────────────

/** Recency key: the most recent of updatedAt / lastUsedAt. */
function recencyKey(m: CoachMemory): number {
  return Math.max(Date.parse(m.updatedAt) || 0, Date.parse(m.lastUsedAt ?? "") || 0);
}

/** Light keyword-overlap score between a memory and the current user message. */
function relevance(m: CoachMemory, queryTokens: Set<string>): number {
  if (!queryTokens.size) return 0;
  let hits = 0;
  for (const tok of new Set(normalize(m.text).split(" "))) {
    if (tok.length >= 4 && queryTokens.has(tok)) hits++;
  }
  return hits;
}

/** Rank + cap memories for one coach turn: all pinned first, then the most
 *  recent (with a light relevance boost from the current message), within a
 *  fixed line/char budget so the prompt stays bounded as memories grow.
 *  `openness`/`boundary` memories are operational signals for the question
 *  loop, not coaching content, so they're excluded from the coach block. */
export function selectMemories(query?: string): CoachMemory[] {
  const active = getActiveMemories().filter((m) => m.category !== "openness" && m.category !== "boundary");
  const queryTokens = new Set(query ? normalize(query).split(" ").filter((t) => t.length >= 4) : []);

  const pinned = active.filter((m) => m.pinned);
  const rest = active
    .filter((m) => !m.pinned)
    .sort((a, b) => {
      const r = relevance(b, queryTokens) - relevance(a, queryTokens);
      return r !== 0 ? r : recencyKey(b) - recencyKey(a);
    });

  const chosen: CoachMemory[] = [];
  let chars = 0;
  for (const m of [...pinned, ...rest]) {
    if (chosen.length >= MAX_LINES || chars + m.text.length > MAX_CHARS) {
      if (m.pinned) {
        // Pinned always make it in even past the soft budget.
        chosen.push(m);
        chars += m.text.length;
      }
      continue;
    }
    chosen.push(m);
    chars += m.text.length;
  }
  return chosen;
}

/** Mark memories as just-used so recency ranking self-tunes over time. */
function touchUsed(ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  const memories = getMemories();
  const now = new Date().toISOString();
  let changed = false;
  for (const m of memories) {
    if (set.has(m.id)) {
      m.lastUsedAt = now;
      changed = true;
    }
  }
  if (changed) saveMemories(memories);
}

const CATEGORY_LABEL: Record<CoachMemoryCategory, string> = {
  preference: "preference",
  constraint: "constraint",
  condition: "condition",
  lifestyle: "lifestyle",
  goal: "goal",
  advice: "advice",
  pattern: "pattern",
  openness: "openness",
  boundary: "boundary",
  other: "note",
};

/** Render the selected memories as the `== Coach Memory ==` context block, and
 *  touch the ones included so ranking self-tunes. Empty string when none. The
 *  id is shown so the coach can target updateMemory/forgetFact. */
export function formatMemoryForCoach(query?: string): string {
  const selected = selectMemories(query);
  if (!selected.length) return "";
  touchUsed(selected.map((m) => m.id));
  const lines = [
    "== Coach Memory (durable, user-owned facts about the user; carry these across sessions) ==",
  ];
  for (const m of selected) {
    lines.push(`- [${CATEGORY_LABEL[m.category]} · ${m.id}] ${m.text}`);
  }
  return lines.join("\n");
}
