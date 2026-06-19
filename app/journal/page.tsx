"use client";

import { useEffect, useState } from "react";
import { IconChip, habitIcon } from "@/components/icons";
import { Measurement, MeasurementKind } from "@/lib/types";

const KIND_LABEL: Record<MeasurementKind, string> = {
  weight: "Weight",
  glucose: "Glucose",
  "body-temp": "Body temperature",
  "body-fat": "Body fat",
  sleep: "Sleep",
  "muscle-mass": "Muscle mass",
  "blood-pressure": "Blood pressure",
};
const KIND_ICON: Record<MeasurementKind, string> = {
  weight: "scale",
  glucose: "water",
  "body-temp": "flame",
  "body-fat": "leaf",
  sleep: "moon",
  "muscle-mass": "dumbbell",
  "blood-pressure": "pulse",
};

function displayValue(m: Measurement): string {
  if (m.kind === "sleep") return `${(m.value / 60).toFixed(1)}h`;
  if (m.kind === "blood-pressure") return `${m.value}/${m.value2 ?? "—"} ${m.unit}`;
  return `${m.value} ${m.unit}`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** datetime-local value from an ISO string. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function JournalPage() {
  const [rows, setRows] = useState<Measurement[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () =>
    fetch("/api/measurements?limit=500")
      .then((r) => r.json())
      .then((d) => setRows(d.measurements ?? []))
      .catch(() => setRows([]));

  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/measurements?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Journal.</h1>
        <p className="page-sub">Everything you've logged by hand — weight, muscle mass, glucose, temperature, body fat, blood pressure, sleep.</p>
      </header>

      {!rows ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <section className="card">
          <p style={{ color: "var(--ink-soft)" }}>Nothing logged yet. Use the “+ Log” button up top to add a reading.</p>
        </section>
      ) : (
        <div className="stack">
          {rows.map((m) =>
            editing === m.id ? (
              <EditRow key={m.id} m={m} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
            ) : (
              <section key={m.id} className="card row" style={{ justifyContent: "space-between", gap: 12 }}>
                <div className="card-label" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14 }}>
                  <IconChip icon={habitIcon(KIND_ICON[m.kind])} color="var(--breath)" />
                  <span>
                    {KIND_LABEL[m.kind]}
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 400 }}>
                      {fmtWhen(m.at)}
                      {m.context ? ` · ${m.context.replace("_", " ")}` : ""}
                      {m.note ? ` · ${m.note}` : ""}
                    </span>
                  </span>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="display-num" style={{ fontSize: 18 }}>{displayValue(m)}</span>
                  <button className="icon-btn" aria-label="edit" onClick={() => setEditing(m.id)}>✎</button>
                  <button className="icon-btn" aria-label="delete" style={{ color: "var(--heart)" }} onClick={() => remove(m.id)}>✕</button>
                </div>
              </section>
            )
          )}
        </div>
      )}
    </main>
  );
}

function EditRow({ m, onClose, onSaved }: { m: Measurement; onClose: () => void; onSaved: () => void }) {
  const isSleep = m.kind === "sleep";
  const isBP = m.kind === "blood-pressure";
  const [value, setValue] = useState(String(isSleep ? m.value / 60 : m.value));
  const [value2, setValue2] = useState(String(m.value2 ?? ""));
  const [unit, setUnit] = useState(m.unit);
  const [at, setAt] = useState(toLocalInput(m.at));
  const [note, setNote] = useState(m.note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const v = Number(value);
    const v2 = Number(value2);
    if (!Number.isFinite(v) || (isBP && (!Number.isFinite(v2) || value2 === ""))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/measurements?id=${encodeURIComponent(m.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: isSleep ? Math.round(v * 60) : v,
          value2: isBP ? v2 : undefined,
          unit: isSleep ? "min" : unit.trim() || m.unit,
          at: new Date(at).toISOString(),
          note: note.trim() || undefined,
        }),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="card-label" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14 }}>
        <IconChip icon={habitIcon(KIND_ICON[m.kind])} color="var(--breath)" />
        {KIND_LABEL[m.kind]}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="field" type="number" inputMode="decimal" step={isBP ? "1" : "0.1"} value={value} onChange={(e) => setValue(e.target.value)} aria-label={isBP ? "systolic" : "value"} style={{ flex: 1 }} />
        {isBP ? (
          <>
            <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 13 }}>/</span>
            <input className="field" type="number" inputMode="decimal" step="1" value={value2} onChange={(e) => setValue2(e.target.value)} aria-label="diastolic" style={{ flex: 1 }} />
            <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 13 }}>{m.unit}</span>
          </>
        ) : isSleep ? (
          <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 13 }}>h</span>
        ) : (
          <input className="field" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="unit" style={{ width: 90 }} />
        )}
      </div>
      <input className="field" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      <input className="field" value={note} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}
