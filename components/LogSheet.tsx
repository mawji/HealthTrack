"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconChip, habitIcon } from "./icons";
import { MeasurementKind } from "@/lib/types";

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
};

const METRICS: MetricCfg[] = [
  { kind: "weight", label: "Weight", icon: "scale", unit: "kg", units: ["kg", "lb"], step: "0.1", placeholders: { kg: "e.g. 80.6", lb: "e.g. 178" } },
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

  const close = () => {
    setOpen(false);
    setMetric(null);
  };

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
              <h2 style={{ fontSize: 17, fontWeight: 700 }}>{metric ? metric.label : "Log manually"}</h2>
              <button className="icon-btn" aria-label={metric ? "back" : "close"} onClick={metric ? () => setMetric(null) : close}>
                {metric ? "‹" : "✕"}
              </button>
            </div>

            {metric ? (
              <MetricForm metric={metric} onDone={close} />
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

function MenuItem({ icon, label, color, onClick }: { icon: string; label: string; color: string; onClick: () => void }) {
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
      <IconChip icon={habitIcon(icon)} color={color} size={24} />
      {label}
    </button>
  );
}

function MetricForm({ metric, onDone }: { metric: MetricCfg; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(metric.unit);
  const [context, setContext] = useState(metric.contexts?.[0]?.value ?? "");
  const [at, setAt] = useState(nowLocal());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const v = Number(value);
    if (!Number.isFinite(v) || value === "") return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        kind: metric.kind,
        value: metric.hoursToMinutes ? Math.round(v * 60) : v,
        unit: metric.hoursToMinutes ? "min" : unit,
        at: new Date(at).toISOString(),
        note: note.trim() || undefined,
      };
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
        <button className="btn" disabled={saving || value === ""} onClick={save}>
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
