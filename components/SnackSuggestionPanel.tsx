"use client";

// Sleek bottom-sheet panel for picking an exercise snack. Lists the built-in
// routines (gentlest first) each with its animated demo and a "Grab it" button.
// Grabbing does NOT complete the snack — it hands the routine back to the row,
// which drops the figure into the next circle so the user can do their minute
// and then tap the circle to mark it done. Rendered through a portal to
// document.body so the fixed bottom sheet isn't trapped by a transformed
// ancestor (the card's entrance animation). See plans/exercise-snacks.md.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import SnackAnimation from "@/components/SnackAnimation";
import {
  SnackRoutine,
  routinesByEasiest,
  SNACK_SELF_CALIBRATION,
} from "@/lib/snack-routines";

const TIER_LABEL: Record<SnackRoutine["tier"], string> = {
  easy: "easy",
  moderate: "moderate",
  hard: "hard",
};

export default function SnackSuggestionPanel({
  open,
  onClose,
  onGrab,
}: {
  open: boolean;
  onClose: () => void;
  /** Hand the chosen routine back to the row (drops it on the next circle). */
  onGrab: (routineId: string) => void;
}) {
  const list = useMemo(() => routinesByEasiest(), []);
  const [featuredId, setFeaturedId] = useState(list[0]?.id);

  // Fresh random featured pick each time the panel opens.
  useEffect(() => {
    if (open) setFeaturedId(list[Math.floor(Math.random() * list.length)]?.id);
  }, [open, list]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const featured = list.find((r) => r.id === featuredId) ?? list[0];
  const shuffle = () => {
    let next = featuredId;
    while (list.length > 1 && next === featuredId) next = list[Math.floor(Math.random() * list.length)].id;
    setFeaturedId(next);
  };
  const grab = (id: string) => {
    onGrab(id);
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick an exercise snack"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "color-mix(in srgb, var(--bg) 55%, transparent)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--bg-raised)",
          border: "1px solid var(--hairline)",
          borderBottom: "none",
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          padding: "16px 16px calc(20px + env(safe-area-inset-bottom))",
          boxShadow: "0 -10px 40px color-mix(in srgb, var(--bg) 60%, transparent)",
          animation: "snack-sheet-up 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 2, background: "var(--hairline)", margin: "0 auto 14px" }} />

        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Grab a snack</h3>
          <button className="icon-btn" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          Pick one and we'll pop it on your next circle. Do your minute, then tap the circle to mark it done. {SNACK_SELF_CALIBRATION}
        </p>

        {/* Featured (shuffle) pick */}
        {featured && (
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              padding: 14,
              borderRadius: 16,
              marginBottom: 16,
              background: "var(--activity-soft)",
              border: "1px solid color-mix(in srgb, var(--activity) 35%, transparent)",
            }}
          >
            <span style={{ color: "var(--activity)", flexShrink: 0 }}>
              <SnackAnimation kind={featured.animation} size={56} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 2 }}>
                <strong style={{ fontSize: 15 }}>{featured.name}</strong>
                <button
                  onClick={shuffle}
                  aria-label="shuffle suggestion"
                  style={{
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    fontWeight: 600,
                    height: 24,
                    padding: "0 10px",
                    borderRadius: 999,
                    background: "var(--bg-raised)",
                    border: "1px solid var(--hairline)",
                    color: "var(--ink-soft)",
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
                    <path d="m18 2 4 4-4 4" />
                    <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
                    <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
                    <path d="m18 14 4 4-4 4" />
                  </svg>
                  shuffle
                </button>
              </div>
              <p style={{ margin: "0 0 9px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.4 }}>{featured.cue}</p>
              <button
                onClick={() => grab(featured.id)}
                style={{
                  cursor: "pointer",
                  border: "none",
                  borderRadius: 11,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#fff",
                  background: "var(--activity)",
                }}
              >
                Grab it
              </button>
            </div>
          </div>
        )}

        {/* Full list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: 13,
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
              }}
            >
              <span style={{ color: "var(--activity)", flexShrink: 0 }}>
                <SnackAnimation kind={r.animation} size={38} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                  <span className="badge" style={{ fontSize: 10.5, height: 19, padding: "0 7px", background: "var(--bg-raised)", border: "1px solid var(--hairline)", color: "var(--ink-soft)" }}>
                    {TIER_LABEL[r.tier]}
                  </span>
                  <span className="badge" style={{ fontSize: 10.5, height: 19, padding: "0 7px", background: "var(--bg-raised)", border: "1px solid var(--hairline)", color: "var(--ink-soft)" }}>
                    {r.where[0]}
                  </span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.35 }}>{r.cue}</p>
              </div>
              <button
                onClick={() => grab(r.id)}
                aria-label={`grab ${r.name}`}
                style={{
                  flexShrink: 0,
                  cursor: "pointer",
                  borderRadius: 10,
                  padding: "7px 13px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--activity)",
                  background: "var(--activity-soft)",
                  border: "1px solid color-mix(in srgb, var(--activity) 30%, transparent)",
                  whiteSpace: "nowrap",
                }}
              >
                Grab it
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
