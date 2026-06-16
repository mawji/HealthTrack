"use client";

import { Fragment, useEffect, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { InsightView } from "@/components/InsightView";
import { CoachInsight, DaySummary, TrendsPayload, TrendPoint } from "@/lib/types";

// Array-valued series on TrendsPayload that a TrendCard can chart.
type SeriesKey =
  | "steps" | "azm" | "workoutMin"
  | "restingHr" | "hrv" | "spo2"
  | "sleepMin"
  | "caloriesOut" | "caloriesIn" | "weightKg"
  | "proteinG" | "carbsG" | "fatG" | "glycemicLoad"
  | "water";

type CardCfg = {
  key: SeriesKey;
  label: string;
  color: string;
  unit: string;
  fmt: (v: number) => string;
  lowerBetter?: boolean;
  mode?: "avg" | "range";
  /** Core metrics render even on sparse ranges; others hide when no data. */
  always?: boolean;
};

// Cards grouped into meaningful sections, mirroring the Daily page clusters.
const SECTIONS: { title: string; cards: CardCfg[] }[] = [
  {
    title: "Movement",
    cards: [
      { key: "steps", label: "Steps", color: "var(--activity)", unit: "/day", fmt: (v) => Math.round(v).toLocaleString(), always: true },
      { key: "azm", label: "Active minutes", color: "var(--activity)", unit: "min/day", fmt: (v) => Math.round(v).toString() },
      { key: "workoutMin", label: "Workouts", color: "var(--activity)", unit: "min/day", fmt: (v) => Math.round(v).toString() },
    ],
  },
  {
    title: "Heart & recovery",
    cards: [
      { key: "restingHr", label: "Resting heart rate", color: "var(--heart)", unit: "bpm", fmt: (v) => v.toFixed(0), lowerBetter: true, always: true },
      { key: "hrv", label: "Heart rate variability", color: "var(--heart)", unit: "ms", fmt: (v) => v.toFixed(0) },
      { key: "spo2", label: "SpO₂", color: "var(--breath)", unit: "%", fmt: (v) => v.toFixed(1) },
    ],
  },
  {
    title: "Sleep",
    cards: [
      { key: "sleepMin", label: "Sleep", color: "var(--sleep)", unit: "", fmt: (v) => `${(v / 60).toFixed(1)}h`, always: true },
    ],
  },
  {
    title: "Energy",
    cards: [
      { key: "caloriesOut", label: "Calories burned", color: "var(--activity)", unit: "kcal", fmt: (v) => Math.round(v).toLocaleString(), always: true },
      { key: "caloriesIn", label: "Calories in", color: "var(--food)", unit: "kcal", fmt: (v) => Math.round(v).toLocaleString() },
      { key: "weightKg", label: "Weight", color: "var(--food)", unit: "kg", fmt: (v) => v.toFixed(1), mode: "range", always: true },
    ],
  },
  {
    title: "Nutrition",
    // Cover app-logged meals only; the whole section hides until something is logged.
    cards: [
      { key: "proteinG", label: "Protein", color: "var(--food)", unit: "g/day", fmt: (v) => Math.round(v).toString() },
      { key: "carbsG", label: "Carbs", color: "var(--food)", unit: "g/day", fmt: (v) => Math.round(v).toString() },
      { key: "fatG", label: "Fat", color: "var(--food)", unit: "g/day", fmt: (v) => Math.round(v).toString() },
      { key: "glycemicLoad", label: "Glycemic load", color: "var(--food)", unit: "/day", fmt: (v) => Math.round(v).toString(), lowerBetter: true },
    ],
  },
  {
    title: "Hydration",
    cards: [
      { key: "water", label: "Water", color: "var(--breath)", unit: "L/day", fmt: (v) => (v / 1000).toFixed(2) },
    ],
  },
];

const RANGES = [
  { label: "Week", days: 7, period: "week" },
  { label: "Month", days: 30, period: "month" },
  // Retrospective ranges: no auto-generate, no inline actions.
  { label: "3 Months", days: 90, period: "quarter" },
  // Served almost entirely from the local archive (data/archive.db).
  { label: "Year", days: 365, period: "year" },
] as const;

// quarter/year are long-range retrospectives — summary on demand only.
const LONG_RANGE_DAYS = new Set([90, 365]);

function avg(points: TrendPoint[]) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function Trends() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendsPayload | null>(null);

  // Reused coach insight system (headline/body/viz/focusAreas) per range.
  const [weekData, setWeekData] = useState<DaySummary[]>([]);
  const [insight, setInsight] = useState<CoachInsight | null>(null);
  const [insightErr, setInsightErr] = useState("");
  const [loadingInsight, setLoadingInsight] = useState(false);

  const range = RANGES.find((r) => r.days === days)!;
  const isLong = LONG_RANGE_DAYS.has(days);

  useEffect(() => {
    setData(null);
    fetch(`/api/health?view=trends&days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [days]);

  // Recent days power any viz card the insight returns.
  useEffect(() => {
    fetch("/api/health?view=today")
      .then((r) => r.json())
      .then((d) => {
        if (d?.week) setWeekData(d.week);
      })
      .catch(() => {});
  }, []);

  const loadInsight = (period: string, force = false) => {
    setInsight(null);
    setInsightErr("");
    setLoadingInsight(true);
    fetch(`/api/coach/insights?period=${period}${force ? "&refresh=1" : ""}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "failed");
        setInsight(json);
      })
      .catch((e) => setInsightErr(String(e.message ?? e)))
      .finally(() => setLoadingInsight(false));
  };

  // Week/Month auto-generate on selection; long ranges wait for an explicit click.
  useEffect(() => {
    setInsight(null);
    setInsightErr("");
    if (!LONG_RANGE_DAYS.has(days)) loadInsight(range.period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <main className="page wide">
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

      {isLong ? (
        <section className="card rise rise-1" style={{ borderLeft: "3px solid var(--breath)", marginBottom: 16 }}>
          {!insight && !loadingInsight && !insightErr && (
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div className="card-label"><span className="dot" style={{ background: "var(--breath)" }} />Long-range summary</div>
                <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
                  A retrospective look at your last {range.label.toLowerCase()}.
                </p>
              </div>
              <button className="btn" style={{ padding: "8px 16px", fontSize: 13, flex: "none" }} onClick={() => loadInsight(range.period)}>
                Generate summary
              </button>
            </div>
          )}
          {loadingInsight && <p className="pulsing" style={{ color: "var(--breath)", fontWeight: 600 }}>Summarizing your last {range.label.toLowerCase()}…</p>}
          {insightErr && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{insightErr}</p>}
          {insight && <InsightView insight={insight} week={weekData} />}
        </section>
      ) : (
        (loadingInsight || insight || insightErr) && (
          <section className="card rise rise-1" style={{ borderLeft: "3px solid var(--breath)", marginBottom: 16 }}>
            {loadingInsight && <p className="pulsing" style={{ color: "var(--breath)", fontWeight: 600 }}>Reading your {range.label.toLowerCase()}…</p>}
            {insightErr && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{insightErr}</p>}
            {insight && <InsightView insight={insight} week={weekData} />}
          </section>
        )
      )}

      {!data ? (
        <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading trends…</p>
      ) : (
        <div className="stack desk-grid">
          {SECTIONS.map((sec, si) => {
            const visible = sec.cards.filter((c) => {
              const pts = data[c.key] as TrendPoint[] | undefined;
              return c.always ? !!pts : avg(pts ?? []) != null;
            });
            if (!visible.length) return null;
            return (
              <Fragment key={sec.title}>
                <h2 className={`section-title desk-span rise rise-${Math.min(si + 1, 6)}`}>{sec.title}</h2>
                {visible.map((c) => (
                  <TrendCard
                    key={c.key}
                    rise={Math.min(si + 2, 6)}
                    label={c.label}
                    color={c.color}
                    points={(data[c.key] as TrendPoint[]) ?? []}
                    unit={c.unit}
                    fmt={c.fmt}
                    lowerBetter={c.lowerBetter}
                    mode={c.mode}
                  />
                ))}
              </Fragment>
            );
          })}
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
            <span className="display-num" style={{ fontSize: 34 }}>{latest != null ? fmt(latest) : "—"}</span>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>latest {unit}</span>
          </>
        ) : (
          <>
            <span className="display-num" style={{ fontSize: 34 }}>{a != null ? fmt(a) : "—"}</span>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>avg {unit}</span>
          </>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <Sparkline values={vals} color={color} fill height={64} tipLabels={tipDates} tipFormat={(v) => `${fmt(v)} ${unit}`} />
      </div>
    </section>
  );
}
