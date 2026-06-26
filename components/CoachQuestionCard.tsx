"use client";

import { useRouter } from "next/navigation";
import { useOpenQuestion, notifyQuestionChanged } from "./useOpenQuestion";

/**
 * Persistent "note from your coach" card on the Daily page. Unlike a transient
 * popup it stays until the user acts: "Sure" opens the coach chat (which raises
 * the question and captures the answer into memory); "Dismiss" snoozes it with
 * server-side backoff. Triggers a cadence-gated evaluation on mount/foreground,
 * which also reconciles a stale question against the latest data.
 */
export default function CoachQuestionCard() {
  const router = useRouter();
  const { open, refresh } = useOpenQuestion(true);

  if (!open) return null;

  const answer = () => router.push("/coach");
  const dismiss = async () => {
    await fetch("/api/coach/questions/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: open.id, action: "dismiss" }),
    }).catch(() => {});
    notifyQuestionChanged();
    refresh();
  };

  return (
    <section className="card rise rise-1" style={{ marginBottom: 16, borderLeft: "3px solid var(--breath)" }}>
      <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span
          style={{
            width: 24, height: 24, borderRadius: "50%", flex: "none",
            background: "radial-gradient(circle at 32% 30%, var(--breath-soft), var(--breath))",
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--breath)" }}>A note from your coach</span>
      </div>
      <p style={{ fontSize: 14.5, lineHeight: 1.45, marginBottom: 14 }}>{open.prompt}</p>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13 }} onClick={dismiss}>Dismiss</button>
        <button className="btn" style={{ padding: "8px 16px", fontSize: 13 }} onClick={answer}>Sure</button>
      </div>
    </section>
  );
}
