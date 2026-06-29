"use client";

// Daily medications card: a "today" pill box (Morning/Noon/Evening/Night
// compartments) plus a per-med list with one-tap taken/skip and overdue
// highlighting. Full management lives on /medications. Self-loads for the shown
// date and stays in sync with the top alert + organizer via `ht-meds-changed`.

import { useEffect, useState } from "react";
import Link from "next/link";
import { MedicationsPayload, MedicationDefinition, MedicationDayStatus } from "@/lib/types";
import { BUCKETS, BucketKey, bucketForTime, doseState, mergeStates, CellState, STATE_COLOR } from "@/lib/medication-display";

export default function MedicationsWidget({ date }: { date: string | undefined }) {
  const [payload, setPayload] = useState<MedicationsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = (d: string) =>
    fetch(`/api/medications?date=${d}`).then((r) => r.json()).then(setPayload).catch(() => {});

  useEffect(() => {
    if (date) load(date);
  }, [date]);

  // Stay in sync when the alert/organizer/coach mutate a dose.
  useEffect(() => {
    const onChange = () => { if (date) load(date); };
    window.addEventListener("ht-meds-changed", onChange);
    return () => window.removeEventListener("ht-meds-changed", onChange);
  }, [date]);

  async function post(body: object) {
    await fetch("/api/medications/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function setDose(medId: string, doseIndex: number, status: "taken" | "skipped" | null) {
    if (!date) return;
    setBusy(medId);
    try {
      await post({ medicationId: medId, date, doseIndex, status });
      try { window.dispatchEvent(new Event("ht-meds-changed")); } catch {}
      await load(date);
    } finally {
      setBusy(null);
    }
  }

  // Mark every pending dose in a time-of-day compartment taken (the "take the
  // whole compartment" gesture).
  async function fillBucket(bucket: BucketKey) {
    if (!date || !payload) return;
    setBusy("bucket:" + bucket);
    try {
      for (const m of meds) {
        const st = statusFor(m.id);
        if (!st || st.asNeeded) continue;
        for (const d of st.doses) {
          if (d.status == null && bucketForTime(d.time) === bucket) {
            await post({ medicationId: m.id, date, doseIndex: d.doseIndex, status: "taken" });
          }
        }
      }
      try { window.dispatchEvent(new Event("ht-meds-changed")); } catch {}
      await load(date);
    } finally {
      setBusy(null);
    }
  }

  const meds = (payload?.medications ?? []).filter((m) => m.active);
  const statusFor = (id: string) => payload?.status.find((s) => s.medicationId === id);

  const shown = meds.filter((m) => {
    const st = statusFor(m.id);
    return st?.scheduledToday || st?.asNeeded;
  });
  if (!payload || shown.length === 0) return null;

  const scheduled = shown.filter((m) => statusFor(m.id)?.scheduledToday && !statusFor(m.id)?.asNeeded);
  const totalDoses = scheduled.reduce((n, m) => n + (statusFor(m.id)?.scheduledCount ?? 0), 0);
  const takenDoses = scheduled.reduce((n, m) => n + (statusFor(m.id)?.takenCount ?? 0), 0);

  // Compartment summary for today (only buckets that actually have doses).
  const bucketCells = BUCKETS.map((b) => {
    const states: CellState[] = [];
    let taken = 0;
    let pending = 0;
    for (const m of scheduled) {
      for (const d of statusFor(m.id)!.doses) {
        if (bucketForTime(d.time) !== b.key) continue;
        const s = doseState(d, payload.date, payload.date); // shown date treated as "today" for the card
        states.push(s);
        if (s === "taken") taken++;
        if (s === "due" || s === "upcoming") pending++;
      }
    }
    return { bucket: b, total: states.length, taken, pending, state: mergeStates(states) };
  }).filter((c) => c.total > 0);

  return (
    <>
      <h2 className="section-title desk-span rise rise-3">Medications</h2>
      <section className="card desk-span rise rise-3">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div className="card-label">
            <span aria-hidden style={pillIcon}>
              <PillSvg />
            </span>
            Medications
          </div>
          <div className="row" style={{ gap: 10 }}>
            {totalDoses > 0 && (
              <span className="badge" style={{ background: "color-mix(in srgb, var(--activity) 14%, transparent)", color: "var(--activity)" }}>
                {takenDoses}/{totalDoses} taken
              </span>
            )}
            <Link href="/medications" style={{ fontSize: 12.5, color: "var(--ink-soft)", textDecoration: "none", fontWeight: 600 }}>
              Manage ›
            </Link>
          </div>
        </div>

        {/* Today's pill box compartments */}
        {bucketCells.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${bucketCells.length}, 1fr)`, gap: 8, marginBottom: 14 }}>
            {bucketCells.map((c) => {
              const allTaken = c.state === "taken";
              const due = c.state === "due";
              const clickable = c.pending > 0;
              const color = STATE_COLOR[c.state];
              return (
                <button
                  key={c.bucket.key}
                  disabled={!clickable || busy != null}
                  onClick={() => clickable && fillBucket(c.bucket.key)}
                  className={due ? "pulsing" : undefined}
                  title={clickable ? "Tap to take this compartment" : allTaken ? "All taken" : ""}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    padding: "10px 4px",
                    borderRadius: 12,
                    cursor: clickable ? "pointer" : "default",
                    border: `1px solid ${allTaken ? color : due ? color : "var(--hairline)"}`,
                    background: allTaken ? color : due ? `color-mix(in srgb, ${color} 14%, transparent)` : "var(--bg-inset)",
                    color: allTaken ? "var(--bg)" : due ? color : "var(--ink)",
                  }}
                >
                  <span style={{ fontSize: 16 }} aria-hidden>{c.bucket.icon}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.9 }}>{c.bucket.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{allTaken ? "✓ done" : `${c.taken}/${c.total}`}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="stack" style={{ gap: 10 }}>
          {shown.map((m) => (
            <MedLine key={m.id} med={m} status={statusFor(m.id)} busy={busy === m.id} onDose={(i, s) => setDose(m.id, i, s)} />
          ))}
        </div>
      </section>
    </>
  );
}

function MedLine({
  med,
  status,
  busy,
  onDose,
}: {
  med: MedicationDefinition;
  status?: MedicationDayStatus;
  busy: boolean;
  onDose: (doseIndex: number, status: "taken" | "skipped" | null) => void;
}) {
  const doses = status?.doses ?? [];
  return (
    <div
      className="row"
      style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap", opacity: busy ? 0.6 : 1, transition: "opacity 0.2s" }}
    >
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {med.name}
          {med.critical && <span style={{ color: "var(--heart)", fontSize: 11, marginLeft: 6 }}>• critical</span>}
        </span>
        {med.withFood && <span style={{ fontSize: 11, color: "var(--ink-soft)", display: "block" }}>🍽 with food</span>}
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {status?.asNeeded ? (
          <button className="btn btn-ghost" disabled={busy} style={{ padding: "5px 10px", fontSize: 12.5 }} onClick={() => onDose(Date.now() % 100000, "taken")}>
            + Log dose {status.takenCount ? `(${status.takenCount})` : ""}
          </button>
        ) : (
          doses.map((d) => {
            const taken = d.status === "taken";
            const skipped = d.status === "skipped";
            return (
              <button
                key={d.doseIndex}
                className="btn"
                disabled={busy}
                title={skipped ? "Skipped — tap to clear" : taken ? "Taken — tap to clear" : "Tap to mark taken"}
                onClick={() => onDose(d.doseIndex, taken ? null : "taken")}
                style={
                  taken
                    ? { padding: "5px 10px", fontSize: 12.5, background: "var(--activity)", color: "var(--bg)", borderColor: "var(--activity)" }
                    : {
                        padding: "5px 10px",
                        fontSize: 12.5,
                        background: "transparent",
                        color: d.overdue ? "var(--heart)" : "var(--ink)",
                        border: `1px solid ${d.overdue ? "var(--heart)" : "var(--hairline)"}`,
                        opacity: skipped ? 0.55 : 1,
                      }
                }
              >
                {taken ? "✓ " : ""}
                {d.time ?? "dose"}
                {skipped ? " · skipped" : d.overdue && !taken ? " · due" : ""}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

const pillIcon: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--heart) 16%, transparent)",
  color: "var(--heart)",
};

function PillSvg() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-40 12 12)" />
      <path d="M8.6 8.4l7 7" />
    </svg>
  );
}
