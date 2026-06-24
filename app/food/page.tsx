"use client";

import { useEffect, useRef, useState } from "react";
import { FoodAnalysis, FoodEntry, MealType, RemoteFoodEntry } from "@/lib/types";

const MEAL_OPTIONS: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "other", label: "Other" },
];

/** Sensible default meal for the current hour. */
function guessMealType(d: Date): MealType {
  const h = d.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "other";
}
import { IconChip, ForkIcon } from "@/components/icons";
import Toast from "@/components/Toast";

export default function Food() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);
  const [error, setError] = useState("");
  const [log, setLog] = useState<FoodEntry[]>([]);
  const [remote, setRemote] = useState<RemoteFoodEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<FoodEntry>>({});
  const [meal, setMeal] = useState<MealType>("other");
  const [logDate, setLogDate] = useState("");
  const [logTime, setLogTime] = useState("");
  const [note, setNote] = useState("");
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const loadLog = () =>
    fetch("/api/food/log")
      .then((r) => r.json())
      .then((j) => {
        setLog(j.local ?? []);
        setRemote(j.remote ?? []);
      })
      .catch(() => {});
  useEffect(() => {
    loadLog();
  }, []);

  async function onFile(f: File) {
    setError("");
    setAnalysis(null);
    // Downscale to keep the vision request small. Hold the photo so the user
    // can add context before we analyze it; any text already typed carries over.
    const dataUrl = await downscale(f, 1024);
    setPreview(dataUrl);
  }

  async function analyze() {
    if (!preview && !note.trim()) return;
    setError("");
    setAnalysis(null);
    setAnalyzing(true);
    try {
      const res = await fetch("/api/food/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview ?? undefined, note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      const fellBackTo = res.headers.get("X-AI-Fallback");
      if (fellBackTo) setFallbackNote(`Primary model unavailable — using ${fellBackTo}.`);
      setAnalysis(json);
      const now = new Date();
      setMeal(guessMealType(now));
      setLogDate(localDayKey(now.toISOString()));
      setLogTime(now.toTimeString().slice(0, 5));
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveEntry() {
    if (!analysis) return;
    setSaving(true);
    try {
      // Keep a small thumbnail of the photo with the entry.
      const photo = preview ? await downscaleDataUrl(preview, 160) : undefined;
      const picked = new Date(`${logDate}T${logTime || "12:00"}`);
      const loggedAt = (isNaN(picked.getTime()) ? new Date() : picked).toISOString();
      await fetch("/api/food/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...analysis, photo, mealType: meal, loggedAt }),
      });
      setAnalysis(null);
      setPreview(null);
      setNote("");
      await loadLog();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    await fetch("/api/food/log", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, ...edit }),
    });
    setEditId(null);
    await loadLog();
  }

  async function remove(id: string) {
    await fetch(`/api/food/log?id=${id}`, { method: "DELETE" });
    await loadLog();
  }

  // Local + remote meals interleaved, grouped by local calendar day, newest first.
  type MealItem = { at: string; local?: FoodEntry; remote?: RemoteFoodEntry };
  const items: MealItem[] = [
    ...log.map((f) => ({ at: f.loggedAt, local: f })),
    ...remote.map((f) => ({ at: f.at, remote: f })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const groups = new Map<string, MealItem[]>();
  for (const it of items) {
    const key = localDayKey(it.at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  const todayKey = localDayKey(new Date().toISOString());
  const todayCal = (groups.get(todayKey) ?? []).reduce(
    (s, it) => s + (it.local?.calories ?? it.remote?.calories ?? 0),
    0
  );

  return (
    <main className="page">
      <Toast message={fallbackNote} onDone={() => setFallbackNote(null)} tone="warn" />
      <header className="rise rise-1" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Food.</h1>
        <p className="page-sub">
          Photograph a meal — AI estimates calories, macros and glycemic load, then logs it back to Google Health.
        </p>
      </header>

      <div className="stack desk-grid">
      <section className="card rise rise-2" style={{ textAlign: "center", alignSelf: "start" }}>
        {preview ? (
          <img src={preview} alt="meal" style={{ width: "100%", borderRadius: 14, maxHeight: 280, objectFit: "cover" }} />
        ) : (
          <div
            style={{
              border: "1.5px dashed var(--food)",
              borderRadius: 16,
              padding: "34px 20px",
              background: "var(--food-soft)",
            }}
          >
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="var(--food)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
              <path d="M4 8h3l2-3h6l2 3h3v12H4z" />
              <circle cx="12" cy="13.5" r="3.5" />
            </svg>
            <p style={{ fontWeight: 600, color: "var(--food)" }}>Add a food photo</p>
            <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: "center" }}>
              <button className="btn" style={{ background: "var(--food)", padding: "10px 18px", fontSize: 13.5 }} onClick={() => cameraRef.current?.click()}>
                Camera
              </button>
              <button className="btn btn-ghost" style={{ padding: "10px 18px", fontSize: 13.5 }} onClick={() => galleryRef.current?.click()}>
                Gallery
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "18px 0 10px" }}>
              or describe it
            </p>
            <textarea
              className="field"
              value={note}
              rows={2}
              placeholder="e.g. two scrambled eggs on toast with butter"
              style={{ textAlign: "left", resize: "vertical", minHeight: 56 }}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn"
              style={{ width: "100%", marginTop: 10, background: "var(--food)", opacity: note.trim() ? 1 : 0.5 }}
              disabled={!note.trim()}
              onClick={analyze}
            >
              Analyze description
            </button>
          </div>
        )}
        {/* capture opens the camera on phones; the plain input opens the gallery/picker */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />

        {preview && !analysis && !analyzing && (
          <div style={{ marginTop: 14, textAlign: "left" }}>
            <label>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Add context (optional)
              </span>
              <textarea
                className="field"
                value={note}
                rows={2}
                placeholder="e.g. chicken biryani, ~300g, cooked in ghee"
                style={{ marginTop: 3, resize: "vertical", minHeight: 56 }}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 4 }}>
              Name, ingredients or portion size help the AI estimate more accurately.
            </p>
            <button className="btn" style={{ width: "100%", marginTop: 10, background: "var(--food)" }} onClick={analyze}>
              Analyze
            </button>
          </div>
        )}

        {analyzing && <p className="pulsing" style={{ marginTop: 14, color: "var(--food)", fontWeight: 600 }}>Reading your plate…</p>}
        {error && <p style={{ marginTop: 12, color: "var(--heart)", fontSize: 13.5 }}>{error}</p>}

        {analysis && (
          <div style={{ marginTop: 16, textAlign: "left" }}>
            <input
              className="field"
              value={analysis.name}
              onChange={(e) => setAnalysis({ ...analysis, name: e.target.value })}
            />
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <MacroInput label="kcal" value={analysis.calories} onChange={(v) => setAnalysis({ ...analysis, calories: v })} />
              <MacroInput label="protein" value={analysis.proteinG} onChange={(v) => setAnalysis({ ...analysis, proteinG: v })} />
              <MacroInput label="carbs" value={analysis.carbsG} onChange={(v) => setAnalysis({ ...analysis, carbsG: v })} />
              <MacroInput label="fat" value={analysis.fatG} onChange={(v) => setAnalysis({ ...analysis, fatG: v })} />
              <MacroInput label="GL" value={analysis.glycemicLoad ?? 0} onChange={(v) => setAnalysis({ ...analysis, glycemicLoad: v })} />
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <PickerField label="Meal">
                <select className="field" value={meal} style={{ padding: "8px 10px", marginTop: 3 }} onChange={(e) => setMeal(e.target.value as MealType)}>
                  {MEAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </PickerField>
              <PickerField label="Date">
                <input className="field" type="date" value={logDate} style={{ padding: "8px 10px", marginTop: 3 }} onChange={(e) => setLogDate(e.target.value)} />
              </PickerField>
              <PickerField label="Time">
                <input className="field" type="time" value={logTime} style={{ padding: "8px 10px", marginTop: 3 }} onChange={(e) => setLogTime(e.target.value)} />
              </PickerField>
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>
              {analysis.notes} <em>({analysis.confidence} confidence — adjust if needed)</em>
            </p>
            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <button className="btn" style={{ flex: 1, background: "var(--food)" }} onClick={saveEntry} disabled={saving}>
                {saving ? "Logging…" : "Log meal"}
              </button>
              <button className="btn btn-ghost" onClick={() => { setAnalysis(null); setPreview(null); setNote(""); }}>
                Discard
              </button>
            </div>
          </div>
        )}
        {preview && !analysis && !analyzing && (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => { setPreview(null); setError(""); setNote(""); }}>
            Try another photo
          </button>
        )}
      </section>

      <section className="rise rise-3">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 560 }}>Logged meals</h2>
          <span className="badge" style={{ background: "var(--food-soft)", color: "var(--food)" }}>
            today {todayCal.toLocaleString()} kcal
          </span>
        </div>
        {items.length === 0 ? (
          <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>Nothing logged yet.</p>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {[...groups.entries()].map(([day, dayItems], gi) => (
              <DayGroup key={day} label={dayLabel(day, todayKey)} totals={dayTotals(dayItems)} count={dayItems.length} defaultOpen={gi === 0}>
                <div className="stack" style={{ gap: 8 }}>
                  {dayItems.map((it, i) =>
                    it.local ? (
                      <LocalMealCard
                        key={it.local.id}
                        f={it.local}
                        editing={editId === it.local.id}
                        edit={edit}
                        setEdit={setEdit}
                        onToggleEdit={() => {
                          const f = it.local!;
                          setEditId(editId === f.id ? null : f.id);
                          setEdit({ name: f.name, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, glycemicLoad: f.glycemicLoad ?? 0, mealType: f.mealType ?? "other" });
                        }}
                        onSave={saveEdit}
                        onCancel={() => setEditId(null)}
                        onDelete={() => remove(it.local!.id)}
                      />
                    ) : (
                      <RemoteMealCard key={`r-${day}-${i}`} f={it.remote!} />
                    )
                  )}
                </div>
              </DayGroup>
            ))}
            <p style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
              Glycemic load is AI-estimated — from the photo for meals logged here, and from name + macros for meals synced from Google Health (marked &quot;est.&quot;).
            </p>
          </div>
        )}
      </section>
      </div>
    </main>
  );
}

