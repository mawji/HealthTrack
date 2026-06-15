"use client";

import { useEffect, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { TrendsPayload, TrendPoint } from "@/lib/types";

const RANGES = [
  { label: "Week", days: 7 },
  { label: "Month", days: 30 },
  { label: "3 Months", days: 90 },
  // Served almost entirely from the local archive (data/archive.db).
  { label: "Year", days: 365 },
];

function avg(points: TrendPoint[]) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function Trends() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendsPayload | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/health?view=trends&days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [days]);

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Trends.</h1>
        <p className="page-sub">How your body is changing over time.</p>
      </header>

      <div className="row rise rise-1" style={{ gap: 8, marginBottom: 16 }}>
        {RANGES.map((r) => (
          <button
            key={r.days}
            className={`btn ${r.days === days ? "" : "btn-ghost"}`}
            style={{ padding: "8px 16px", fontSize: 13 }}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading trends…</p>
      ) : (
        <div className="stack desk-grid">
          <TrendCard rise={2} label="Steps" color="var(--activity)" points={data.steps} unit="/day" fmt={(v) => Math.round(v).toLocaleString()} />
          <TrendCard rise={3} label="Resting heart rate" color="var(--heart)" points={data.restingHr} unit="bpm" fmt={(v) => v.toFixed(0)} lowerBetter />
          <TrendCard rise={4} label="Sleep" color="var(--sleep)" points={data.sleepMin} unit="" fmt={(v) => `${(v / 60).toFixed(1)}h`} />
          <TrendCard rise={5} label="Weight" color="var(--food)" points={data.weightKg} unit="kg" fmt={(v) => v.toFixed(1)} mode="range" />
          {avg(data.hrv) != null && (
            <TrendCard rise={6} label="Heart rate variability" color="var(--heart)" points={data.hrv} unit="ms" fmt={(v) => v.toFixed(0)} />
          )}
          {avg(data.spo2) != null && (
            <TrendCard rise={6} label="SpO₂" color="var(--breath)" points={data.spo2} unit="%" fmt={(v) => v.toFixed(1)} />
          )}
          <TrendCard rise={6} label="Calories burned" color="var(--activity)" points={data.caloriesOut} unit="kcal" fmt={(v) => Math.round(v).toLocaleString()} />
          {/* Nutrition series cover app-logged meals only; hide until something is logged. */}
          {avg(data.proteinG ?? []) != null && (
            <TrendCard rise={6} label="Protein" color="var(--food)" points={data.proteinG!} unit="g/day" fmt={(v) => Math.round(v).toString()} />
          )}
          {avg(data.carbsG ?? []) != null && (
            <TrendCard rise={6} label="Carbs" color="var(--food)" points={data.carbsG!} unit="g/day" fmt={(v) => Math.round(v).toString()} />
          )}
          {avg(data.fatG ?? []) != null && (
            <TrendCard rise={6} label="Fat" color="var(--food)" points={data.fatG!} unit="g/day" fmt={(v) => Math.round(v).toString()} />
          )}
          {avg(data.glycemicLoad ?? []) != null && (
            <TrendCard rise={6} label="Glycemic load" color="var(--food)" points={data.glycemicLoad!} unit="/day" fmt={(v) => Math.round(v).toString()} lowerBetter />
          )}
          {data.demo && (
            <p className="desk-span" style={{ fontSize: 12, color: "var(--ink-faint)", textAlign: "center" }}>
              Showing demo data — connect Google Health on the Today tab for your real trends.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function TrendCard({
  label,
  color,
  points,
  unit,
  fmt,
  rise,
  lowerBetter = false,
  mode = "avg",
}: {
  label: string;
  color: string;
  points: TrendPoint[];
  unit: string;
  fmt: (v: number) => string;
  rise: number;
  lowerBetter?: boolean;
  /** "range" suits moment-in-time metrics like weight: latest + low/high. */
  mode?: "avg" | "range";
}) {
  const vals = points.map((p) => p.value);
  const nums = vals.filter((v): v is number => v != null);
  const a = avg(points);
  const half = Math.floor(points.length / 2);
  const first = avg(points.slice(0, half));
  const second = avg(points.slice(half));
  let delta: string | null = null;
  let improving = false;
  if (first != null && second != null && first !== 0) {
    const pct = ((second - first) / first) * 100;
    delta = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    improving = lowerBetter ? pct < 0 : pct > 0;
  }

  const latest = nums.length ? nums[nums.length - 1] : null;
  const lo = nums.length ? Math.min(...nums) : null;
  const hi = nums.length ? Math.max(...nums) : null;

  const tipDates = points.map((p) =>
    new Date(p.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
  );

  return (
    <section className={`card rise rise-${rise}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-label">
          <span className="dot" style={{ background: color }} />
          {label}
        </div>
        {mode === "range"
          ? lo != null &&
            hi != null && (
              <span className="badge" style={{ background: "var(--food-soft)", color: "var(--food)" }}>
                low {fmt(lo)} · high {fmt(hi)}
              </span>
            )
          : delta && (
              <span className="badge" style={{ background: improving ? "var(--activity-soft)" : "var(--heart-soft)", color: improving ? "var(--activity)" : "var(--heart)" }}>
                {delta}
              </span>
            )}
      </div>
      <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 8 }}>
        {mode === "range" ? (
          <>
            <span className="display-num" style={{ fontSize: 26 }}>{latest != null ? fmt(latest) : "—"}</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>latest {unit}</span>
          </>
        ) : (
          <>
            <span className="display-num" style={{ fontSize: 26 }}>{a != null ? fmt(a) : "—"}</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>avg {unit}</span>
          </>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <Sparkline values={vals} color={color} fill height={52} tipLabels={tipDates} tipFormat={(v) => `${fmt(v)} ${unit}`} />
      </div>
    </section>
  );
}
