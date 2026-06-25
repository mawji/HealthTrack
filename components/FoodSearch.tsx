"use client";

import { useState } from "react";
import { FoodAnalysis } from "@/lib/types";

type Per100g = { calories: number; proteinG: number; carbsG: number; fatG: number };
export interface FoodCandidate {
  fdcId: number;
  label: string;
  dataType: string;
  analysis: FoodAnalysis;
  per100g: Per100g;
  servingG: number | null;
}

/**
 * USDA FoodData Central name search for the food composer. Mirrors the barcode
 * flow: search → pick a candidate → the composer fills macros (source-backed
 * density) with an editable serving. Explicit search (not per-keystroke) to stay
 * gentle on the shared DEMO_KEY rate limit.
 */
export default function FoodSearch({
  onPick,
  onClose,
}: {
  onPick: (c: FoodCandidate) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoodCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoKey, setDemoKey] = useState(false);

  async function run() {
    const query = q.trim();
    if (query.length < 2 || busy) return;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch(`/api/food/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.candidates ?? []);
      setDemoKey(!!json.demoKey);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--ink) 38%, transparent)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          paddingBottom: "max(18px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>Search foods</h2>
          <button className="icon-btn" aria-label="close" onClick={onClose}>✕</button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <input
            className="field"
            autoFocus
            placeholder="e.g. cooked brown rice, banana, chicken breast"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            style={{ flex: 1 }}
          />
          <button className="btn" style={{ background: "var(--food)" }} disabled={q.trim().length < 2 || busy} onClick={run}>
            {busy ? "…" : "Search"}
          </button>
        </div>

        <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
          Macros from USDA FoodData Central. {demoKey && "Using a shared demo key (rate-limited) — add a free key for regular use."}
        </p>

        {error && <p style={{ color: "var(--heart)", fontSize: 13, marginTop: 10 }}>{error}</p>}

        {results && results.length === 0 && !error && (
          <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 12 }}>No matches. Try a simpler name, or describe it for an AI estimate.</p>
        )}

        {results && results.length > 0 && (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {results.map((c) => {
              const a = c.analysis;
              const per = c.servingG ? `${c.servingG} g` : "100 g";
              return (
                <button
                  key={c.fdcId}
                  className="card row"
                  style={{ justifyContent: "space-between", gap: 10, cursor: "pointer", textAlign: "left", width: "100%", padding: "11px 14px" }}
                  onClick={() => onPick(c)}
                >
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 14, display: "block" }}>{a.name}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                      {a.calories} kcal / {per} · P{a.proteinG} C{a.carbsG} F{a.fatG} · {c.dataType}
                    </span>
                  </span>
                  <span style={{ color: "var(--food)", fontWeight: 700, fontSize: 18, flex: "none" }}>+</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
