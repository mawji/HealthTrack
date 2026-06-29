"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconChip, habitIcon } from "./icons";
import { MeasurementKind, MedicationsPayload, MedicationDayStatus, HabitsPayload, HabitDefinition } from "@/lib/types";

const PillIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-40 12 12)" />
    <path d="M8.6 8.4l7 7" />
  </svg>
);

// Items that route to an existing logging flow.
const FLOWS: { key: string; label: string; icon: string; href: string }[] = [
  { key: "activity", label: "Activity", icon: "walk", href: "/fitness" },
  { key: "food", label: "Food", icon: "fork", href: "/food" },
  { key: "hydration", label: "Hydration", icon: "water", href: "/" },
];

// Items logged with a simple inline form → /api/measurements.
type MetricCfg = {
  kind: MeasurementKind;
  label: string;
  icon: string;
  unit: string;
  units?: string[];
  contexts?: { value: string; label: string }[];
  step?: string;
  placeholder?: string;
  placeholders?: Record<string, string>; // per-unit hint, so e.g. mg/dL vs mmol/L differ
  hoursToMinutes?: boolean; // sleep is entered in hours, stored in minutes
  dual?: { label1: string; label2: string; ph1?: string; ph2?: string }; // blood pressure: value (systolic) + value2 (diastolic)
};

const METRICS: MetricCfg[] = [
  { kind: "weight", label: "Weight", icon: "scale", unit: "kg", units: ["kg", "lb"], step: "0.1", placeholders: { kg: "e.g. 80.6", lb: "e.g. 178" } },
  { kind: "muscle-mass", label: "Muscle mass", icon: "dumbbell", unit: "kg", units: ["kg", "lb"], step: "0.1", placeholders: { kg: "e.g. 34.5", lb: "e.g. 76" } },
  {
    kind: "blood-pressure",
    label: "Blood pressure",
    icon: "pulse",
    unit: "mmHg",
    step: "1",
    dual: { label1: "Systolic", label2: "Diastolic", ph1: "e.g. 120", ph2: "e.g. 80" },
  },
  {
    kind: "glucose",
    label: "Glucose",
    icon: "water",
    unit: "mmol/L",
    units: ["mmol/L", "mg/dL"],
    step: "0.1",
    placeholders: { "mmol/L": "e.g. 5.4", "mg/dL": "e.g. 97" },
    contexts: [
      { value: "fasting", label: "Fasting" },
      { value: "pre_meal", label: "Before meal" },
      { value: "post_meal", label: "After meal" },
      { value: "random", label: "Random" },
    ],
  },
  { kind: "body-temp", label: "Temperature", icon: "flame", unit: "°C", units: ["°C", "°F"], step: "0.1", placeholders: { "°C": "e.g. 36.8", "°F": "e.g. 98.4" } },
  { kind: "body-fat", label: "Body fat", icon: "leaf", unit: "%", step: "0.1", placeholder: "e.g. 18.5" },
  { kind: "sleep", label: "Sleep", icon: "moon", unit: "h", step: "0.1", placeholder: "e.g. 7.5", hoursToMinutes: true },
];

/** Local datetime string (yyyy-MM-ddTHH:mm) for a datetime-local input default. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Global "+ Log" quick-entry: a popup menu under the button on desktop, a
 *  bottom sheet on mobile (see .logsheet-* in globals.css). */
