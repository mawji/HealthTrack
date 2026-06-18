"use client";

import { Fragment, useEffect, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { InsightView } from "@/components/InsightView";
import { CoachInsight, DaySummary, GoalDefinition, GoalProgress, Measurement, MeasurementKind, MedicalRecord, TrendsPayload, TrendPoint } from "@/lib/types";

// Device-goal metricKey → the Trends series it overlays.
const GOAL_SERIES: Record<string, SeriesKey> = {
  steps: "steps",
  weightKg: "weightKg",
  restingHeartRate: "restingHr",
  sleepHours: "sleepMin",
};

// The sleep goal is in hours but the sleepMin series is in minutes, so its
// overlay line/band must be scaled to the series unit.
const SERIES_SCALE: Record<string, number> = { sleepHours: 60 };

const STATUS_COLOR: Record<string, string> = {
  met: "var(--activity)",
  on_track: "var(--food)",
  needs_attention: "var(--heart)",
  no_data: "var(--ink-soft)",
};

type GoalOverlay = { label: string; line?: number; band?: [number, number]; statusColor: string };

/** Build per-series goal overlays from active, Trends-visible device goals. */
function buildGoalOverlays(goals: GoalDefinition[], progress: GoalProgress[]): Partial<Record<SeriesKey, GoalOverlay>> {
  const byId = new Map(progress.map((p) => [p.goalId, p]));
  const out: Partial<Record<SeriesKey, GoalOverlay>> = {};
  for (const g of goals) {
    if (!g.active || !g.showOnTrends || g.source !== "device") continue;
    const sk = GOAL_SERIES[g.metricKey];
    if (!sk) continue;
    const statusColor = STATUS_COLOR[byId.get(g.id)?.status ?? "no_data"];
    const unit = g.unit ? ` ${g.unit}` : "";
    const k = SERIES_SCALE[g.metricKey] ?? 1; // scale target to the series' unit
    if (g.direction === "lower_is_better" && g.targetMax != null) {
      out[sk] = { label: `≤ ${g.targetMax.toLocaleString()}${unit}`, line: g.targetMax * k, statusColor };
    } else if (g.direction === "higher_is_better" && g.targetMin != null) {
      out[sk] = { label: `≥ ${g.targetMin.toLocaleString()}${unit}`, line: g.targetMin * k, statusColor };
    } else if (g.direction === "target_range" && g.targetMin != null && g.targetMax != null) {
      out[sk] = { label: `${g.targetMin.toLocaleString()}–${g.targetMax.toLocaleString()}${unit}`, band: [g.targetMin * k, g.targetMax * k], statusColor };
    }
  }
  return out;
}

/** Goal overlay (target line/band + status chip) for any goal — used by the
 *  dynamic lab/measurement cards that aren't a base series. */
function overlayForGoal(g: GoalDefinition, p?: GoalProgress): GoalOverlay {
  const statusColor = STATUS_COLOR[p?.status ?? "no_data"];
  const unit = g.unit ? ` ${g.unit}` : "";
  if (g.direction === "lower_is_better" && g.targetMax != null) return { label: `≤ ${g.targetMax}${unit}`, line: g.targetMax, statusColor };
  if (g.direction === "higher_is_better" && g.targetMin != null) return { label: `≥ ${g.targetMin}${unit}`, line: g.targetMin, statusColor };
  if (g.direction === "target_range" && g.targetMin != null && g.targetMax != null)
    return { label: `${g.targetMin}–${g.targetMax}${unit}`, band: [g.targetMin, g.targetMax], statusColor };
  return { label: "", statusColor };
}

/** Civil-day list start..end inclusive (yyyy-MM-dd). */
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    const nx = new Date(d + "T12:00:00Z");
    nx.setUTCDate(nx.getUTCDate() + 1);
    d = nx.toISOString().slice(0, 10);
  }
  return out;
}

/** Daily series for a manually logged measurement kind (latest reading per day). */
function measurementSeries(ms: Measurement[], kind: MeasurementKind, dates: string[]): { points: TrendPoint[]; unit: string } {
  const byDate = new Map<string, { at: string; value: number }>();
  let latest: { at: string; unit: string } | null = null;
  for (const m of ms) {
    if (m.kind !== kind) continue;
    const day = m.at.slice(0, 10);
    const prev = byDate.get(day);
    if (!prev || m.at > prev.at) byDate.set(day, { at: m.at, value: m.value });
    if (!latest || m.at > latest.at) latest = { at: m.at, unit: m.unit };
  }
  return { points: dates.map((d) => ({ date: d, value: byDate.get(d)?.value ?? null })), unit: latest?.unit ?? "" };
}

