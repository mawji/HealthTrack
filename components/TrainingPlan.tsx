"use client";

import { useEffect, useState } from "react";
import { WorkoutTypePicker } from "@/components/WorkoutTypePicker";
import { DEFAULT_QUICK_TYPES, WorkoutType, labelForType } from "@/lib/workout-types";
import { IconChip, workoutIcon } from "@/components/icons";
import ExerciseListEditor from "@/components/ExerciseListEditor";
import type { WorkoutPlanItem, PlanIntensity } from "@/lib/training-plan";
import type { WorkoutExercise } from "@/lib/types";

const INTENSITIES: PlanIntensity[] = ["easy", "moderate", "hard"];

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayLabel(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) return "Today";
  if (date === tomorrow()) return "Tomorrow";
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

interface LibMeta {
  downloaded: boolean;
  count: number;
  customCount: number;
  imagesAvailable: number;
  imagesLocal: number;
  attribution: string;
}

export default function TrainingPlan({ onChange, onStart }: { onChange?: () => void; onStart?: (item: WorkoutPlanItem) => void }) {
  const [items, setItems] = useState<WorkoutPlanItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lib, setLib] = useState<LibMeta | null>(null);
  const [libBusy, setLibBusy] = useState(false);

  // form state (shared by add + edit)
  const [type, setType] = useState<WorkoutType>(DEFAULT_QUICK_TYPES[2]);
  const [name, setName] = useState("");
  const [date, setDate] = useState(tomorrow());
  const [durationStr, setDurationStr] = useState("45"); // raw string so it can be cleared/edited freely
  const [intensity, setIntensity] = useState<PlanIntensity>("moderate");
  const [focus, setFocus] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);

  const load = () =>
    fetch("/api/workout-plans?upcoming=1")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .catch(() => {});

  const loadLib = () =>
    fetch("/api/exercise-library")
      .then((r) => r.json())
      .then(setLib)
      .catch(() => {});

  useEffect(() => {
    load();
    loadLib();
  }, []);

  function resetForm() {
    setType(DEFAULT_QUICK_TYPES[2]);
    setName("");
    setDate(tomorrow());
    setDurationStr("45");
    setIntensity("moderate");
    setFocus("");
    setNotes("");
    setExercises([]);
    setEditingId(null);
  }

  function openAdd() {
    if (adding) { setAdding(false); return; }
    resetForm();
    setAdding(true);
  }

  function openEdit(it: WorkoutPlanItem) {
    setType({ type: it.exerciseType, label: labelForType(it.exerciseType) });
    setName(it.name);
    setDate(it.date);
    setDurationStr(String(it.durationMin));
    setIntensity(it.intensity ?? "moderate");
    setFocus(it.focus ?? "");
    setNotes(it.notes ?? "");
    setExercises(it.exercises ?? []);
    setEditingId(it.id);
    setAdding(true);
  }

  async function save() {
    setBusy("save");
    try {
      const body = {
        name: name.trim() || labelForType(type.type),
        exerciseType: type.type,
        date,
        durationMin: Math.max(1, Math.round(Number(durationStr) || 45)),
        intensity,
        focus: focus.trim() || undefined,
        notes: notes.trim() || undefined,
        exercises,
      };
      const url = editingId ? `/api/workout-plans?id=${editingId}` : "/api/workout-plans";
      await fetch(url, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setAdding(false);
      resetForm();
      await load();
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, action: "complete" | "skip") {
    setBusy(id);
    try {
      await fetch(`/api/workout-plans?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/workout-plans?id=${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function libAction(action: "download" | "downloadImages") {
    setLibBusy(true);
    try {
      await fetch("/api/exercise-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      await loadLib();
    } finally {
      setLibBusy(false);
    }
  }

  // Group by date.
  const groups = new Map<string, WorkoutPlanItem[]>();
  for (const it of items) {
    if (!groups.has(it.date)) groups.set(it.date, []);
    groups.get(it.date)!.push(it);
  }

  return (
    <section className="card rise rise-2">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 560 }}>Training plan</h2>
        <button className="btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={openAdd}>
          {adding ? "Close" : "+ Plan a workout"}
        </button>
      </div>

      {adding && (
        <div className="stack" style={{ gap: 12, marginBottom: 16, padding: 14, borderRadius: 12, background: "var(--bg-inset)" }}>
          {editingId && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Editing planned workout</div>}
          {/* Workout TYPE (a workout is a session of a kind) */}
          <WorkoutTypePicker quickTypes={DEFAULT_QUICK_TYPES} selected={type.type} onPick={setType} />
          <input className="field" placeholder={`Workout name (default: ${labelForType(type.type)})`} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>Date</span>
              <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginTop: 3 }} />
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>Minutes</span>
              <input
                className="field"
                type="number"
                inputMode="numeric"
                min={1}
                value={durationStr}
                onChange={(e) => setDurationStr(e.target.value)}
                onBlur={() => setDurationStr((s) => (s.trim() === "" ? "45" : String(Math.max(1, Math.round(Number(s) || 45)))))}
                style={{ marginTop: 3 }}
              />
            </label>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {INTENSITIES.map((i) => (
              <button key={i} onClick={() => setIntensity(i)} className="btn" style={{ flex: 1, padding: "7px 0", fontSize: 12.5, textTransform: "capitalize", background: intensity === i ? "var(--activity)" : "var(--bg-raised)", color: intensity === i ? "var(--bg)" : "var(--ink-soft)", border: "1px solid var(--hairline)" }}>
                {i}
              </button>
            ))}
          </div>
          <input className="field" placeholder="Focus (e.g. legs, tempo)" value={focus} onChange={(e) => setFocus(e.target.value)} />
          <input className="field" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

          {/* Exercises WITHIN the workout (wger/custom picker + per-set) */}
          <div className="stack" style={{ gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>exercises</span>
            <ExerciseListEditor exercises={exercises} onChange={setExercises} showLabel={false} />
          </div>

          <button className="btn" style={{ background: "var(--activity)" }} disabled={busy === "save"} onClick={save}>
            {busy === "save" ? "Saving…" : editingId ? "Save changes" : "Add to plan"}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>No upcoming workouts planned. Add one, or ask the coach to plan your week.</p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {[...groups.entries()].map(([d, list]) => (
            <div key={d}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{dayLabel(d)}</div>
              <div className="stack" style={{ gap: 8 }}>
                {list.map((it) => (
                  <div key={it.id} className="card" style={{ padding: "11px 14px" }}>
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <IconChip icon={workoutIcon(it.exerciseType)} color="var(--activity)" size={28} />
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 14.5 }}>{it.name}</strong>
                        <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                          {it.durationMin} min{it.intensity ? ` · ${it.intensity}` : ""}{it.focus ? ` · ${it.focus}` : ""}
                          {it.exercises?.length ? ` · ${it.exercises.length} exercise${it.exercises.length > 1 ? "s" : ""}` : ""}
                          {it.estCalories ? ` · ~${it.estCalories} kcal (est.)` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {onStart && (
                        <button className="btn" style={{ padding: "6px 14px", fontSize: 12.5, background: "var(--activity)" }} onClick={() => onStart(it)}>Start</button>
                      )}
                      <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }} disabled={busy === it.id} onClick={() => act(it.id, "complete")}>
                        {busy === it.id ? "…" : "Complete"}
                      </button>
                      <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => openEdit(it)}>Edit</button>
                      <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }} disabled={busy === it.id} onClick={() => act(it.id, "skip")}>Skip</button>
                      <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5, color: "var(--heart)" }} disabled={busy === it.id} onClick={() => remove(it.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Exercise library (wger, opt-in download) */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
        {lib?.downloaded ? (
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
              Exercise library: {lib.count} exercises{lib.customCount ? ` + ${lib.customCount} custom` : ""} · images {lib.imagesLocal}/{lib.imagesAvailable} offline. {lib.attribution}
            </span>
            <div className="row" style={{ gap: 8 }}>
              {lib.imagesLocal < lib.imagesAvailable && (
                <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} disabled={libBusy} onClick={() => libAction("downloadImages")}>
                  {libBusy ? "Working…" : `Download images (${lib.imagesAvailable - lib.imagesLocal})`}
                </button>
              )}
              <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} disabled={libBusy} onClick={() => libAction("download")}>
                {libBusy ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Download a reference exercise library from wger (CC-BY-SA) for planning.</span>
            <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} disabled={libBusy} onClick={() => libAction("download")}>
              {libBusy ? "Downloading…" : "Download exercise library"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
