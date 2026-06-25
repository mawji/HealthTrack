"use client";

import { WorkoutDetail } from "@/lib/types";
import { INTENSITIES } from "@/lib/workout-detail";
import ExerciseListEditor from "@/components/ExerciseListEditor";

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
  const set = (patch: Partial<WorkoutDetail>) => onChange({ ...value, ...patch });

  const label = (t: string) => (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>{t}</span>
  );

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

      {/* Exercises (shared editor: wger/custom picker + per-set + image zoom) */}
      <ExerciseListEditor
        exercises={exercises}
        onChange={(next) => set({ exercises: next.length ? next : undefined })}
        accent={accent}
      />
    </div>
  );
}