/** yyyy-MM-dd in the browser's local timezone. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(day: string, todayKey: string): string {
  if (day === todayKey) return "Today";
  const d = new Date(day + "T12:00:00");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDayKey(yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function dayTotals(items: { local?: FoodEntry; remote?: RemoteFoodEntry }[]) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, gl: 0, glKnown: false };
  for (const it of items) {
    const m = it.local ?? it.remote!;
    t.kcal += m.calories;
    t.p += (it.local ? it.local.proteinG : it.remote?.proteinG) ?? 0;
    t.c += (it.local ? it.local.carbsG : it.remote?.carbsG) ?? 0;
    t.f += (it.local ? it.local.fatG : it.remote?.fatG) ?? 0;
    const gl = it.local ? it.local.glycemicLoad : it.remote?.glycemicLoad;
    if (gl != null) {
      t.gl += gl;
      t.glKnown = true;
    }
  }
  return t;
}

function DayGroup({
  label,
  totals: t,
  count,
  defaultOpen,
  children,
}: {
  label: string;
  totals: ReturnType<typeof dayTotals>;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "0 2px",
          marginBottom: 6,
          gap: 10,
          flexWrap: "wrap",
          textAlign: "left",
        }}
      >
        <span className="row" style={{ gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 600, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          <svg
            viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease", flex: "none" }}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          {label}
          {!open && <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-soft)" }}>({count})</span>}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
          <strong style={{ color: "var(--food)" }}>{t.kcal.toLocaleString()} kcal</strong>
          {" · "}P {t.p}g · C {t.c}g · F {t.f}g · GL {t.glKnown ? t.gl : "—"}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function LocalMealCard({
  f,
  editing,
  edit,
  setEdit,
  onToggleEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  f: FoodEntry;
  editing: boolean;
  edit: Partial<FoodEntry>;
  setEdit: (e: Partial<FoodEntry>) => void;
  onToggleEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          {f.photo ? (
            <img src={f.photo} alt={f.name} style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover", flex: "none" }} />
          ) : (
            <IconChip icon={ForkIcon} color="var(--food)" size={28} />
          )}
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 14.5 }}>{f.name}</strong>
            <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
              {new Date(f.loggedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              {f.mealType && f.mealType !== "other" && ` · ${f.mealType}`}
              {" · "}P{f.proteinG} C{f.carbsG} F{f.fatG}
              {f.glycemicLoad != null && ` · GL ${f.glycemicLoad}`}
              {f.syncedToHealth && " · ✓ synced"}
            </p>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flex: "none" }}>
          <span className="display-num" style={{ fontSize: 18, color: "var(--food)" }}>{f.calories}</span>
          <button onClick={onToggleEdit} style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13 }} aria-label="edit">
            ✎
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", padding: 2, display: "flex" }}
            aria-label="delete"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      </div>
      {confirmingDelete && (
        <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "var(--heart-soft, rgba(220,70,70,0.08))", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>Delete this meal? This can&apos;t be undone.</span>
          <div className="row" style={{ gap: 8, flex: "none" }}>
            <button
              className="btn"
              style={{ background: "var(--heart)", padding: "7px 16px", fontSize: 13 }}
              onClick={() => { setConfirmingDelete(false); onDelete(); }}
            >
              Delete
            </button>
            <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {editing && (
        <div style={{ marginTop: 10 }}>
          <input className="field" value={String(edit.name ?? "")} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <select className="field" value={edit.mealType ?? "other"} style={{ marginTop: 8 }} onChange={(e) => setEdit({ ...edit, mealType: e.target.value as MealType })}>
            {MEAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <MacroInput label="kcal" value={Number(edit.calories ?? 0)} onChange={(v) => setEdit({ ...edit, calories: v })} />
            <MacroInput label="protein" value={Number(edit.proteinG ?? 0)} onChange={(v) => setEdit({ ...edit, proteinG: v })} />
            <MacroInput label="carbs" value={Number(edit.carbsG ?? 0)} onChange={(v) => setEdit({ ...edit, carbsG: v })} />
            <MacroInput label="fat" value={Number(edit.fatG ?? 0)} onChange={(v) => setEdit({ ...edit, fatG: v })} />
            <MacroInput label="GL" value={Number(edit.glycemicLoad ?? 0)} onChange={(v) => setEdit({ ...edit, glycemicLoad: v })} />
          </div>
          {f.syncedToHealth && (
            <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6 }}>
              Edits apply here only — Google Health keeps the originally synced values (anonymous food logs are immutable).
            </p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn" style={{ background: "var(--food)", padding: "9px 18px", fontSize: 13 }} onClick={onSave}>
              Save
            </button>
            <button className="btn btn-ghost" style={{ padding: "9px 14px", fontSize: 13 }} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteMealCard({ f }: { f: RemoteFoodEntry }) {
  const macros = [
    f.proteinG != null ? `P${f.proteinG}` : null,
    f.carbsG != null ? `C${f.carbsG}` : null,
    f.fatG != null ? `F${f.fatG}` : null,
  ].filter(Boolean);
  return (
    <div className="card row" style={{ padding: "11px 16px", justifyContent: "space-between", gap: 10 }}>
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <IconChip icon={ForkIcon} color="var(--breath)" size={28} />
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>{f.name}</strong>
          <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
            {new Date(f.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            {f.mealType && f.mealType !== "MEAL_TYPE_UNSPECIFIED" ? ` · ${f.mealType.toLowerCase().replace(/_/g, " ")}` : ""}
            {macros.length > 0 && ` · ${macros.join(" ")}`}
            {f.glycemicLoad != null && ` · GL ${f.glycemicLoad} (est.)`}
            {" · Google Health"}
          </p>
        </div>
      </div>
      <span className="display-num" style={{ fontSize: 17, color: "var(--breath)", flex: "none" }}>{f.calories}</span>
    </div>
  );
}

function PickerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      {children}
    </label>
  );
}

function MacroInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ flex: 1 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <input
        className="field"
        type="number"
        value={value}
        style={{ padding: "8px 10px", marginTop: 3 }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

async function downscaleDataUrl(dataUrl: string, maxDim: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return downscale(blob, maxDim);
}

async function downscale(file: Blob, maxDim: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
