"use client";

import { useCallback, useEffect, useState } from "react";

export type OpenQuestion = { id: string; prompt: string; topic: string; kind: string } | null;

// Components that change the open question (answer/dismiss, or the coach page
// consuming it) dispatch this so the Daily card and the nav badge re-sync.
const CHANGED_EVENT = "ht-question-changed";
export function notifyQuestionChanged() {
  try { window.dispatchEvent(new Event(CHANGED_EVENT)); } catch {}
}

/**
 * Shared open-question state. `evaluate` runs the cadence-gated evaluation
 * (which also reconciles a stale question against the latest data) before
 * reading — the Daily card and the coach page pass true; the nav badge passes
 * false (read-only). Re-syncs when the app returns to the foreground and when
 * any component signals a change.
 */
export function useOpenQuestion(evaluate = false) {
  const [open, setOpen] = useState<OpenQuestion>(null);

  const load = useCallback(async () => {
    try {
      if (evaluate) await fetch("/api/coach/questions", { method: "POST" }).catch(() => {});
      const d = await fetch("/api/coach/questions").then((r) => r.json());
      setOpen(d?.open ?? null);
    } catch {
      // best-effort
    }
  }, [evaluate]);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(CHANGED_EVENT, load);
    };
  }, [load]);

  return { open, refresh: load };
}
