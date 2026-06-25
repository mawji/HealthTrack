"use client";

import { useEffect, useState } from "react";
import type { LibraryExercise } from "@/lib/exercise-library";
import type { WorkoutExercise } from "@/lib/types";
import ImageLightbox from "@/components/ImageLightbox";

/**
 * Modal to add an exercise to a workout: search the wger/custom library (with
 * thumbnails), pick one (or type a free name), then capture sets/reps/weight —
 * uniform ("3×10 @ 20 kg") or per-set rows when they vary. Tapping the image
 * opens a full-screen view. Returns a WorkoutExercise via onAdd. Reused by the
 * log-workout detail form, the planner, and the live session.
 */
export default function ExercisePicker({
  onAdd,
  onClose,
  accent = "var(--activity)",
}: {
  onAdd: (ex: WorkoutExercise) => void;
  onClose: () => void;
  accent?: string;
}) {
  const [phase, setPhase] = useState<"search" | "configure">("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibraryExercise[]>([]);
  const [libReady, setLibReady] = useState<boolean | null>(null);

  // configure state
  const [selected, setSelected] = useState<LibraryExercise | null>(null);
  const [customName, setCustomName] = useState("");
  const [perSet, setPerSet] = useState(false);
  const [sets, setSets] = useState<number | undefined>(3);
  const [reps, setReps] = useState<number | undefined>(10);
  const [weightKg, setWeightKg] = useState<number | undefined>(undefined);
  const [rows, setRows] = useState<{ reps?: number; weightKg?: number }[]>([{}, {}, {}]);
  const [lightbox, setLightbox] = useState<LibraryExercise | null>(null);

  useEffect(() => {
    fetch("/api/exercise-library").then((r) => r.json()).then((m) => setLibReady(!!m.downloaded)).catch(() => setLibReady(false));
  }, []);

  async function search(query: string) {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const j = await fetch(`/api/exercise-library?q=${encodeURIComponent(query)}`).then((r) => r.json());
      setResults(j.exercises ?? []);
    } catch {
      setResults([]);
    }
  }

  function configureFor(ex: LibraryExercise | null, name: string) {
    setSelected(ex);
    setCustomName(name);
    setPerSet(false);
    setSets(3);
    setReps(10);
    setWeightKg(undefined);
    setRows([{}, {}, {}]);
    setPhase("configure");
  }

  const name = selected?.name ?? customName;

  function add() {
    if (!name.trim()) return;
    const base: WorkoutExercise = { exerciseId: selected?.uuid, name: name.trim() };
    if (perSet) {
      base.setList = rows.filter((r) => r.reps != null || r.weightKg != null);
    } else {
      base.sets = sets;
      base.reps = reps;
      base.weightKg = weightKg;
    }
    onAdd(base);
    onClose();
  }

  const numStyle = { width: 64, padding: "8px 9px", textAlign: "center" as const };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 150, background: "color-mix(in srgb, var(--ink) 40%, transparent)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "min(560px, 100%)", height: "min(560px, 88vh)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: "max(18px, env(safe-area-inset-bottom))" }}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, flex: "0 0 auto" }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>{phase === "search" ? "Add exercise" : name || "Configure"}</h2>
          <button className="icon-btn" aria-label="close" onClick={onClose}>✕</button>
        </div>

        {phase === "search" ? (
          <>
            <input
              className="field"
              autoFocus
              placeholder={libReady === false ? "Type an exercise name" : "Search exercises (e.g. squat, bench)"}
              value={q}
              onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) configureFor(null, q.trim()); }}
              style={{ flex: "0 0 auto" }}
            />
            {libReady === false && (
              <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6, flex: "0 0 auto" }}>The exercise library isn’t downloaded yet — you can still type a name, or download it from the Training plan section.</p>
            )}

            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: 12 }}>
            {results.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                {results.map((ex) => (
                  <div key={ex.uuid} className="row" style={{ gap: 10, padding: "8px 10px", borderRadius: 10, background: "var(--bg-inset)" }}>
                    {ex.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/exercise-image?uuid=${ex.uuid}`}
                        alt=""
                        loading="lazy"
                        onClick={() => setLightbox(ex)}
                        style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", background: "var(--bg-raised)", cursor: "zoom-in", flex: "none" }}
                      />
                    ) : (
                      <span style={{ width: 40, height: 40, borderRadius: 8, background: "var(--bg-raised)", flex: "none" }} />
                    )}
                    <button onClick={() => configureFor(ex, ex.name)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "var(--ink)" }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{ex.name}{ex.source === "custom" && <span style={{ fontSize: 10.5, color: accent, marginLeft: 6 }}>custom</span>}</div>
                      {ex.muscles.length > 0 && <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{ex.muscles.slice(0, 3).join(", ")}</div>}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {q.trim().length >= 2 && (
              <button className="btn btn-ghost" style={{ marginTop: 12, width: "100%" }} onClick={() => configureFor(null, q.trim())}>
                Use “{q.trim()}” as a custom exercise
              </button>
            )}
            </div>
          </>
        ) : (
          <div className="stack" style={{ gap: 14, flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            <div className="row" style={{ gap: 12 }}>
              {selected?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/exercise-image?uuid=${selected.uuid}`} alt={selected.name} onClick={() => setLightbox(selected)} style={{ width: 84, height: 84, borderRadius: 12, objectFit: "cover", background: "var(--bg-inset)", cursor: "zoom-in", flex: "none" }} />
              ) : null}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{name}</div>
                {selected?.muscles.length ? <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>{selected.muscles.join(" · ")}</div> : null}
                {selected?.image && <button onClick={() => setLightbox(selected)} style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 12, padding: "4px 0 0" }}>View image</button>}
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn" style={{ flex: 1, padding: "7px 0", fontSize: 13, background: !perSet ? accent : "var(--bg-raised)", color: !perSet ? "var(--bg)" : "var(--ink-soft)", border: "1px solid var(--hairline)" }} onClick={() => setPerSet(false)}>Uniform sets</button>
              <button className="btn" style={{ flex: 1, padding: "7px 0", fontSize: 13, background: perSet ? accent : "var(--bg-raised)", color: perSet ? "var(--bg)" : "var(--ink-soft)", border: "1px solid var(--hairline)" }} onClick={() => setPerSet(true)}>Per-set</button>
            </div>

            {!perSet ? (
              <div className="row" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <NumCell label="sets" value={sets} onChange={setSets} style={numStyle} />
                <span style={{ alignSelf: "flex-end", paddingBottom: 8, color: "var(--ink-faint)" }}>×</span>
                <NumCell label="reps" value={reps} onChange={setReps} style={numStyle} />
                <span style={{ alignSelf: "flex-end", paddingBottom: 8, color: "var(--ink-faint)" }}>@</span>
                <NumCell label="kg" value={weightKg} onChange={setWeightKg} style={numStyle} />
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {rows.map((r, i) => (
                  <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
                    <span style={{ width: 34, fontSize: 12, color: "var(--ink-soft)" }}>#{i + 1}</span>
                    <NumCell label="reps" value={r.reps} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, reps: v } : x)))} style={numStyle} />
                    <span style={{ alignSelf: "flex-end", paddingBottom: 8, color: "var(--ink-faint)" }}>@</span>
                    <NumCell label="kg" value={r.weightKg} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, weightKg: v } : x)))} style={numStyle} />
                    {rows.length > 1 && <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="remove set" style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer" }}>✕</button>}
                  </div>
                ))}
                <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "5px 12px", fontSize: 12.5 }} onClick={() => setRows([...rows, {}])}>+ Add set</button>
              </div>
            )}

            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              <button className="btn btn-ghost" onClick={() => setPhase("search")}>Back</button>
              <button className="btn" style={{ flex: 1, background: accent }} onClick={add}>Add exercise</button>
            </div>
          </div>
        )}
      </div>

      {lightbox && <ImageLightbox exercise={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function NumCell({ label, value, onChange, style }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; style: React.CSSProperties }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", textAlign: "center" }}>{label}</span>
      <input
        className="field"
        type="number"
        inputMode="decimal"
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)))}
        style={style}
      />
    </label>
  );
}
