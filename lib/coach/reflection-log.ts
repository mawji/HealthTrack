// Run/cost log for the nightly reflection — the audit trail surfaced under
// Settings → Intelligence. One entry per reflection run: which tiers/models
// fired, rough cost (char-based token estimate — providers don't all return
// usage through our unified call), what was proposed vs applied, and any
// skip reason. See plans/coach-background-intelligence.md.

import { readJson, writeJson, newId } from "@/lib/store";

export interface TierRunLog {
  tier: "tier1" | "tier2";
  method: string;
  model: string;
  ms: number;
  ok: boolean;
  promptChars: number;
  replyChars: number;
  estTokens: number; // ~ (prompt+reply chars)/4, clearly an estimate
  error?: string;
}

export interface ReflectionLogEntry {
  id: string;
  at: string;
  trigger: "scheduled" | "manual";
  date: string; // digest date
  demo: boolean;
  signalsSeen: number;
  notesSeen: number;
  modelRan: boolean;
  skippedReason?: string; // why the model passes didn't run (e.g. "no tier configured")
  tierRuns: TierRunLog[];
  proposed: { adds: number; updates: number; retires: number; questions: number };
  applied: { adds: number; updates: number; retires: number };
  decayed: number; // stale reflection memories archived this run
  estTokensTotal: number;
}

const FILE = "coach-reflection-log.json";
const MAX = 50;

interface Store { entries: ReflectionLogEntry[] }

export function appendReflectionLog(entry: Omit<ReflectionLogEntry, "id">): ReflectionLogEntry {
  const store = readJson<Store>(FILE, { entries: [] });
  const rec: ReflectionLogEntry = { id: newId(), ...entry };
  store.entries.push(rec);
  if (store.entries.length > MAX) store.entries = store.entries.slice(-MAX);
  writeJson(FILE, store);
  return rec;
}

export function getReflectionLog(limit = 10): ReflectionLogEntry[] {
  return readJson<Store>(FILE, { entries: [] }).entries.slice(-limit).reverse();
}
