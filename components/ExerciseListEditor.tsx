"use client";

import { useState } from "react";
import { WorkoutExercise } from "@/lib/types";
import ExercisePicker from "@/components/ExercisePicker";
import ImageLightbox from "@/components/ImageLightbox";
import type { LibraryExercise } from "@/lib/exercise-library";

/** Short "3×10 @ 20kg" / "3 sets: 12×120, 10×140" summary for an exercise. */
function summary(ex: WorkoutExercise): string {
  if (ex.setList?.length) {
    return `${ex.setList.length} sets: ${ex.setList.map((s) => `${s.reps ?? "?"}${s.weightKg ? `×${s.weightKg}` : ""}`).join(", ")}`;
  }
  const parts: string[] = [];
  if (ex.sets && ex.reps) parts.push(`${ex.sets}×${ex.reps}`);
  else if (ex.reps) parts.push(`${ex.reps} reps`);
  else if (ex.sets) parts.push(`${ex.sets} sets`);
  if (ex.weightKg) parts.push(`@${ex.weightKg}kg`);
  return parts.join(" ");
}

const numCell = { width: 56, padding: "7px 8px", textAlign: "center" as const };

/**
 * Shared editor for the exercises inside a workout — add via the wger/custom
 * picker, tap a thumbnail to zoom, edit uniform sets/reps/weight inline, see
 * per-set entries as a summary. Used by the log-workout detail form, the
 * planner, and (later) the live session, so all stay in sync.
 */
export default function ExerciseListEditor({
  exercises,
  onChange,
  accent = "var(--activity)",
  showLabel = true,
}: {
  exercises: WorkoutExercise[];
  onChange: (next: WorkoutExercise[]) => void;
  accent?: string;
  showLabel?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [lightbox, setLightbox] = useState<LibraryExercise | null>(null);

  const setExercise = (i: number, patch: Partial<WorkoutExercise>) =>
    onChange(exercises.map((ex, j) => (j === i ? { ...ex, ...patch } : ex)));
  const removeExercise = (i: number) => onChange(exercises.filter((_, j) => j !== i));

  async function openLightbox(exerciseId: string) {
    try {
      const j = await fetch(`/api/exercise-library?uuid=${encodeURIComponent(exerciseId)}`).then((r) => r.json());
      if (j.exercise) setLightbox(j.exercise);
    } catch {
      // image unavailable
    }
  }

  const label = (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>exercises</span>
  );

  return (
    <>
      {exercises.length === 0 ? (
        <button onClick={() => setPicking(true)} style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 12.5, textAlign: "left", padding: 0 }}>
          + Add exercises
        </button>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {showLabel && label}
          {exercises.map((ex, i) => (
            <div key={i} className="stack" style={{ gap: 6, padding: "8px 10px", borderRadius: 10, background: "var(--bg-inset)" }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                {ex.exerciseId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/exercise-image?uuid=${ex.exerciseId}`} alt="" loading="lazy" onClick={() => openLightbox(ex.exerciseId!)} style={{ width: 34, height: 34, borderRadius: 7, objectFit: "cover", background: "var(--bg-raised)", cursor: "zoom-in", flex: "none" }} />
                ) : null}
                <input className="field" placeholder="Exercise" value={ex.name} onChange={(e) => setExercise(i, { name: e.target.value })} style={{ flex: "1 1 90px", minWidth: 0, padding: "7px 9px" }} />
                <button onClick={() => removeExercise(i)} aria-label="remove exercise" style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 14, flex: "none" }}>✕</button>
              </div>
              {ex.setList?.length ? (
                <span style={{ fontSize: 12, color: "var(--ink-soft)", paddingLeft: ex.exerciseId ? 42 : 0 }}>{summary(ex)}</span>
              ) : (
                <div className="row" style={{ gap: 6, paddingLeft: ex.exerciseId ? 42 : 0 }}>
                  <input className="field" type="number" min={0} placeholder="sets" value={ex.sets ?? ""} onChange={(e) => setExercise(i, { sets: e.target.value === "" ? undefined : Number(e.target.value) })} style={numCell} />
                  <input className="field" type="number" min={0} placeholder="reps" value={ex.reps ?? ""} onChange={(e) => setExercise(i, { reps: e.target.value === "" ? undefined : Number(e.target.value) })} style={numCell} />
                  <input className="field" type="number" min={0} placeholder="kg" value={ex.weightKg ?? ""} onChange={(e) => setExercise(i, { weightKg: e.target.value === "" ? undefined : Number(e.target.value) })} style={numCell} />
                </div>
              )}
            </div>
          ))}
          <button onClick={() => setPicking(true)} style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 12.5, textAlign: "left", padding: 0 }}>
            + Add exercise
          </button>
        </div>
      )}

      {picking && <ExercisePicker accent={accent} onAdd={(ex) => onChange([...exercises, ex])} onClose={() => setPicking(false)} />}
      {lightbox && <ImageLightbox exercise={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
