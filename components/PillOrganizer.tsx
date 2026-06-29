"use client";

// Virtual pill box — a weekly organizer grid (time-of-day rows × Mon→Sun),
// mirroring a physical 7-day box. Each med-dose shows as a little PILL capsule
// labelled with the med's nickname/abbreviation, colored by state. Today's
// column is highlighted; clicking a pill shows its name/dose/time and (for a
// pending dose today) lets you mark it taken/skipped. See lib/medication-display.

import { useState } from "react";
import { MedicationDayStatus, MedicationDefinition } from "@/lib/types";
import { BUCKETS, BucketKey, bucketForTime, doseState, CellState, STATE_COLOR, dayHeader, suggestNickname, strengthsLabel } from "@/lib/medication-display";

export interface WeekDay {
  date: string;
  status: MedicationDayStatus[];
}

interface PillItem {
  medId: string;
  name: string;
  abbr: string;
  dose: string;
  time: string | null;
  doseIndex: number;
  date: string;
  state: CellState;
}

function doseAmount(m: MedicationDefinition): string {
  const parts: string[] = [];
  if (m.quantity != null) parts.push(`${m.quantity}${m.unit ? " " + m.unit : ""}`);
  else if (m.unit) parts.push(m.unit);
  const s = strengthsLabel(m);
  if (s) parts.push(`(${s})`);
  return parts.join(" ").trim();
}

export default function PillOrganizer({
  days,
  today,
  meds,
  onRecord,
  busy,
}: {
  days: WeekDay[];
  today: string;
  meds: MedicationDefinition[];
  onRecord?: (medId: string, doseIndex: number, date: string, status: "taken" | "skipped" | null) => void;
  busy?: boolean;
}) {
  const [sel, setSel] = useState<PillItem | null>(null);
  if (!days.length) return null;

  const medMap = new Map(meds.map((m) => [m.id, m]));

  const itemsFor = (day: WeekDay, bucket: BucketKey): PillItem[] => {
    const out: PillItem[] = [];
    for (const st of day.status) {
      const med = medMap.get(st.medicationId);
      if (!med) continue;
      for (const dose of st.doses) {
        if (bucketForTime(dose.time) !== bucket) continue;
        out.push({
          medId: med.id,
          name: med.name,
          abbr: (med.nickname || suggestNickname(med.name)).slice(0, 3),
          dose: doseAmount(med),
          time: dose.time,
          doseIndex: dose.doseIndex,
          date: day.date,
          state: doseState(dose, day.date, today),
        });
      }
    }
    return out;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `58px repeat(${days.length}, minmax(40px, 1fr))`,
          gap: 5,
          minWidth: 380,
        }}
      >
        {/* header row */}
        <div />
        {days.map((d) => {
          const { dow, dom } = dayHeader(d.date);
          const isToday = d.date === today;
          return (
            <div
              key={d.date}
              style={{
                textAlign: "center",
                lineHeight: 1.1,
                padding: "2px 0",
                borderRadius: 8,
                background: isToday ? "color-mix(in srgb, var(--heart) 12%, transparent)" : "transparent",
              }}
            >
              <div style={{ fontSize: 10, color: isToday ? "var(--heart)" : "var(--ink-soft)", fontWeight: 700 }}>{dow}</div>
              <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? "var(--heart)" : "var(--ink)" }}>{dom}</div>
            </div>
          );
        })}

        {/* bucket rows */}
        {BUCKETS.map((b) => (
          <Row key={b.key}>
            <div className="row" style={{ gap: 4, fontSize: 10.5, color: "var(--ink-soft)", fontWeight: 600, whiteSpace: "nowrap", alignItems: "center" }}>
              <span aria-hidden>{b.icon}</span>
              <span>{b.label}</span>
            </div>
            {days.map((d) => {
              const items = itemsFor(d, b.key);
              const isToday = d.date === today;
              return (
                <div
                  key={d.date + b.key}
                  style={{
                    minHeight: 30,
                    display: "flex",
                    flexWrap: "wrap",
                    alignContent: "center",
                    justifyContent: "center",
                    gap: 3,
                    padding: 3,
                    borderRadius: 9,
                    border: items.length ? "1px solid var(--hairline)" : "1px dashed color-mix(in srgb, var(--hairline) 65%, transparent)",
                    background: isToday ? "color-mix(in srgb, var(--heart) 7%, var(--bg-inset))" : "var(--bg-inset)",
                    opacity: items.length ? 1 : 0.5,
                  }}
                >
                  {items.map((it) => (
                    <Capsule
                      key={it.medId + it.doseIndex}
                      item={it}
                      pulse={isToday && it.state === "due"}
                      onClick={() => setSel(it)}
                    />
                  ))}
                </div>
              );
            })}
          </Row>
        ))}
      </div>

      {sel && (
        <PillDetail
          item={sel}
          today={today}
          busy={busy}
          onClose={() => setSel(null)}
          onRecord={onRecord}
        />
      )}

      <Legend />
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Capsule({ item, pulse, onClick }: { item: PillItem; pulse: boolean; onClick: () => void }) {
  const c = STATE_COLOR[item.state];
  const filled = item.state === "taken";
  const due = item.state === "due";
  const missed = item.state === "missed";
  const skipped = item.state === "skipped";

  const style: React.CSSProperties = {
    height: 19,
    padding: "0 7px",
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.02em",
    lineHeight: "19px",
    cursor: "pointer",
    border: `1.5px solid ${filled || due || missed ? c : "var(--hairline)"}`,
    background: filled ? c : due ? `color-mix(in srgb, ${c} 16%, transparent)` : missed ? `color-mix(in srgb, ${c} 9%, transparent)` : "var(--bg-raised)",
    color: filled ? "var(--bg)" : due || missed ? c : "var(--ink-soft)",
    textDecoration: skipped ? "line-through" : "none",
    whiteSpace: "nowrap",
  };
  return (
    <button
      onClick={onClick}
      className={pulse ? "pulsing" : undefined}
      style={style}
      title={`${item.name}${item.dose ? " · " + item.dose : ""}${item.time ? " · " + item.time : ""}`}
    >
      {item.abbr}
    </button>
  );
}

