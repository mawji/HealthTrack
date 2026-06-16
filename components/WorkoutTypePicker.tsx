"use client";

import { useEffect, useState } from "react";
import { WorkoutType, filterTypes, searchExerciseTypes } from "@/lib/workout-types";

/** Quick-pick workout type chips with an "Other…" chip that opens a search
 *  menu over the full Google Health exercise-type catalog. Reused by the log
 *  forms and the relabel pickers on the daily and fitness pages. */
export function WorkoutTypePicker({
  quickTypes,
  selected,
  onPick,
  accent = "var(--activity)",
  accentSoft = "var(--activity-soft)",
  onRevert,
}: {
  quickTypes: WorkoutType[];
  selected?: string; // currently-selected exerciseType, for highlight
  onPick: (t: WorkoutType) => void;
  accent?: string;
  accentSoft?: string;
  onRevert?: () => void; // when set, shows a "Revert" chip
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Live full catalog, fetched from Google's discovery doc when search opens.
  // Starts from the bundled snapshot so the menu is instant, then swaps to live.
  const [catalog, setCatalog] = useState<WorkoutType[] | null>(null);

  useEffect(() => {
    if (searching && catalog === null) {
      fetch("/api/exercise-types")
        .then((r) => r.json())
        .then((j) => setCatalog(j.types?.length ? j.types : searchExerciseTypes("")))
        .catch(() => setCatalog(searchExerciseTypes("")));
    }
  }, [searching, catalog]);

  const chip = (active: boolean) => ({
    cursor: "pointer",
    border: "none",
    background: active ? accent : accentSoft,
    color: active ? "var(--bg)" : accent,
  });

  if (searching) {
    const results = filterTypes(catalog ?? searchExerciseTypes(""), query);
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="field"
            autoFocus
            placeholder="Search all exercise types…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: "8px 12px", flex: 1 }}
          />
          <button
            onClick={() => { setSearching(false); setQuery(""); }}
            style={{ background: "none", border: "none", color: "var(--ink-soft)", cursor: "pointer", fontSize: 13 }}
          >
            Cancel
          </button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", maxHeight: 168, overflowY: "auto" }}>
          {results.map((t) => (
            <button
              key={t.type}
              className="badge"
              onClick={() => { onPick(t); setSearching(false); setQuery(""); }}
              style={chip(t.type === selected)}
            >
              {t.label}
            </button>
          ))}
          {results.length === 0 && (
            <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>No matching types.</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {quickTypes.map((q) => (
        <button key={q.type} className="badge" onClick={() => onPick(q)} style={chip(q.type === selected)}>
          {q.label}
        </button>
      ))}
      <button
        className="badge"
        onClick={() => setSearching(true)}
        style={{ cursor: "pointer", border: `1px dashed ${accent}`, background: "transparent", color: accent }}
      >
        Other…
      </button>
      {onRevert && (
        <button
          className="badge"
          onClick={onRevert}
          style={{ cursor: "pointer", border: "1px solid var(--hairline)", background: "transparent", color: "var(--ink-soft)" }}
        >
          Revert
        </button>
      )}
    </div>
  );
}
