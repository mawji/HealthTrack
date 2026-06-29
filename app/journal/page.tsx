"use client";

import { useEffect, useMemo, useState } from "react";
import { IconChip, habitIcon, workoutIcon, workoutLabel as _wl, ForkIcon } from "@/components/icons";
import { WorkoutDetailForm } from "@/components/WorkoutDetailForm";
import { WellbeingJournal } from "@/components/WellbeingJournal";
import { WorkoutTypePicker } from "@/components/WorkoutTypePicker";
import { detailIsEmpty, formatDetail } from "@/lib/workout-detail";
import { DEFAULT_QUICK_TYPES, WorkoutType } from "@/lib/workout-types";
import { FoodEntry, Measurement, MeasurementKind, WorkoutDetail, WorkoutSession } from "@/lib/types";

// ── filters ──────────────────────────────────────────────────────────────────
type Kind = "workout" | "food" | "measurement" | "water" | "habit";
const FILTERS: { key: Kind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "workout", label: "Activity" },
  { key: "food", label: "Food" },
  { key: "measurement", label: "Vitals" },
  { key: "water", label: "Water" },
  { key: "habit", label: "Habits" },
];

interface WaterDay { date: string; ml: number; glasses: number; lastAt: string }
interface HabitRec { id: string; date: string; name: string; value: boolean | number; unit?: string; targetType?: string; iconKey: string; note?: string }

interface JournalItem {
  id: string;
  at: string; // ISO
  kind: Kind;
  workout?: WorkoutSession;
  food?: FoodEntry;
  measurement?: Measurement;
  water?: WaterDay;
  habit?: HabitRec;
}

const MEAS_LABEL: Record<MeasurementKind, string> = {
  weight: "Weight", glucose: "Glucose", "body-temp": "Body temperature", "body-fat": "Body fat",
  sleep: "Sleep", "muscle-mass": "Muscle mass", "blood-pressure": "Blood pressure",
};
const MEAS_ICON: Record<MeasurementKind, string> = {
  weight: "scale", glucose: "water", "body-temp": "flame", "body-fat": "leaf",
  sleep: "moon", "muscle-mass": "dumbbell", "blood-pressure": "pulse",
};