function PillDetail({
  item,
  today,
  busy,
  onClose,
  onRecord,
}: {
  item: PillItem;
  today: string;
  busy?: boolean;
  onClose: () => void;
  onRecord?: (medId: string, doseIndex: number, date: string, status: "taken" | "skipped" | null) => void;
}) {
  const isToday = item.date === today;
  const pending = item.state === "due" || item.state === "upcoming";
  const stateLabel =
    item.state === "taken" ? "Taken" : item.state === "skipped" ? "Skipped" : item.state === "missed" ? "Missed" : item.state === "due" ? "Due now" : "Upcoming";
  const act = (status: "taken" | "skipped" | null) => {
    onRecord?.(item.medId, item.doseIndex, item.date, status);
    onClose();
  };
  return (
    <div
      style={{
        marginTop: 12,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--hairline)",
        background: "var(--bg-raised)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
          {item.dose ? item.dose + " · " : ""}
          {item.time ? `due ${item.time}` : "no set time"} · <span style={{ color: item.state === "due" || item.state === "missed" ? "var(--heart)" : "var(--ink-soft)" }}>{stateLabel}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {isToday && pending && onRecord && (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("taken")}
              style={{ padding: "6px 12px", background: "var(--activity)", color: "var(--bg)", borderColor: "var(--activity)" }}
            >
              ✓ Take
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => act("skipped")}
              style={{ padding: "6px 12px" }}
            >
              Skip
            </button>
          </>
        )}
        {isToday && item.state === "taken" && onRecord && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => act(null)} style={{ padding: "6px 12px" }}>
            Undo
          </button>
        )}
        <button className="icon-btn" aria-label="close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

function Legend() {
  const items: { label: string; state: CellState }[] = [
    { label: "Taken", state: "taken" },
    { label: "Due", state: "due" },
    { label: "Missed", state: "missed" },
    { label: "Upcoming", state: "upcoming" },
  ];
  return (
    <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: "wrap" }}>
      {items.map((it) => (
        <span key={it.label} className="row" style={{ gap: 5, fontSize: 11, color: "var(--ink-soft)" }}>
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: 5,
              background: it.state === "taken" ? STATE_COLOR.taken : `color-mix(in srgb, ${STATE_COLOR[it.state]} 18%, transparent)`,
              border: `1px solid ${it.state === "upcoming" ? "var(--hairline)" : STATE_COLOR[it.state]}`,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
