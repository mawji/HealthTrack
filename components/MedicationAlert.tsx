"use client";

// Pinned Daily banner for CRITICAL medication doses that are due/overdue and not
// yet taken — surfaced near the top of the Daily screen (like the coach question
// card) so a must-take dose isn't missed. Stays in sync with the meds card and
// pill box via the shared `ht-meds-changed` event.

import { useEffect, useState } from "react";
import { MedicationsPayload } from "@/lib/types";

interface DueItem {
  medId: string;
  name: string;
  doseIndex: number;
  time: string | null;
}

export default function MedicationAlert() {
  const [items, setItems] = useState<DueItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const p: MedicationsPayload = await fetch("/api/medications").then((r) => r.json());
      const due: DueItem[] = [];
      for (const med of p.medications) {
        if (!med.active || !med.critical) continue;
        const st = p.status.find((s) => s.medicationId === med.id);
        for (const d of st?.doses ?? []) {
          if (d.overdue && d.status == null) due.push({ medId: med.id, name: med.name, doseIndex: d.doseIndex, time: d.time });
        }
      }
      setItems(due);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("ht-meds-changed", onChange);
    return () => window.removeEventListener("ht-meds-changed", onChange);
  }, []);

  async function take(it: DueItem) {
    const key = it.medId + it.doseIndex;
    setBusy(key);
    try {
      await fetch("/api/medications/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicationId: it.medId, doseIndex: it.doseIndex, status: "taken" }),
      });
      try { window.dispatchEvent(new Event("ht-meds-changed")); } catch {}
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return null;

  return (
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
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <span aria-hidden style={{ fontSize: 16 }}>⏰</span>
        <span style={{ fontWeight: 700, color: "var(--heart)" }}>
          {items.length === 1 ? "A critical dose is due" : `${items.length} critical doses are due`}
        </span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((it) => {
          const key = it.medId + it.doseIndex;
          return (
            <div key={key} className="row" style={{ justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {it.name}
                {it.time && <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}> · due {it.time}</span>}
              </span>
              <button
                className="btn"
                disabled={busy === key}
                onClick={() => take(it)}
                style={{ padding: "6px 14px", background: "var(--heart)", color: "var(--bg)", borderColor: "var(--heart)" }}
              >
                {busy === key ? "…" : "✓ Take now"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