function measValue(m: Measurement): string {
  if (m.kind === "sleep") return `${(m.value / 60).toFixed(1)}h`;
  if (m.kind === "blood-pressure") return `${m.value}/${m.value2 ?? "—"} ${m.unit}`;
  return `${m.value} ${m.unit}`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function dayKey(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayHeading(key: string) {
  const today = dayKey(new Date().toISOString());
  if (key === today) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === dayKey(y.toISOString())) return "Yesterday";
  return new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function JournalPage() {
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [water, setWater] = useState<WaterDay[]>([]);
  const [habits, setHabits] = useState<HabitRec[]>([]);
  const [quickTypes, setQuickTypes] = useState<WorkoutType[]>(DEFAULT_QUICK_TYPES);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [view, setView] = useState<"log" | "wellbeing">("log");
  const [editing, setEditing] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const [w, f, m, wa, h] = await Promise.all([
      fetch("/api/workouts?days=60").then((r) => r.json()).catch(() => ({})),
      fetch("/api/food/log").then((r) => r.json()).catch(() => ({})),
      fetch("/api/measurements?limit=500").then((r) => r.json()).catch(() => ({})),
      fetch("/api/water?history=60").then((r) => r.json()).catch(() => ({})),
      fetch("/api/habits/record?days=60").then((r) => r.json()).catch(() => ({})),
    ]);
    setWorkouts(w.sessions ?? []);
    if (w.quickTypes?.length) setQuickTypes(w.quickTypes);
    setFoods(f.local ?? []);
    setMeasurements(m.measurements ?? []);
    setWater(wa.days ?? []);
    setHabits(h.records ?? []);
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  // Deep-link: /journal?view=wellbeing (from the Settings → Intelligence panel).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "wellbeing") setView("wellbeing");
  }, []);

  const items = useMemo<JournalItem[]>(() => {
    const all: JournalItem[] = [
      ...workouts.map((w) => ({ id: `w-${w.id}`, at: `${w.date}T${w.startTime || "00:00"}:00`, kind: "workout" as const, workout: w })),
      ...foods.map((f) => ({ id: `f-${f.id}`, at: f.loggedAt, kind: "food" as const, food: f })),
      ...measurements.map((m) => ({ id: `m-${m.id}`, at: m.at, kind: "measurement" as const, measurement: m })),
      ...water.map((d) => ({ id: `wa-${d.date}`, at: d.lastAt, kind: "water" as const, water: d })),
      ...habits.map((h) => ({ id: `h-${h.id}`, at: `${h.date}T12:00:00`, kind: "habit" as const, habit: h })),
    ];
    return all.filter((it) => filter === "all" || it.kind === filter).sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [workouts, foods, measurements, water, habits, filter]);

  const groups = useMemo(() => {
    const g = new Map<string, JournalItem[]>();
    for (const it of items) {
      const k = dayKey(it.at);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(it);
    }
    return [...g.entries()];
  }, [items]);

  // ── delete handlers ─────────────────────────────────────────────────────────
  async function del(it: JournalItem) {
    const msg = it.kind === "water" ? "Delete this day's water log?" : "Delete this entry?";
    if (!confirm(msg)) return;
    if (it.kind === "workout") await fetch(`/api/workouts?id=${it.workout!.id}`, { method: "DELETE" });
    else if (it.kind === "food") await fetch(`/api/food/log?id=${it.food!.id}`, { method: "DELETE" });
    else if (it.kind === "measurement") await fetch(`/api/measurements?id=${encodeURIComponent(it.measurement!.id)}`, { method: "DELETE" });
    else if (it.kind === "water") await fetch(`/api/water?date=${it.water!.date}`, { method: "DELETE" });
    else if (it.kind === "habit") await fetch(`/api/habits/record?id=${encodeURIComponent(it.habit!.id)}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Journal.</h1>
        <p className="page-sub">Everything you've logged — workouts, food, water, measurements, and habits — in one place to review and edit.</p>
      </header>

      <div className="row rise rise-1" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button className={`btn ${view === "log" ? "" : "btn-ghost"}`} style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => setView("log")}>Log</button>
        <button className={`btn ${view === "wellbeing" ? "" : "btn-ghost"}`} style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => setView("wellbeing")}>Wellbeing</button>
      </div>

      {view === "wellbeing" ? (
        <WellbeingJournal />
      ) : (
      <>
      <div className="row rise rise-1" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={`btn ${filter === f.key ? "" : "btn-ghost"}`} style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <section className="card"><p style={{ color: "var(--ink-soft)" }}>Nothing logged in this view yet.</p></section>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {groups.map(([key, dayItems]) => (
            <div key={key}>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>{dayHeading(key)}</p>
              <div className="stack" style={{ gap: 8 }}>
                {dayItems.map((it) => (
                  <Row
                    key={it.id}
                    item={it}
                    quickTypes={quickTypes}
                    editing={editing === it.id}
                    onToggleEdit={() => setEditing(editing === it.id ? null : it.id)}
                    onChanged={load}
                    onDelete={() => del(it)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

    </main>
  );
}

// ── one row, with per-kind inline editor ─────────────────────────────────────
function Row({ item, quickTypes, editing, onToggleEdit, onChanged, onDelete }: {
  item: JournalItem; quickTypes: WorkoutType[]; editing: boolean; onToggleEdit: () => void; onChanged: () => void; onDelete: () => void;
}) {
  const { icon, color, title, sub, value } = describe(item);
  // Journal can delete app-logged things; synced/Google workouts stay read-only here.
  const deletable = item.kind !== "workout" || item.workout!.source === "journal";
  const hasEditor = item.kind === "workout" || item.kind === "food" || item.kind === "measurement";

  return (
    <section className="card" style={{ padding: "12px 16px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <IconChip icon={icon} color={color} size={32} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 14.5 }}>{title}</strong>
            <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{fmtTime(item.at)}{sub ? ` · ${sub}` : ""}</p>
          </div>
        </div>
        <div className="row" style={{ gap: 10, flex: "none" }}>
          {value && <span className="display-num" style={{ fontSize: 16, color }}>{value}</span>}
          {hasEditor && <button className="icon-btn" aria-label="edit" style={{ color: editing ? "var(--activity)" : "var(--ink-faint)" }} onClick={onToggleEdit}>✎</button>}
          {deletable && <button className="icon-btn" aria-label="delete" style={{ color: "var(--ink-faint)" }} onClick={onDelete}>✕</button>}
        </div>
      </div>
      {editing && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
          {item.kind === "workout" && <WorkoutEditor w={item.workout!} quickTypes={quickTypes} onChanged={() => { onChanged(); }} />}
          {item.kind === "food" && <FoodEditor f={item.food!} onSaved={() => { onToggleEdit(); onChanged(); }} />}
          {item.kind === "measurement" && <MeasurementEditor m={item.measurement!} onSaved={() => { onToggleEdit(); onChanged(); }} />}
        </div>
      )}
    </section>
  );
}

function describe(it: JournalItem): { icon: React.ReactNode; color: string; title: string; sub: string; value: string } {
  if (it.kind === "workout") {
    const w = it.workout!;
    return {
      icon: workoutIcon(w.exerciseType), color: "var(--food)", title: _wl(w),
      sub: [`${w.durationMin} min`, w.distanceKm ? `${w.distanceKm} km` : "", !detailIsEmpty(w.detail) ? formatDetail(w.detail) : "", w.source === "journal" ? (w.syncedToHealth ? "synced" : "journal") : ""].filter(Boolean).join(" · "),
      value: w.calories != null ? `${w.calories} kcal` : "",
    };
  }
  if (it.kind === "food") {
    const f = it.food!;
    return { icon: ForkIcon, color: "var(--food)", title: f.name, sub: [`P${f.proteinG} C${f.carbsG} F${f.fatG}`, f.mealType && f.mealType !== "other" ? f.mealType : ""].filter(Boolean).join(" · "), value: `${f.calories} kcal` };
  }
  if (it.kind === "water") {
    const w = it.water!;
    return { icon: habitIcon("water"), color: "var(--sleep)", title: "Water", sub: `${w.glasses} glass${w.glasses === 1 ? "" : "es"}`, value: `${(w.ml / 1000).toFixed(2)} L` };
  }
  if (it.kind === "habit") {
    const h = it.habit!;
    const val = typeof h.value === "boolean" ? (h.value ? "yes" : "no") : `${h.value}${h.unit ? ` ${h.unit}` : ""}`;
    return { icon: habitIcon(h.iconKey), color: "var(--activity)", title: h.name, sub: h.note ?? "", value: val };
  }
  const m = it.measurement!;
  return { icon: habitIcon(MEAS_ICON[m.kind]), color: "var(--breath)", title: MEAS_LABEL[m.kind], sub: [m.context?.replace("_", " ") ?? "", m.note ?? ""].filter(Boolean).join(" · "), value: measValue(m) };
}

// ── per-kind editors ─────────────────────────────────────────────────────────
function WorkoutEditor({ w, quickTypes, onChanged }: { w: WorkoutSession; quickTypes: WorkoutType[]; onChanged: () => void }) {
  const [detail, setDetail] = useState<WorkoutDetail>(w.detail ?? {});
  const [saving, setSaving] = useState(false);
  async function relabel(t?: WorkoutType) {
    await fetch("/api/workouts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t ? { id: w.id, exerciseType: t.type, name: t.label, source: w.source, googleName: w.googleName } : { id: w.id, clear: true }) });
    onChanged();
  }
  async function saveDetail() {
    setSaving(true);
    try {
      await fetch("/api/workouts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, detail }) });
      onChanged();
    } finally { setSaving(false); }
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>Set type</span>
      <WorkoutTypePicker quickTypes={quickTypes} selected={w.exerciseType} onPick={relabel} onRevert={w.overridden ? () => relabel() : undefined} />
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>Detail</span>
      <WorkoutDetailForm value={detail} onChange={setDetail} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" disabled={saving} onClick={saveDetail}>{saving ? "Saving…" : "Save detail"}</button>
      </div>
    </div>
  );
}

function FoodEditor({ f, onSaved }: { f: FoodEntry; onSaved: () => void }) {
  const [s, setS] = useState({ name: f.name, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG });
  const [saving, setSaving] = useState(false);
  const num = (k: keyof typeof s, v: string) => setS({ ...s, [k]: v === "" ? 0 : Number(v) });
  async function save() {
    setSaving(true);
    try {
      await fetch("/api/food/log", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, ...s }) });
      onSaved();
    } finally { setSaving(false); }
  }
  const cell = { width: 64, padding: "7px 8px", textAlign: "center" as const };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <input className="field" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Labelled l="kcal"><input className="field" type="number" value={s.calories} onChange={(e) => num("calories", e.target.value)} style={cell} /></Labelled>
        <Labelled l="P"><input className="field" type="number" value={s.proteinG} onChange={(e) => num("proteinG", e.target.value)} style={cell} /></Labelled>
        <Labelled l="C"><input className="field" type="number" value={s.carbsG} onChange={(e) => num("carbsG", e.target.value)} style={cell} /></Labelled>
        <Labelled l="F"><input className="field" type="number" value={s.fatG} onChange={(e) => num("fatG", e.target.value)} style={cell} /></Labelled>
      </div>
      {f.syncedToHealth && <p style={{ fontSize: 11, color: "var(--ink-faint)" }}>Edits apply here only — the synced Google Health copy keeps its original values.</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></div>
    </div>
  );
}

function MeasurementEditor({ m, onSaved }: { m: Measurement; onSaved: () => void }) {
  const isSleep = m.kind === "sleep";
  const isBP = m.kind === "blood-pressure";
  const [value, setValue] = useState(String(isSleep ? m.value / 60 : m.value));
  const [value2, setValue2] = useState(String(m.value2 ?? ""));
  const [note, setNote] = useState(m.note ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    const v = Number(value), v2 = Number(value2);
    if (!Number.isFinite(v) || (isBP && (!Number.isFinite(v2) || value2 === ""))) return;
    setSaving(true);
    try {
      await fetch(`/api/measurements?id=${encodeURIComponent(m.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: isSleep ? Math.round(v * 60) : v, value2: isBP ? v2 : undefined, note: note.trim() || undefined }) });
      onSaved();
    } finally { setSaving(false); }
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="field" type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1 }} aria-label={isBP ? "systolic" : "value"} />
        {isBP && (<><span style={{ alignSelf: "center", color: "var(--ink-soft)" }}>/</span><input className="field" type="number" value={value2} onChange={(e) => setValue2(e.target.value)} style={{ flex: 1 }} aria-label="diastolic" /></>)}
        <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 13 }}>{isSleep ? "h" : m.unit}</span>
      </div>
      <input className="field" value={note} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></div>
    </div>
  );
}

function Labelled({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", textAlign: "center" }}>{l}</span>
      {children}
    </label>
  );
}