/** Daily series for a canonical lab key from records (first value per report day). */
function labSeries(records: MedicalRecord[], key: string, dates: string[]): { points: TrendPoint[]; unit: string } {
  const byDate = new Map<string, number>();
  let unit = "";
  for (const r of records) {
    const day = r.reportDate || r.uploadedAt.slice(0, 10);
    for (const m of r.metrics ?? []) {
      if (m.key !== key || m.value == null) continue;
      if (!byDate.has(day)) byDate.set(day, m.value);
      if (m.unit) unit = m.unit;
    }
  }
  return { points: dates.map((d) => ({ date: d, value: byDate.get(d) ?? null })), unit };
}

// Manual measurement kinds that aren't already a base Trends series.
const MANUAL_CARDS: { kind: MeasurementKind; label: string; color: string }[] = [
  { kind: "glucose", label: "Glucose", color: "var(--breath)" },
  { kind: "body-temp", label: "Body temperature", color: "var(--heart)" },
  { kind: "body-fat", label: "Body fat", color: "var(--food)" },
];

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
  const [days, setDays] = useState(7);
  const [data, setData] = useState<TrendsPayload | null>(null);
  const [goalsData, setGoalsData] = useState<{ goals: GoalDefinition[]; progress: GoalProgress[] }>({ goals: [], progress: [] });
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [records, setRecords] = useState<MedicalRecord[]>([]);

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

  // Goals (overlays on base cards + dynamic lab cards), manual measurements, and
  // lab records — the sources that make the metric set dynamic.
  useEffect(() => {
    fetch("/api/goals")
      .then((r) => r.json())
      .then((d) => setGoalsData({ goals: d.goals ?? [], progress: d.progress ?? [] }))
      .catch(() => {});
    fetch("/api/measurements?limit=1000")
      .then((r) => r.json())
      .then((d) => setMeasurements(d.measurements ?? []))
      .catch(() => {});
    fetch("/api/records")
      .then((r) => r.json())
      .then((d) => setRecords(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

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

  // Device-goal overlays for the base cards (steps/RHR/weight/sleep).
  const goalOverlays = buildGoalOverlays(goalsData.goals, goalsData.progress);

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
                    goal={goalOverlays[c.key]}
                  />
                ))}
              </Fragment>
            );
          })}

          {/* Dynamic cards: manually logged metrics + lab-backed goals (the
              metric set grows as the user logs values or sets lab goals). */}
          {(() => {
            const dates = dateRange(data.range.start, data.range.end);
            const manualCards = MANUAL_CARDS.flatMap((c) => {
              const s = measurementSeries(measurements, c.kind, dates);
              return s.points.some((p) => p.value != null) ? [{ ...c, points: s.points, unit: s.unit }] : [];
            });
            const labCards = goalsData.goals
              .filter((g) => g.active && g.source === "lab")
              .flatMap((g) => {
                const s = labSeries(records, g.metricKey, dates);
                if (!s.points.some((p) => p.value != null)) return [];
                const p = goalsData.progress.find((x) => x.goalId === g.id);
                return [{ goal: g, points: s.points, unit: s.unit || g.unit, overlay: overlayForGoal(g, p) }];
              });
            if (!manualCards.length && !labCards.length) return null;
            return (
              <Fragment>
                <h2 className="section-title desk-span rise rise-1">Logged &amp; lab metrics</h2>
                {manualCards.map((c) => (
                  <TrendCard key={c.kind} rise={2} label={c.label} color={c.color} points={c.points} unit={c.unit} fmt={(v) => v.toFixed(1)} mode="range" />
                ))}
                {labCards.map((c) => (
                  <TrendCard
                    key={c.goal.id}
                    rise={2}
                    label={c.goal.label}
                    color="var(--food)"
                    points={c.points}
                    unit={c.unit}
                    fmt={(v) => v.toFixed(2)}
                    mode="range"
                    lowerBetter={c.goal.direction === "lower_is_better"}
                    goal={c.overlay}
                  />
                ))}
              </Fragment>
            );
          })()}

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
  goal,
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
  /** Optional goal overlay: a dashed target line / band + a status-tinted chip. */
  goal?: { label: string; line?: number; band?: [number, number]; statusColor: string };
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
      {goal && (
        <div style={{ marginTop: 6 }}>
          <span
            className="badge"
            style={{ background: `color-mix(in srgb, ${goal.statusColor} 16%, transparent)`, color: goal.statusColor, fontSize: 11 }}
          >
            Goal {goal.label}
          </span>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Sparkline
          values={vals}
          color={color}
          fill
          height={64}
          tipLabels={tipDates}
          tipFormat={(v) => `${fmt(v)} ${unit}`}
          target={goal?.line}
          targetBand={goal?.band}
        />
      </div>
    </section>
  );
}
