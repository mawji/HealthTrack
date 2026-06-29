"use client";

import { useEffect, useRef, useState } from "react";
import {
  MedicationDefinition,
  MedicationDayStatus,
  MedicationsPayload,
  MedicationKind,
  MedicationFrequency,
  MedicationInfo,
  MedicationSettings,
} from "@/lib/types";
import PillOrganizer, { WeekDay } from "@/components/PillOrganizer";
import { medDayState, STATE_COLOR, CellState, suggestNickname, NICKNAME_SUGGESTIONS, daysOfSupply, strengthsLabel, componentsLabel } from "@/lib/medication-display";

interface LowStock {
  id: string;
  name: string;
  units: number;
  daysRemaining: number | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEAD_CHOICES = [0, 5, 10, 15, 30, 60]; // minutes before the dose

interface WeekData {
  today: string;
  days: WeekDay[];
}

function amountLabel(m: MedicationDefinition): string {
  const parts: string[] = [];
  if (m.quantity != null) parts.push(`${m.quantity}${m.unit ? " " + m.unit : ""}`);
  else if (m.unit) parts.push(m.unit);
  const s = strengthsLabel(m);
  if (s) parts.push(`(${s})`);
  return parts.join(" ").trim();
}

function scheduleText(m: MedicationDefinition): string {
  const s = m.schedule;
  if (s.frequency === "as_needed") return "As needed";
  const times = s.times.length ? ` · ${s.times.join(", ")}` : "";
  if (s.frequency === "specific_days") {
    const days = (s.daysOfWeek ?? []).map((d) => DAY_NAMES[d]).join(", ") || "Some days";
    return `${days}${times}`;
  }
  return `Daily${times}`;
}

export default function MedicationsPage() {
  const [payload, setPayload] = useState<MedicationsPayload | null>(null);
  const [week, setWeek] = useState<WeekData | null>(null);
  const [low, setLow] = useState<{ enabled: boolean; lowStock: LowStock[] }>({ enabled: true, lowStock: [] });
  const [editing, setEditing] = useState<MedicationDefinition | "new" | null>(null);
  const [info, setInfo] = useState<MedicationDefinition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const date = payload?.date;

  const load = () =>
    Promise.all([
      fetch("/api/medications").then((r) => r.json()).then(setPayload),
      fetch("/api/medications/week?week=current").then((r) => r.json()).then(setWeek),
      fetch("/api/medications/inventory").then((r) => r.json()).then(setLow),
    ])
      // Let the nav badge + Daily widgets re-sync after any change here.
      .then(() => { try { window.dispatchEvent(new Event("ht-meds-changed")); } catch {} })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const statusFor = (id: string): MedicationDayStatus | undefined =>
    payload?.status.find((s) => s.medicationId === id);

  async function post(body: object) {
    await fetch("/api/medications/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function setDose(med: MedicationDefinition, doseIndex: number, status: "taken" | "skipped" | null) {
    if (!date) return;
    setBusy(med.id);
    try {
      await post({ medicationId: med.id, date, doseIndex, status });
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Record a specific dose from the pill-box organizer (today only).
  async function recordDose(medId: string, doseIndex: number, d: string, status: "taken" | "skipped" | null) {
    setBusy(medId);
    try {
      await post({ medicationId: medId, date: d, doseIndex, status });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function addSupply(medId: string, units: number) {
    setBusy(medId);
    try {
      await fetch("/api/medications/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: medId, addUnits: units }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function setSupply(medId: string, units: number | null) {
    setBusy(medId);
    try {
      await fetch("/api/medications/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(units == null ? { id: medId, track: false } : { id: medId, setUnits: units }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const meds = payload?.medications ?? [];
  const active = meds.filter((m) => m.active);
  const archived = meds.filter((m) => !m.active);

  // Per-med weekly states (option 3 strip), keyed by med id.
  const weekStatesFor = (id: string): { date: string; state: CellState }[] =>
    (week?.days ?? []).map((d) => ({
      date: d.date,
      state: medDayState(d.status.find((s) => s.medicationId === id), d.date, week!.today),
    }));

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Medications.</h1>
        <p className="page-sub">Track your meds & supplements, never miss a critical dose.</p>
      </header>

      {low.enabled && low.lowStock.length > 0 && (
        <section
          className="rise rise-1"
          style={{
            border: "1px solid color-mix(in srgb, var(--heart) 45%, transparent)",
            background: "color-mix(in srgb, var(--heart) 9%, var(--bg-raised))",
            borderRadius: 16,
            padding: "12px 14px",
            marginBottom: 14,
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span aria-hidden style={{ fontSize: 15 }}>📦</span>
            <span style={{ fontWeight: 700, color: "var(--heart)" }}>
              {low.lowStock.length === 1 ? "A medication is running low" : `${low.lowStock.length} medications are running low`}
            </span>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {low.lowStock.map((m) => (
              <div key={m.id} className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{m.name}</span>
                <span style={{ color: "var(--ink-soft)" }}>
                  {m.units} left{m.daysRemaining != null ? ` · ~${Math.round(m.daysRemaining)} day${Math.round(m.daysRemaining) === 1 ? "" : "s"}` : ""}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>Tap “Add supply” on the medication below when you restock.</p>
        </section>
      )}

      {active.length > 0 && week && (
        <section className="card rise rise-1" style={{ marginBottom: 14 }}>
          <div className="card-label" style={{ marginBottom: 14 }}>
            <span aria-hidden style={pillChip}><PillSvg /></span>
            This week’s pill box
          </div>
          <PillOrganizer days={week.days} today={week.today} meds={active} onRecord={recordDose} busy={busy != null} />
        </section>
      )}

      <MedReminderSettings />

      <div className="row" style={{ justifyContent: "flex-end", margin: "14px 0" }}>
        <button className="btn" onClick={() => setEditing("new")}>
          + Add medication
        </button>
      </div>

      {!payload ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : active.length === 0 ? (
        <section className="card">
          <p style={{ color: "var(--ink-soft)" }}>
            No medications yet. Add the meds and supplements you take to track adherence and get reminders.
          </p>
        </section>
      ) : (
        <div className="stack">
          {active.map((m) => (
            <MedRow
              key={m.id}
              med={m}
              status={statusFor(m.id)}
              weekStates={weekStatesFor(m.id)}
              today={week?.today ?? ""}
              inventoryEnabled={low.enabled}
              busy={busy === m.id}
              onDose={(i, s) => setDose(m, i, s)}
              onAddSupply={(u) => addSupply(m.id, u)}
              onSetSupply={(u) => setSupply(m.id, u)}
              onEdit={() => setEditing(m)}
              onInfo={() => setInfo(m)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 26 }}>
            Archived
          </h2>
          <div className="stack">
            {archived.map((m) => (
              <section key={m.id} className="card row" style={{ justifyContent: "space-between", opacity: 0.75 }}>
                <span style={{ fontWeight: 600 }}>{m.name}</span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setEditing(m)}>
                    Restore
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--heart)" }}
                    onClick={async () => {
                      if (!confirm(`Permanently delete "${m.name}"? History is kept.`)) return;
                      await fetch(`/api/medications?id=${encodeURIComponent(m.id)}&hard=1`, { method: "DELETE" });
                      load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {editing && (
        <MedEditor
          med={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onArchive={
            editing === "new"
              ? undefined
              : async () => {
                  await fetch(`/api/medications?id=${encodeURIComponent(editing.id)}`, { method: "DELETE" });
                  setEditing(null);
                  load();
                }
          }
        />
      )}

      {info && <MedInfoModal med={info} onClose={() => setInfo(null)} onUpdated={load} />}
    </main>
  );
}

// ── Active med row: today's doses + weekly strip + info/edit ────────────────

function MedRow({
  med,
  status,
  weekStates,
  today,
  inventoryEnabled,
  busy,
  onDose,
  onAddSupply,
  onSetSupply,
  onEdit,
  onInfo,
}: {
  med: MedicationDefinition;
  status?: MedicationDayStatus;
  weekStates: { date: string; state: CellState }[];
  today: string;
  inventoryEnabled: boolean;
  busy: boolean;
  onDose: (doseIndex: number, status: "taken" | "skipped" | null) => void;
  onAddSupply: (units: number) => void;
  onSetSupply: (units: number | null) => void;
  onEdit: () => void;
  onInfo: () => void;
}) {
  const color = med.critical ? "var(--heart)" : "var(--activity)";
  const amount = amountLabel(med);
  const abbr = (med.nickname || suggestNickname(med.name)).slice(0, 3);
  const doses = status?.doses ?? [];
  const adherence = status?.adherence7d;

  return (
    <section className="card" style={{ opacity: busy ? 0.6 : 1, transition: "opacity 0.2s" }}>
      {/* header */}
      <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <button
          onClick={onEdit}
          className="card-label"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", alignItems: "flex-start" }}
        >
          <span aria-hidden style={{ ...pillChip, background: `color-mix(in srgb, ${color} 16%, transparent)`, color, fontSize: 12, fontWeight: 800 }}>
            {abbr}
          </span>
          <span>
            {med.name}
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 400, marginTop: 2 }}>
              {med.kind === "supplement" ? "Supplement" : "Medication"}
              {amount ? ` · ${amount}` : ""} · {scheduleText(med)}
            </span>
          </span>
        </button>
        <div className="row" style={{ gap: 6, flex: "none" }}>
          {med.critical && (
            <span className="badge" style={{ background: "color-mix(in srgb, var(--heart) 16%, transparent)", color: "var(--heart)" }}>
              Critical
            </span>
          )}
          <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onInfo} title="Medicine info">
            ⓘ Info
          </button>
        </div>
      </div>

      {med.ingredients && med.ingredients.length > 1 && (
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>🧪 {componentsLabel(med)}</p>
      )}
      {med.withFood && <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>🍽 Take with food</p>}

      {/* today's doses — full-width habit-style rows with big take/skip */}
      <div className="stack" style={{ gap: 8, marginTop: 14 }}>
        {status?.asNeeded ? (
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => onDose(Date.now() % 100000, "taken")}>
            + Log a dose {status.takenCount ? `(${status.takenCount} today)` : ""}
          </button>
        ) : doses.length === 0 ? (
          <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Not scheduled today.</span>
        ) : (
          doses.map((d) => (
            <DoseRow
              key={d.doseIndex}
              time={d.time}
              status={d.status}
              overdue={d.overdue}
              busy={busy}
              onTake={() => onDose(d.doseIndex, d.status === "taken" ? null : "taken")}
              onSkip={() => onDose(d.doseIndex, d.status === "skipped" ? null : "skipped")}
            />
          ))
        )}
      </div>

      {inventoryEnabled && (
        <InventoryBar med={med} busy={busy} onAdd={onAddSupply} onSet={onSetSupply} />
      )}

      {/* footer: weekly adherence strip (left) + 7-day % (right) — full width */}
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--hairline)", flexWrap: "wrap" }}
      >
        <WeekStrip states={weekStates} today={today} />
        {adherence != null && (
          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
            7-day: <strong style={{ color: adherence >= 80 ? "var(--activity)" : "var(--ink)" }}>{adherence}%</strong>
          </span>
        )}
      </div>
    </section>
  );
}

/** Per-med current-week adherence dots (Mon→Sun); today's dot is ringed. */
function WeekStrip({ states, today }: { states: { date: string; state: CellState }[]; today: string }) {
  if (!states.length) return <span />;
  return (
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
      {states.map((s) => {
        const isToday = s.date === today;
        const filled = s.state === "taken";
        const due = s.state === "due";
        const missed = s.state === "missed";
        const none = s.state === "none";
        const c = STATE_COLOR[s.state];
        return (
          <span
            key={s.date}
            title={`${s.date}: ${s.state}`}
            style={{
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: filled ? c : missed || due ? `color-mix(in srgb, ${c} 22%, transparent)` : "transparent",
              border: none ? "1px dashed var(--hairline)" : `1.5px solid ${filled || missed || due ? c : "var(--hairline)"}`,
              boxShadow: isToday ? "0 0 0 2px color-mix(in srgb, var(--heart) 35%, transparent)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/** A dose row like the habit card: time on the left, big check (take) + cross
 *  (skip) buttons right-aligned. Tap a lit button again to clear. */
function DoseRow({
  time,
  status,
  overdue,
  busy,
  onTake,
  onSkip,
}: {
  time: string | null;
  status: "taken" | "skipped" | null;
  overdue: boolean;
  busy: boolean;
  onTake: () => void;
  onSkip: () => void;
}) {
  const taken = status === "taken";
  const skipped = status === "skipped";
  const due = overdue && !status;
  const big = (active: boolean, activeBg: string, activeFg = "var(--bg)"): React.CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 19,
    cursor: "pointer",
    border: `1.5px solid ${active ? activeBg : "var(--hairline)"}`,
    background: active ? activeBg : "transparent",
    color: active ? activeFg : "var(--ink-soft)",
    transition: "all 0.15s",
  });
  return (
    <div
      className="row"
      style={{
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        padding: "6px 4px 6px 12px",
        borderRadius: 12,
        background: taken ? "color-mix(in srgb, var(--activity) 8%, transparent)" : due ? "color-mix(in srgb, var(--heart) 7%, transparent)" : "var(--bg-inset)",
        border: `1px solid ${taken ? "color-mix(in srgb, var(--activity) 40%, transparent)" : due ? "color-mix(in srgb, var(--heart) 40%, transparent)" : "var(--hairline)"}`,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: due ? "var(--heart)" : "var(--ink)" }}>
        {time ?? "Anytime"}
        {due ? <span style={{ fontSize: 11.5, fontWeight: 600 }}> · due</span> : taken ? <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--activity)" }}> · taken</span> : skipped ? <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-soft)" }}> · skipped</span> : null}
      </span>
      <div className="row" style={{ gap: 8 }}>
        <button aria-label="taken" disabled={busy} onClick={onTake} title={taken ? "Taken — tap to clear" : "Mark taken"} style={big(taken, "var(--activity)")}>
          ✓
        </button>
        <button aria-label="skipped" disabled={busy} onClick={onSkip} title={skipped ? "Skipped — tap to clear" : "Skip this dose"} style={big(skipped, "var(--ink-soft)")}>
          ✕
        </button>
      </div>
    </div>
  );
}

/** Inline supply tracker: shows units + days remaining, with restock + stop. */
function InventoryBar({
  med,
  busy,
  onAdd,
  onSet,
}: {
  med: MedicationDefinition;
  busy: boolean;
  onAdd: (units: number) => void;
  onSet: (units: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const inv = med.inventory;
  const days = daysOfSupply(med);
  const low = days != null && days <= 7;
  const unit = med.unit || "units";

  function submit() {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return;
    if (inv) onAdd(n);
    else onSet(n);
    setVal("");
    setOpen(false);
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="row" style={{ gap: 6, fontSize: 12.5 }}>
          <span aria-hidden>📦</span>
          {inv ? (
            <span style={{ color: low ? "var(--heart)" : "var(--ink-soft)", fontWeight: low ? 700 : 400 }}>
              {inv.units} {unit} left
              {days != null ? ` · ~${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}` : ""}
              {low ? " · running low" : ""}
            </span>
          ) : (
            <span style={{ color: "var(--ink-soft)" }}>Supply not tracked</span>
          )}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12.5 }} disabled={busy} onClick={() => setOpen((o) => !o)}>
            {inv ? "Add supply" : "Track supply"}
          </button>
          {inv && (
            <button className="btn btn-ghost" style={{ padding: "5px 8px", fontSize: 12, color: "var(--ink-soft)" }} disabled={busy} title="Stop tracking supply" onClick={() => onSet(null)}>
              Stop
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            className="field"
            type="number"
            inputMode="decimal"
            autoFocus
            value={val}
            placeholder={inv ? `Add ${unit}…` : `Current ${unit} on hand…`}
            style={{ width: 170 }}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button className="btn" disabled={busy || !val} onClick={submit}>
            {inv ? "Add" : "Start"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Medicine info popup ────────────────────────────────────────────────────

function MedInfoModal({ med, onClose, onUpdated }: { med: MedicationDefinition; onClose: () => void; onUpdated: () => void }) {
  const [info, setInfo] = useState<MedicationInfo | null>(med.info ?? null);
  const [loading, setLoading] = useState(false);

  async function generate(refresh = false) {
    setLoading(true);
    try {
      const res = await fetch(`/api/medications/info?id=${encodeURIComponent(med.id)}${refresh ? "&refresh=1" : ""}`, { method: "POST" });
      const data = await res.json();
      if (data.info) setInfo(data.info);
      onUpdated();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!med.info) generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections = info?.sections ?? {};
  const rows: { label: string; text?: string }[] = [
    { label: "What it's for", text: sections.purpose },
    { label: "How it's used", text: sections.usage },
    { label: "Typical dosage", text: sections.dosage },
    { label: "Common side effects", text: sections.sideEffects },
    { label: "Key cautions", text: sections.cautions },
  ];

  return (
    <Modal onClose={onClose} title={med.name}>
      {loading && !info ? (
        <p style={{ color: "var(--ink-soft)" }}>Researching {med.name}…</p>
      ) : info?.error ? (
        <div className="stack" style={{ gap: 12 }}>
          <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>{info.error}</p>
          {info.sources?.length > 0 && (
            <p style={{ fontSize: 12.5 }}>
              Suggested source:{" "}
              <a href={info.sources[0].url} target="_blank" rel="noreferrer" style={{ color: "var(--breath)" }}>
                {info.sources[0].name}
              </a>
            </p>
          )}
          <button className="btn btn-ghost" disabled={loading} onClick={() => generate(true)}>
            {loading ? "Retrying…" : "Try again"}
          </button>
        </div>
      ) : info ? (
        <div className="stack" style={{ gap: 14 }}>
          {info.genericName && (
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
              Active ingredient: <strong style={{ color: "var(--ink)" }}>{info.genericName}</strong>
            </p>
          )}
          {rows
            .filter((r) => r.text)
            .map((r) => (
              <div key={r.label}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 3 }}>{r.label}</p>
                <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{r.text}</p>
              </div>
            ))}
          <p style={{ fontSize: 11, color: "var(--ink-faint)", fontStyle: "italic", lineHeight: 1.5 }}>{info.disclaimer}</p>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
              {info.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 ? " · " : "Source: "}
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--breath)" }}>
                    {s.name}
                  </a>
                </span>
              ))}
            </span>
            <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} disabled={loading} onClick={() => generate(true)}>
              {loading ? "…" : "↻ Refresh"}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => generate(false)}>
          Get medicine info
        </button>
      )}
    </Modal>
  );
}

// ── Global reminder settings ───────────────────────────────────────────────

function MedReminderSettings() {
  const [s, setS] = useState<MedicationSettings | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/medications/settings").then((r) => r.json()).then(setS).catch(() => {});
  }, []);

  async function patch(p: Partial<MedicationSettings>) {
    const res = await fetch("/api/medications/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    setS(await res.json());
  }

  if (!s) return null;
  return (
    <section className="card">
      {/* header: title + status, with the master toggle aligned right */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: "center", minWidth: 0 }}>
          <span aria-hidden style={{ ...pillChip, background: "color-mix(in srgb, var(--breath) 16%, transparent)", color: "var(--breath)" }}>🔔</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>Reminders</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
              {s.remindersEnabled ? "On · delivered to Telegram" : "Off · turn on for dose reminders"}
            </div>
          </div>
        </div>
        <Switch checked={s.remindersEnabled} onChange={(v) => patch({ remindersEnabled: v })} />
      </div>

      {s.remindersEnabled && (
        <>
          <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 10 }}>
            Critical doses re-nudge until you mark them taken{ s.criticalBypassQuietHours ? " and can remind during quiet hours" : "" }. Set per-med lead times when adding a medication.
          </p>
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn btn-ghost"
            style={{ marginTop: 12, padding: "7px 12px", fontSize: 12.5 }}
          >
            {open ? "Hide options ▲" : "Reminder options ▼"}
          </button>
        </>
      )}

      {open && s.remindersEnabled && (
        <div className="stack" style={{ gap: 12, marginTop: 14 }}>
          <Toggle
            label="Critical doses reminder during quiet hours"
            checked={s.criticalBypassQuietHours}
            onChange={(v) => patch({ criticalBypassQuietHours: v })}
          />
          <div className="grid-2">
            <Field label="Quiet hours start">
              <input className="field" type="time" value={minToHm(s.quietStartMin)} onChange={(e) => patch({ quietStartMin: hmToMin(e.target.value, s.quietStartMin) })} />
            </Field>
            <Field label="Quiet hours end">
              <input className="field" type="time" value={minToHm(s.quietEndMin)} onChange={(e) => patch({ quietEndMin: hmToMin(e.target.value, s.quietEndMin) })} />
            </Field>
            <Field label="Critical re-nudge every (min)">
              <input className="field" type="number" min={5} max={240} defaultValue={s.renudgeMinutes} onBlur={(e) => patch({ renudgeMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Max re-nudges per dose">
              <input className="field" type="number" min={0} max={10} defaultValue={s.maxRenudges} onBlur={(e) => patch({ maxRenudges: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      )}
    </section>
  );
}

function minToHm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function hmToMin(hm: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm?.trim() ?? "");
  if (!m) return fallback;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

// ── Create / edit modal ────────────────────────────────────────────────────

type FormState = {
  name: string;
  nickname: string;
  kind: MedicationKind;
  strength: string;
  ingredients: { name: string; strength: string }[];
  quantity: string;
  unit: string;
  form: string;
  withFood: boolean;
  notes: string;
  frequency: MedicationFrequency;
  daysOfWeek: number[];
  times: string[];
  critical: boolean;
  remindersEnabled: boolean;
  leadMinutes: number[];
  inventory: string; // starting supply, only applied on create
};

function toForm(m: MedicationDefinition | null): FormState {
  return {
    name: m?.name ?? "",
    nickname: m?.nickname ?? "",
    kind: m?.kind ?? "medication",
    strength: m?.strength ?? "",
    ingredients: m?.ingredients?.map((i) => ({ name: i.name, strength: i.strength ?? "" })) ?? [],
    quantity: m?.quantity != null ? String(m.quantity) : "",
    unit: m?.unit ?? "tablet",
    form: m?.form ?? "",
    withFood: m?.withFood ?? false,
    notes: m?.notes ?? "",
    frequency: m?.schedule.frequency ?? "daily",
    daysOfWeek: m?.schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
    times: m?.schedule.times?.length ? [...m.schedule.times] : ["08:00"],
    critical: m?.critical ?? false,
    remindersEnabled: m?.reminders?.enabled ?? true,
    leadMinutes: m?.reminders?.leadMinutes ?? [0],
    inventory: "",
  };
}

function MedEditor({
  med,
  onClose,
  onSaved,
  onArchive,
}: {
  med: MedicationDefinition | null;
  onClose: () => void;
  onSaved: () => void;
  onArchive?: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(med));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);

  const timed = f.frequency !== "as_needed";

  function toggleLead(min: number) {
    set("leadMinutes", f.leadMinutes.includes(min) ? f.leadMinutes.filter((m) => m !== min) : [...f.leadMinutes, min].sort((a, b) => b - a));
  }
  function toggleDay(d: number) {
    set("daysOfWeek", f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d].sort());
  }
  function setTime(i: number, v: string) {
    set("times", f.times.map((t, idx) => (idx === i ? v : t)));
  }
  function addIngredient() {
    set("ingredients", [...f.ingredients, { name: "", strength: "" }]);
  }
  function setIngredient(i: number, key: "name" | "strength", v: string) {
    set("ingredients", f.ingredients.map((ing, idx) => (idx === i ? { ...ing, [key]: v } : ing)));
  }
  function removeIngredient(i: number) {
    set("ingredients", f.ingredients.filter((_, idx) => idx !== i));
  }

  /** Scan a photo of the box → prefill the form (count goes to the editable
   *  Starting-supply field; nothing is saved until the user confirms). */
  async function scan(file: File) {
    setScanErr(null);
    setScanNote(null);
    setScanning(true);
    try {
      const image = await downscaleImage(file, 1280);
      const res = await fetch("/api/medications/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error ?? "Scan failed");
      setF((prev) => {
        const ings: { name: string; strength: string }[] = Array.isArray(r.ingredients)
          ? r.ingredients.map((i: any) => ({ name: String(i.name ?? ""), strength: String(i.strength ?? "") }))
          : prev.ingredients;
        return {
          ...prev,
          name: r.name || prev.name,
          kind: r.kind === "supplement" ? "supplement" : r.kind === "medication" ? "medication" : prev.kind,
          form: r.form || prev.form,
          unit: r.unit || prev.unit,
          ingredients: ings.length ? ings : prev.ingredients,
          // A single detected ingredient with a strength also fills the simple field.
          strength: ings.length === 1 && ings[0].strength ? ings[0].strength : prev.strength,
          // Pack count → editable Starting supply (only meaningful when creating).
          inventory: !med && r.packCount ? String(r.packCount) : prev.inventory,
        };
      });
      const bits: string[] = [];
      if (r.ingredients?.length) bits.push(`${r.ingredients.length} ingredient${r.ingredients.length === 1 ? "" : "s"}`);
      if (r.packCount) bits.push(`${r.packCount} ${r.unit || "units"}`);
      setScanNote(`Scanned${bits.length ? " · " + bits.join(" · ") : ""} — review and edit below before saving.`);
    } catch (e: any) {
      setScanErr(String(e.message ?? e));
    } finally {
      setScanning(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  async function save() {
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: f.name.trim(),
        nickname: f.nickname.trim() || undefined,
        kind: f.kind,
        strength: f.strength.trim() || undefined,
        ingredients: f.ingredients
          .filter((i) => i.name.trim())
          .map((i) => ({ name: i.name.trim(), strength: i.strength.trim() || undefined })),
        quantity: f.quantity !== "" ? Number(f.quantity) : undefined,
        unit: f.unit.trim() || undefined,
        form: f.form.trim() || undefined,
        withFood: f.withFood,
        notes: f.notes.trim() || undefined,
        schedule: {
          frequency: f.frequency,
          daysOfWeek: f.frequency === "specific_days" ? f.daysOfWeek : undefined,
          times: timed ? f.times.filter(Boolean) : [],
        },
        critical: f.critical,
        reminders: { enabled: f.remindersEnabled, leadMinutes: f.leadMinutes.length ? f.leadMinutes : [0] },
        active: true,
      };
      const url = med ? `/api/medications?id=${encodeURIComponent(med.id)}` : "/api/medications";
      const res = await fetch(url, {
        method: med ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      // Apply a starting supply on create (inventory has its own endpoint).
      if (!med && f.inventory.trim() && Number(f.inventory) > 0) {
        const saved = await res.json().catch(() => null);
        if (saved?.id) {
          await fetch("/api/medications/inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: saved.id, setUnits: Number(f.inventory) }),
          });
        }
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={med ? "Edit medication" : "Add medication"}>
      <div className="stack" style={{ gap: 16 }}>
        {/* Scan the box → vision model prefills the fields for review */}
        <div
          style={{
            border: "1px dashed var(--hairline)",
            borderRadius: 12,
            padding: "12px 14px",
            background: "var(--bg-inset)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>📷 Snap the box to auto-fill name, ingredients & count</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" disabled={scanning} onClick={() => cameraRef.current?.click()} style={{ padding: "6px 12px", fontSize: 12.5 }}>
                {scanning ? "Reading…" : "Scan box"}
              </button>
              <button className="btn btn-ghost" disabled={scanning} onClick={() => galleryRef.current?.click()} style={{ padding: "6px 12px", fontSize: 12.5 }}>
                Upload
              </button>
            </div>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          {scanNote && <p style={{ fontSize: 11.5, color: "var(--activity)", marginTop: 8 }}>{scanNote}</p>}
          {scanErr && <p style={{ fontSize: 11.5, color: "var(--heart)", marginTop: 8 }}>{scanErr}</p>}
        </div>

        <Field label="Name (as you know it — brand is fine)">
          <input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Concor, Metformin, Vitamin D" />
        </Field>

        <Field label="Pill-box label (1–3 letters shown in the organizer)">
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="field"
              value={f.nickname}
              maxLength={4}
              onChange={(e) => set("nickname", e.target.value.toUpperCase())}
              placeholder={f.name ? suggestNickname(f.name) : "BP"}
              style={{ width: 90, textTransform: "uppercase", fontWeight: 700, textAlign: "center" }}
            />
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {f.name && (
                <Chip active={f.nickname === suggestNickname(f.name)} onClick={() => set("nickname", suggestNickname(f.name))}>
                  {suggestNickname(f.name)}
                </Chip>
              )}
              {NICKNAME_SUGGESTIONS.map((n) => (
                <Chip key={n.abbr} active={f.nickname === n.abbr} onClick={() => set("nickname", n.abbr)}>
                  {n.abbr}
                  <span style={{ color: "var(--ink-faint)", fontWeight: 400, marginLeft: 4 }}>{n.label}</span>
                </Chip>
              ))}
            </div>
          </div>
        </Field>

        <Field label="Type">
          <Segmented
            options={[
              { value: "medication", label: "Medication" },
              { value: "supplement", label: "Supplement" },
            ]}
            value={f.kind}
            onChange={(v) => set("kind", v as MedicationKind)}
          />
        </Field>

        <div className="grid-2">
          <Field label="Quantity per dose">
            <input className="field" type="number" inputMode="decimal" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="1" />
          </Field>
          <Field label="Unit">
            <input className="field" value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="tablet, capsule, ml, IU" />
          </Field>
          {f.ingredients.length === 0 && (
            <Field label="Strength (optional)">
              <input className="field" value={f.strength} onChange={(e) => set("strength", e.target.value)} placeholder="5 mg, 1000 IU" />
            </Field>
          )}
          <Field label="Form (optional)">
            <input className="field" value={f.form} onChange={(e) => set("form", e.target.value)} placeholder="tablet, syrup…" />
          </Field>
        </div>

        {/* Active ingredients — for combination meds (e.g. Xigduo XR = two drugs,
            each with its own strength). When present they replace the single
            Strength above and are used for the research note + display. */}
        <Field label="Active ingredients (for combination meds)">
          <div className="stack" style={{ gap: 8 }}>
            {f.ingredients.map((ing, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <input
                  className="field"
                  value={ing.name}
                  onChange={(e) => setIngredient(i, "name", e.target.value)}
                  placeholder="ingredient (e.g. metformin)"
                  style={{ flex: 1 }}
                />
                <input
                  className="field"
                  value={ing.strength}
                  onChange={(e) => setIngredient(i, "strength", e.target.value)}
                  placeholder="1000 mg"
                  style={{ width: 100 }}
                />
                <button className="icon-btn" aria-label="remove ingredient" onClick={() => removeIngredient(i)}>−</button>
              </div>
            ))}
            <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "7px 12px", fontSize: 12.5 }} onClick={addIngredient}>
              + Add ingredient
            </button>
          </div>
        </Field>

        <Field label="Schedule">
          <select className="field" value={f.frequency} onChange={(e) => set("frequency", e.target.value as MedicationFrequency)}>
            <option value="daily">Every day</option>
            <option value="specific_days">Specific days</option>
            <option value="as_needed">As needed (no schedule)</option>
          </select>
        </Field>

        {f.frequency === "specific_days" && (
          <Field label="Days">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {DAY_NAMES.map((name, d) => (
                <Chip key={d} active={f.daysOfWeek.includes(d)} onClick={() => toggleDay(d)}>
                  {name}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        {timed && (
          <Field label="Dose times">
            <div className="stack" style={{ gap: 8 }}>
              {f.times.map((t, i) => (
                <div key={i} className="row" style={{ gap: 8 }}>
                  <input className="field" type="time" value={t} style={{ width: 150 }} onChange={(e) => setTime(i, e.target.value)} />
                  {f.times.length > 1 && (
                    <button className="icon-btn" aria-label="remove time" onClick={() => set("times", f.times.filter((_, idx) => idx !== i))}>
                      −
                    </button>
                  )}
                </div>
              ))}
              <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "7px 12px" }} onClick={() => set("times", [...f.times, "20:00"])}>
                + Add another time
              </button>
            </div>
          </Field>
        )}

        <Toggle label="Critical — must not be missed" checked={f.critical} onChange={(v) => set("critical", v)} />
        {f.critical && (
          <p style={{ fontSize: 11.5, color: "var(--heart)", marginTop: -8 }}>
            Critical doses re-nudge on Telegram until you mark them taken, and can remind during quiet hours.
          </p>
        )}

        <Toggle label="With food" checked={f.withFood} onChange={(v) => set("withFood", v)} />

        {timed && (
          <>
            <Toggle label="Remind me about this med" checked={f.remindersEnabled} onChange={(v) => set("remindersEnabled", v)} />
            {f.remindersEnabled && (
              <Field label="Remind">
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {LEAD_CHOICES.map((min) => (
                    <Chip key={min} active={f.leadMinutes.includes(min)} onClick={() => toggleLead(min)}>
                      {min === 0 ? "At time" : `${min}m before`}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
          </>
        )}

        {!med && (
          <Field label={`Starting supply (optional${f.unit ? ", " + f.unit : ""})`}>
            <input
              className="field"
              type="number"
              inputMode="decimal"
              value={f.inventory}
              onChange={(e) => set("inventory", e.target.value)}
              placeholder="e.g. 30 — we'll count down and remind you to refill"
            />
          </Field>
        )}

        <Field label="Notes (optional)">
          <input className="field" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. prescribed by Dr. …, take after breakfast" />
        </Field>

        <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 4 }}>
          {onArchive ? (
            <button className="btn btn-ghost" style={{ color: "var(--ink-soft)" }} onClick={onArchive}>
              Archive
            </button>
          ) : (
            <span />
          )}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={saving || !f.name.trim()} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── shared bits ────────────────────────────────────────────────────────────

/** Downscale a captured image to a JPEG data URL to keep the vision call small. */
async function downscaleImage(file: Blob, maxDim: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const pillChip: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--heart) 16%, transparent)",
  color: "var(--heart)",
  flex: "none",
  fontSize: 16,
};

function PillSvg() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-40 12 12)" />
      <path d="M8.6 8.4l7 7" />
    </svg>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card sheet-panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>{title}</h2>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="btn"
      style={
        active
          ? { padding: "7px 12px", fontSize: 13 }
          : { padding: "7px 12px", fontSize: 13, background: "transparent", color: "var(--ink)", border: "1px solid var(--hairline)" }
      }
    >
      {children}
    </button>
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="btn"
          style={value === o.value ? { flex: 1 } : { flex: 1, background: "transparent", color: "var(--ink)", border: "1px solid var(--hairline)" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact switch for header rows. */
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-label="toggle"
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        background: checked ? "var(--activity)" : "var(--hairline)",
        position: "relative",
        transition: "background 0.2s",
        flex: "none",
        border: "none",
        cursor: "pointer",
      }}
    >
      <span style={{ position: "absolute", top: 2, left: checked ? 22 : 2, width: 22, height: 22, borderRadius: "50%", background: "var(--bg)", transition: "left 0.2s" }} />
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="row"
      style={{
        justifyContent: "space-between",
        width: "100%",
        background: "var(--bg-inset)",
        border: "1px solid var(--hairline)",
        borderRadius: 12,
        padding: "11px 14px",
        cursor: "pointer",
        color: "var(--ink)",
      }}
    >
      <span style={{ fontSize: 14, textAlign: "left" }}>{label}</span>
      <span style={{ width: 40, height: 23, borderRadius: 999, background: checked ? "var(--activity)" : "var(--hairline)", position: "relative", transition: "background 0.2s", flex: "none" }}>
        <span style={{ position: "absolute", top: 2, left: checked ? 19 : 2, width: 19, height: 19, borderRadius: "50%", background: "var(--bg)", transition: "left 0.2s" }} />
      </span>
    </button>
  );
}