export default function LogMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<MetricCfg | null>(null);
  const [panel, setPanel] = useState<"meds" | "habits" | null>(null);

  const close = () => {
    setOpen(false);
    setMetric(null);
    setPanel(null);
  };
  const back = () => {
    setMetric(null);
    setPanel(null);
  };
  const inView = metric || panel;
  const title = metric ? metric.label : panel === "meds" ? "Medications" : panel === "habits" ? "Habits" : "Log manually";

  return (
    <div style={{ flex: "none" }}>
      {/* Floating action button — circle on mobile, pill with "Log" label on desktop. */}
      <button
        className="log-fab"
        aria-label="log manually"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden style={{ lineHeight: 1 }}>+</span>
        <span className="log-fab-label">Log</span>
      </button>

      {open && (
        <>
          <div className="logsheet-scrim" onClick={close} />
          <div className="card logsheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
              <button className="icon-btn" aria-label={inView ? "back" : "close"} onClick={inView ? back : close}>
                {inView ? "‹" : "✕"}
              </button>
            </div>

            {metric ? (
              <MetricForm metric={metric} onDone={close} />
            ) : panel === "meds" ? (
              <MedsLogPanel />
            ) : panel === "habits" ? (
              <HabitsLogPanel />
            ) : (
              <div className="grid-2" style={{ gap: 10 }}>
                {FLOWS.map((f) => (
                  <MenuItem
                    key={f.key}
                    icon={f.icon}
                    label={f.label}
                    color="var(--activity)"
                    onClick={() => {
                      close();
                      router.push(f.href);
                    }}
                  />
                ))}
                <MenuItem iconNode={PillIcon} label="Medication" color="var(--heart)" onClick={() => setPanel("meds")} />
                <MenuItem icon="check" label="Habits" color="var(--activity)" onClick={() => setPanel("habits")} />
                {METRICS.map((m) => (
                  <MenuItem key={m.kind} icon={m.icon} label={m.label} color="var(--breath)" onClick={() => setMetric(m)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon, iconNode, label, color, onClick }: { icon?: string; iconNode?: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "11px 12px",
        borderRadius: 12,
        background: "var(--bg-inset)",
        border: "1px solid var(--hairline)",
        cursor: "pointer",
        color: "var(--ink)",
        textAlign: "left",
        fontWeight: 600,
        fontSize: 13.5,
      }}
    >
      <IconChip icon={iconNode ?? habitIcon(icon ?? "check")} color={color} size={24} />
      {label}
    </button>
  );
}

// ── Medication quick-log: all today's meds, next due highlighted ───────────

function MedsLogPanel() {
  const [payload, setPayload] = useState<MedicationsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => fetch("/api/medications").then((r) => r.json()).then(setPayload).catch(() => {});
  useEffect(() => { load(); }, []);

  async function record(medId: string, doseIndex: number, status: "taken" | "skipped" | null) {
    setBusy(medId + ":" + doseIndex);
    try {
      await fetch("/api/medications/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicationId: medId, doseIndex, status }),
      });
      try { window.dispatchEvent(new Event("ht-meds-changed")); } catch {}
      await load();
    } finally {
      setBusy(null);
    }
  }

  const statusFor = (id: string): MedicationDayStatus | undefined => payload?.status.find((s) => s.medicationId === id);
  const meds = (payload?.medications ?? []).filter((m) => m.active);
  const shown = meds.filter((m) => { const s = statusFor(m.id); return s?.scheduledToday || s?.asNeeded; });

  // The single "next due" dose to emphasize: earliest overdue, else earliest upcoming.
  const pending: { key: string; time: string; overdue: boolean }[] = [];
  for (const m of shown) {
    const s = statusFor(m.id);
    if (!s || s.asNeeded) continue;
    for (const d of s.doses) if (d.status == null && d.time) pending.push({ key: m.id + ":" + d.doseIndex, time: d.time, overdue: d.overdue });
  }
  pending.sort((a, b) => a.time.localeCompare(b.time));
  const nextKey = (pending.find((p) => p.overdue) ?? pending[0])?.key ?? null;

  if (!payload) return <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>Loading…</p>;
  if (shown.length === 0) {
    return <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>No medications scheduled today.</p>;
  }

  return (
    <div className="stack" style={{ gap: 10, maxHeight: "52vh", overflowY: "auto" }}>
      {shown.map((m) => {
        const s = statusFor(m.id);
        return (
          <div key={m.id} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--bg-inset)", border: "1px solid var(--hairline)" }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                {m.name}
                {m.critical && <span style={{ color: "var(--heart)", fontSize: 11, marginLeft: 6 }}>• critical</span>}
              </span>
              {s?.asNeeded ? (
                <button className="btn btn-ghost" disabled={busy != null} style={{ padding: "5px 10px", fontSize: 12.5 }} onClick={() => record(m.id, Date.now() % 100000, "taken")}>
                  + Log dose {s.takenCount ? `(${s.takenCount})` : ""}
                </button>
              ) : null}
            </div>
            {!s?.asNeeded && (
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {(s?.doses ?? []).map((d) => {
                  const key = m.id + ":" + d.doseIndex;
                  const taken = d.status === "taken";
                  const isNext = key === nextKey;
                  return (
                    <button
                      key={d.doseIndex}
                      disabled={busy != null}
                      onClick={() => record(m.id, d.doseIndex, taken ? null : "taken")}
                      title={taken ? "Taken — tap to clear" : "Mark taken"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px",
                        borderRadius: 999,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        background: taken ? "var(--activity)" : "transparent",
                        color: taken ? "var(--bg)" : d.overdue ? "var(--heart)" : "var(--ink)",
                        border: `1px solid ${taken ? "var(--activity)" : d.overdue ? "var(--heart)" : "var(--hairline)"}`,
                        boxShadow: isNext && !taken ? "0 0 0 2px color-mix(in srgb, var(--heart) 35%, transparent)" : undefined,
                      }}
                    >
                      {taken ? "✓ " : ""}{d.time ?? "dose"}
                      {isNext && !taken ? <span style={{ fontSize: 10, opacity: 0.85 }}>· next</span> : d.status === "skipped" ? <span style={{ fontSize: 10, opacity: 0.7 }}>· skipped</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Habit quick-log: all active habits with their control ──────────────────

function HabitsLogPanel() {
  const [payload, setPayload] = useState<HabitsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => fetch("/api/habits").then((r) => r.json()).then(setPayload).catch(() => {});
  useEffect(() => { load(); }, []);

  async function log(habitId: string, value: boolean | number | null) {
    if (!payload) return;
    setBusy(habitId);
    try {
      await fetch("/api/habits/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId, date: payload.date, value }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const habits = (payload?.habits ?? []).filter((h) => h.active);
  const valueFor = (id: string): boolean | number | null => payload?.status.find((s) => s.habitId === id)?.value ?? null;

  if (!payload) return <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>Loading…</p>;
  if (habits.length === 0) {
    return <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>No habits yet.</p>;
  }

  return (
    <div className="stack" style={{ gap: 10, maxHeight: "52vh", overflowY: "auto" }}>
      {habits.map((h) => (
        <div key={h.id} className="row" style={{ justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 12, background: "var(--bg-inset)", border: "1px solid var(--hairline)", opacity: busy === h.id ? 0.6 : 1 }}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <IconChip icon={habitIcon(h.iconKey)} color={h.color ?? "var(--activity)"} size={22} />
            <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
          </div>
          <HabitQuickControl habit={h} value={valueFor(h.id)} busy={busy === h.id} onLog={(v) => log(h.id, v)} />
        </div>
      ))}
    </div>
  );
}

/** Compact per-type control for the quick-log sheet (mirrors the Habits page). */
function HabitQuickControl({ habit, value, busy, onLog }: { habit: HabitDefinition; value: boolean | number | null; busy: boolean; onLog: (v: boolean | number | null) => void }) {
  const color = habit.color ?? "var(--activity)";
  const pill = (active: boolean, activeBg: string): React.CSSProperties => ({
    padding: "6px 11px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${active ? activeBg : "var(--hairline)"}`,
    background: active ? activeBg : "transparent",
    color: active ? "var(--bg)" : "var(--ink)",
    flex: "none",
  });

  if (habit.targetType === "yes_no") {
    if (habit.kind === "avoid") {
      const nailed = value === false;
      const slipped = value === true;
      return (
        <div className="row" style={{ gap: 6 }}>
          <button disabled={busy} onClick={() => onLog(nailed ? null : false)} style={pill(nailed, "var(--activity)")}>✓</button>
          <button disabled={busy} onClick={() => onLog(slipped ? null : true)} style={pill(slipped, "var(--heart)")}>✗</button>
        </div>
      );
    }
    const done = value === true;
    return (
      <button disabled={busy} onClick={() => onLog(done ? null : true)} style={pill(done, color)}>
        {done ? "✓ Done" : "Mark done"}
      </button>
    );
  }

  const current = typeof value === "number" ? value : 0;
  const step = habit.defaultValue && habit.defaultValue > 0 ? habit.defaultValue : 1;

  if (habit.targetType === "duration") {
    return (
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <span className="display-num" style={{ fontSize: 16, color }}>{current}</span>
        <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{habit.unit ?? "min"}</span>
        {[5, 10, 30].map((q) => (
          <button key={q} disabled={busy} onClick={() => onLog(current + q)} style={pill(false, color)}>+{q}</button>
        ))}
        {current > 0 && <button disabled={busy} onClick={() => onLog(null)} style={pill(false, color)}>↺</button>}
      </div>
    );
  }

  // count / quantity → −/+ stepper
  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <button disabled={busy || current <= 0} onClick={() => onLog(Math.max(0, current - step) || null)} style={{ ...pill(false, color), opacity: current <= 0 ? 0.4 : 1 }}>−</button>
      <span className="display-num" style={{ fontSize: 16, color, minWidth: 22, textAlign: "center" }}>{current}</span>
      <button disabled={busy} onClick={() => onLog(current + step)} style={pill(true, color)}>+</button>
    </div>
  );
}

function MetricForm({ metric, onDone }: { metric: MetricCfg; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [unit, setUnit] = useState(metric.unit);
  const [context, setContext] = useState(metric.contexts?.[0]?.value ?? "");
  const [at, setAt] = useState(nowLocal());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const v = Number(value);
  const v2 = Number(value2);
  const valid = Number.isFinite(v) && value !== "" && (!metric.dual || (Number.isFinite(v2) && value2 !== ""));

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        kind: metric.kind,
        value: metric.hoursToMinutes ? Math.round(v * 60) : v,
        unit: metric.hoursToMinutes ? "min" : unit,
        at: new Date(at).toISOString(),
        note: note.trim() || undefined,
      };
      if (metric.dual) body.value2 = v2;
      if (metric.contexts) body.context = context;
      const res = await fetch("/api/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {metric.dual ? (
        <div className="row" style={{ gap: 10 }}>
          <Field label={metric.dual.label1}>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="field"
                type="number"
                inputMode="decimal"
                step={metric.step ?? "any"}
                value={value}
                autoFocus
                placeholder={metric.dual.ph1}
                onChange={(e) => setValue(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 14 }}>{metric.unit}</span>
            </div>
          </Field>
          <Field label={metric.dual.label2}>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="field"
                type="number"
                inputMode="decimal"
                step={metric.step ?? "any"}
                value={value2}
                placeholder={metric.dual.ph2}
                onChange={(e) => setValue2(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 14 }}>{metric.unit}</span>
            </div>
          </Field>
        </div>
      ) : (
        <Field label="Value">
          <div className="row" style={{ gap: 8 }}>
            <input
              className="field"
              type="number"
              inputMode="decimal"
              step={metric.step ?? "any"}
              value={value}
              autoFocus
              placeholder={metric.placeholders?.[unit] ?? metric.placeholder}
              onChange={(e) => setValue(e.target.value)}
              style={{ flex: 1 }}
            />
            {metric.units ? (
              <select className="field" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 100 }}>
                {metric.units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ alignSelf: "center", color: "var(--ink-soft)", fontSize: 14 }}>{metric.unit}</span>
            )}
          </div>
        </Field>
      )}

      {metric.contexts && (
        <Field label="When">
          <select className="field" value={context} onChange={(e) => setContext(e.target.value)}>
            {metric.contexts.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Time">
        <input className="field" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>

      <Field label="Note (optional)">
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
        <button className="btn" disabled={saving || !valid} onClick={save}>
          {saving ? "Saving…" : "Log"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
