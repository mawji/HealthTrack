// The coach "scratchpad" — an append-only stream of cheap raw field notes, one
// per interaction (coach chat, a log, a lab upload, the daily sync). Distinct
// from durable CoachMemory: these are unsynthesised observations the nightly
// reflection pass reads, clusters, and distils. Writes are deterministic string
// appends (no model call) so dropping a note is effectively free.
//
// Stored as JSONL (one note per line) so appends never rewrite the whole file
// and the log can grow cheaply; rotation trims old lines once they've been rolled
// into the wellbeing journal. See plans/coach-background-intelligence.md.

import fs from "fs";
import { dataPath, ensureDir, newId } from "@/lib/store";

const FILE = "coach-scratchpad.jsonl";

/** Where a note came from. Keep this list small and stable. */
export type ScratchSource =
  | "coach-chat"
  | "food-photo"
  | "log"
  | "lab-upload"
  | "measurement"
  | "daily-sync"
  | "proactive";

export interface ScratchNote {
  id: string;
  ts: string; // ISO
  source: ScratchSource;
  note: string; // short, factual, human-readable
  tags?: string[]; // coarse topic tags for clustering (e.g. "food", "sleep")
  sensitive?: boolean; // never send to a non-local model tier
}

function filePath(): string {
  return dataPath(FILE);
}

/** Append one note. Cheap: a single line append, no read-modify-write. */
export function appendNote(input: {
  source: ScratchSource;
  note: string;
  tags?: string[];
  sensitive?: boolean;
}): ScratchNote | null {
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
  if (!note) return null;
  const rec: ScratchNote = {
    id: newId(),
    ts: new Date().toISOString(),
    source: input.source,
    note,
    tags: input.tags?.length ? input.tags.slice(0, 6).map((t) => t.slice(0, 24)) : undefined,
    sensitive: input.sensitive || undefined,
  };
  try {
    ensureDir(dataPath());
    fs.appendFileSync(filePath(), JSON.stringify(rec) + "\n", "utf8");
  } catch {
    // best-effort: a dropped note must never break the interaction that logged it
    return null;
  }
  return rec;
}

/** All notes, oldest first. Tolerates partial/corrupt trailing lines. */
export function readNotes(): ScratchNote[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return [];
  }
  const out: ScratchNote[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const n = JSON.parse(s) as ScratchNote;
      if (n && typeof n.note === "string" && typeof n.ts === "string") out.push(n);
    } catch {
      // skip a malformed line rather than failing the whole read
    }
  }
  return out;
}

/** Notes at or after `sinceIso`, oldest first. */
export function notesSince(sinceIso: string): ScratchNote[] {
  const t = Date.parse(sinceIso);
  if (!Number.isFinite(t)) return readNotes();
  return readNotes().filter((n) => (Date.parse(n.ts) || 0) >= t);
}

/** Most recent notes, newest first (for the audit surface). */
export function recentNotes(limit = 50): ScratchNote[] {
  return readNotes().slice(-limit).reverse();
}

/**
 * Trim notes older than `maxAgeDays`, rewriting the file with only the kept
 * lines. Returns the removed notes so the caller can roll them into the journal
 * before they're dropped. Keeps the file bounded as interactions accumulate.
 */
export function rotateNotes(maxAgeDays = 30): { kept: ScratchNote[]; removed: ScratchNote[] } {
  const all = readNotes();
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const kept: ScratchNote[] = [];
  const removed: ScratchNote[] = [];
  for (const n of all) {
    if ((Date.parse(n.ts) || 0) >= cutoff) kept.push(n);
    else removed.push(n);
  }
  if (removed.length) {
    try {
      ensureDir(dataPath());
      fs.writeFileSync(filePath(), kept.map((n) => JSON.stringify(n)).join("\n") + (kept.length ? "\n" : ""), "utf8");
    } catch {
      // if the rewrite fails, leave the file as-is; nothing is lost
      return { kept: all, removed: [] };
    }
  }
  return { kept, removed };
}
