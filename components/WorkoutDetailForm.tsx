"use client";

import { useState } from "react";
import { WorkoutDetail } from "@/lib/types";
import { INTENSITIES } from "@/lib/workout-detail";

type Exercise = NonNullable<WorkoutDetail["exercises"]>[number];

/** Controlled capture form for the app-local structured workout detail
 *  (intensity, RPE, soreness, injury, exercises). Shared by the Daily quick-log
 *  disclosure, the Fitness log form, and the Fitness history editor. The
 *  exercises list sits behind its own expander to keep the form compact. */
export function WorkoutDetailForm({
  value,
  onChange,
  accent = "var(--food)",
  accentSoft = "var(--food-soft)",
}: {
  value: WorkoutDetail;
  onChange: (d: WorkoutDetail) => void;
  accent?: string;
  accentSoft?: string;
}) {
  const exercises = value.exercises ?? [];
  const [showExercises, setShowExercises] = useState(exercises.length > 0);

  const set = (patch: Partial<WorkoutDetail>) => onChange({ ...value, ...patch });

  const setExercise = (i: number, patch: Partial<Exercise>) => {
    const next = exercises.map((ex, j) => (j === i ? { ...ex, ...patch } : ex));
    set({ exercises: next });
  };
  const addExercise = () => set({ exercises: [...exercises, { name: "" }] });
  const removeExercise = (i: number) => {
    const next = exercises.filter((_, j) => j !== i);
    set({ exercises: next.length ? next : undefined });
  };

  const label = (t: string) => (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>{t}</span>
  );
  const numCell = { width: 56, padding: "7px 8px", textAlign: "center" as const };

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* Intensity */}
      <div className="stack" style={{ gap: 6 }}>
        {label("intensity")}
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {INTENSITIES.map((opt) => {
            const active = value.intensity === opt;
            return (
              <button
                key={opt}
                className="badge"
                onClick={() => set({ intensity: active ? undefined : opt })}
                style={{
                  cursor: "pointer",
                  border: "none",
                  textTransform: "capitalize",
                  background: active ? accent : accentSoft,
                  color: active ? "var(--bg)" : accent,
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Effort (RPE) */}
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          {label("effort (rpe)")}
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            {value.effort != null ? `${value.effort} / 10` : "—"}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={value.effort ?? 5}
            onChange={(e) => set({ effort: Number(e.target.value) })}
            style={{ flex: 1, accentColor: accent }}
          />
          {value.effort != null && (
            <button
              onClick={() => set({ effort: undefined })}
              style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 12 }}
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* Soreness / injury */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="stack" style={{ gap: 4, flex: "1 1 130px" }}>
          {label("soreness")}
          <input
            className="field"
            placeholder="e.g. quads, lower back"
            value={value.soreness ?? ""}
            onChange={(e) => set({ soreness: e.target.value || undefined })}
            style={{ padding: "8px 10px" }}
          />
        </label>
        <label className="stack" style={{ gap: 4, flex: "1 1 130px" }}>
          {label("injury")}
          <input
            className="field"
            placeholder="e.g. tight left knee"
            value={value.injury ?? ""}
            onChange={(e) => set({ injury: e.target.value || undefined })}
            style={{ padding: "8px 10px" }}
          />
        </label>
      </div>

      {/* Exercises */}
      {!showExercises ? (
        <button
          onClick={() => { setShowExercises(true); if (exercises.length === 0) addExercise(); }}
          style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 12.5, textAlign: "left", padding: 0 }}
        >
          + Add exercises
        </button>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {label("exercises")}
          {exercises.map((ex, i) => (
            <div key={i} className="row" style={{ gap: 6, alignItems: "center" }}>
              <input
                className="field"
                placeholder="Exercise"
                value={ex.name}
                onChange={(e) => setExercise(i, { name: e.target.value })}
                style={{ flex: "1 1 90px", minWidth: 0, padding: "7px 9px" }}
              />
              <input
                className="field"
                type="number"
                min={0}
                placeholder="sets"
                value={ex.sets ?? ""}
                onChange={(e) => setExercise(i, { sets: e.target.value ? Number(e.target.value) : undefined })}
                style={numCell}
              />
              <input
                className="field"
                type="number"
                min={0}
                placeholder="reps"
                value={ex.reps ?? ""}
                onChange={(e) => setExercise(i, { reps: e.target.value ? Number(e.target.value) : undefined })}
                style={numCell}
              />
              <input
                className="field"
                type="number"
                min={0}
                placeholder="kg"
                value={ex.weightKg ?? ""}
                onChange={(e) => setExercise(i, { weightKg: e.target.value ? Number(e.target.value) : undefined })}
                style={numCell}
              />
              <button
                onClick={() => removeExercise(i)}
                aria-label="remove exercise"
                style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 14, flex: "none" }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={addExercise}
            style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 12.5, textAlign: "left", padding: 0 }}
          >
            + Add exercise
          </button>
        </div>
      )}
    </div>
  );
}
