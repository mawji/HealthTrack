"use client";

import { useEffect } from "react";

/**
 * A transient, auto-dismissing notice pinned to the bottom of the viewport.
 * Render conditionally: pass a non-null `message` to show it; `onDone` fires
 * after `duration` ms so the parent can clear its state.
 */
export default function Toast({
  message,
  onDone,
  duration = 5000,
  tone = "info",
}: {
  message: string | null;
  onDone: () => void;
  duration?: number;
  tone?: "info" | "warn";
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [message, duration, onDone]);

  if (!message) return null;

  const accent = tone === "warn" ? "var(--food)" : "var(--sleep)";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(92vw, 440px)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderRadius: 14,
        background: "var(--bg-raised)",
        border: `1px solid color-mix(in srgb, ${accent} 40%, var(--hairline))`,
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
        fontSize: 13.5,
        color: "var(--ink)",
        animation: "toast-rise 0.25s ease",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flex: "none" }} />
      <span style={{ lineHeight: 1.45 }}>{message}</span>
      <style>{`@keyframes toast-rise { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
    </div>
  );
}
