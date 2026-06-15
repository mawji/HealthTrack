"use client";

import React from "react";
import GoalBar from "./GoalBar";
import SleepClock from "./SleepClock";
import RangeBars from "./RangeBars";
import { Sparkline, Bars } from "./Sparkline";
import { DaySummary } from "@/lib/types";

/**
 * Dispatcher for the chat viz protocol: the model emits ```viz fenced blocks
 * containing one JSON spec; this maps spec.type to the matching card.
 */
export function VizCard({ spec, week = [] }: { spec: any; week?: DaySummary[] }) {
  if (!spec || typeof spec !== "object") return null;
  switch (spec.type) {
    case "steps":
      return <StepsCard steps={spec.steps} goal={spec.goal} distance={spec.distance} floors={spec.floors} kcal={spec.kcal} />;
    case "heart":
      return <HeartRateChart resting={spec.resting} points={spec.points} zones={spec.zones} />;
    case "sleep":
      return (
        <SleepCard
          durationMin={spec.durationMin}
          efficiency={spec.efficiency}
          startTime={spec.startTime}
          endTime={spec.endTime}
          deep={spec.deep}
          light={spec.light}
          rem={spec.rem}
          wake={spec.wake}
        />
      );
    case "vitals":
      return <VitalsCard spo2={spec.spo2} hrv={spec.hrv} breathing={spec.breathing} weight={spec.weight} week={week} />;
    case "energy":
      return <EnergyBalanceCard caloriesIn={spec.caloriesIn} caloriesOut={spec.caloriesOut} />;
    case "weeklySteps":
      return <WeeklyStepsChart values={spec.values} labels={spec.labels} />;
    case "metric":
      return (
        <DataCard
          title={spec.title ?? "Metric"}
          value={spec.value}
          color={spec.color}
          progress={spec.progress}
          details={spec.details}
          vitals={spec.vitals}
          chartType={spec.chartType ?? "none"}
          chartData={spec.chartData}
          chartLabels={spec.chartLabels}
        />
      );
    default:
      return null;
  }
}

/** Skeleton shown while a viz block is still streaming in. */
export function VizPlaceholder() {
  return (
    <div
      className="card pulsing"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      <div style={{ height: 10, width: "40%", borderRadius: 5, background: "var(--hairline)" }} />
      <div style={{ height: 26, width: "55%", borderRadius: 7, background: "var(--hairline)", marginTop: 12 }} />
      <div style={{ height: 12, width: "100%", borderRadius: 6, background: "var(--hairline)", marginTop: 12 }} />
    </div>
  );
}

// 1. StepsCard
export function StepsCard({
  steps = 0,
  goal = 10000,
  distance = 0,
  floors = 0,
  kcal = 0,
}: {
  steps?: number;
  goal?: number;
  distance?: number;
  floors?: number;
  kcal?: number;
}) {
  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      <div className="card-label" style={{ color: "var(--activity)" }}>
        <span className="dot" style={{ background: "var(--activity)" }} />
        Movement Summary
      </div>
      <div className="row" style={{ gap: 16, marginTop: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
            <span className="display-num" style={{ fontSize: 30, color: "var(--activity)" }}>
              {Number(steps).toLocaleString()}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>steps</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <GoalBar value={Number(steps)} goal={Number(goal)} color="var(--activity)" />
          </div>
          <div className="row" style={{ gap: 12, marginTop: 12, fontSize: 11.5, color: "var(--ink-soft)", flexWrap: "wrap" }}>
            <span><strong>{Number(distance).toFixed(1)}</strong> km</span>
            <span><strong>{Number(floors)}</strong> floors</span>
            <span><strong>{Number(kcal).toLocaleString()}</strong> kcal</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 2. HeartRateChart
export function HeartRateChart({
  resting,
  points = [],
  zones = [],
}: {
  resting?: number;
  points?: { time: string; min: number; max: number }[];
  zones?: { name: string; minutes: number }[];
}) {
  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-label" style={{ color: "var(--heart)" }}>
          <span className="dot" style={{ background: "var(--heart)" }} />
          Heart Rate
        </div>
        {resting && (
          <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>
            resting <strong style={{ color: "var(--heart)" }}>{resting}</strong> bpm
          </span>
        )}
      </div>
      {points && points.length >= 2 && (
        <div style={{ marginTop: 10 }}>
          <RangeBars points={points} color="var(--heart)" width={300} height={96} />
        </div>
      )}
      {zones && zones.length > 0 && (
        <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {zones.filter((z) => z.minutes > 0).map((z) => (
            <span key={z.name} className="badge" style={{ background: "var(--heart-soft)", color: "var(--heart)", fontSize: 10, padding: "2px 6px" }}>
              {z.name} {z.minutes}m
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// 3. SleepCard
export function SleepCard({
  durationMin = 0,
  efficiency = 0,
  startTime = "—",
  endTime = "—",
  deep = 0,
  light = 0,
  rem = 0,
  wake = 0,
}: {
  durationMin?: number;
  efficiency?: number;
  startTime?: string;
  endTime?: string;
  deep?: number;
  light?: number;
  rem?: number;
  wake?: number;
}) {
  const stageTotal = Number(deep) + Number(light) + Number(rem) + Number(wake);
  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-label" style={{ color: "var(--sleep)" }}>
          <span className="dot" style={{ background: "var(--sleep)" }} />
          Sleep Analysis
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{efficiency}% efficiency</span>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10, alignItems: "center" }}>
        <SleepClock start={startTime} end={endTime} durationMin={Number(durationMin)} size={110} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ height: 8, borderRadius: 4, overflow: "hidden", gap: 1.5, alignItems: "stretch" }}>
            {stageTotal > 0 && (
              <>
                <div title={`deep: ${deep}m`} style={{ width: `${(Number(deep) / stageTotal) * 100}%`, background: "var(--sleep)" }} />
                <div title={`rem: ${rem}m`} style={{ width: `${(Number(rem) / stageTotal) * 100}%`, background: "color-mix(in srgb, var(--sleep) 62%, var(--bg-raised))" }} />
                <div title={`light: ${light}m`} style={{ width: `${(Number(light) / stageTotal) * 100}%`, background: "color-mix(in srgb, var(--sleep) 32%, var(--bg-raised))" }} />
                <div title={`wake: ${wake}m`} style={{ width: `${(Number(wake) / stageTotal) * 100}%`, background: "var(--hairline)" }} />
              </>
            )}
          </div>
          <div className="stack" style={{ gap: 4, marginTop: 8, fontSize: 11 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-soft)" }}>Deep</span>
              <strong>{deep}m</strong>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-soft)" }}>REM</span>
              <strong>{rem}m</strong>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-soft)" }}>Light</span>
              <strong>{light}m</strong>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-soft)" }}>Awake</span>
              <strong>{wake}m</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. VitalsCard
export function VitalsCard({
  spo2,
  hrv,
  breathing,
  weight,
  week = [],
}: {
  spo2?: number;
  hrv?: number;
  breathing?: number;
  weight?: number;
  week?: DaySummary[];
}) {
  const getSeries = (key: keyof DaySummary) => {
    if (!week || week.length === 0) return [null, null, null, null, null, null, null];
    return week.map((d) => d[key] as number | null);
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        width: "100%",
        maxWidth: 360,
        marginTop: 10,
        marginBottom: 10,
        alignSelf: "flex-start",
      }}
    >
      {spo2 != null && (
        <div className="card" style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--hairline)" }}>
          <div className="card-label" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: "var(--breath)" }} />
            SpO₂
          </div>
          <div className="display-num" style={{ fontSize: 18, marginTop: 4, color: "var(--breath)" }}>{spo2}%</div>
          {week && week.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Sparkline values={getSeries("spo2")} color="var(--breath)" height={20} width={120} />
            </div>
          )}
        </div>
      )}
      {hrv != null && (
        <div className="card" style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--hairline)" }}>
          <div className="card-label" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: "var(--heart)" }} />
            HRV
          </div>
          <div className="display-num" style={{ fontSize: 18, marginTop: 4, color: "var(--heart)" }}>{hrv} ms</div>
          {week && week.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Sparkline values={getSeries("hrv")} color="var(--heart)" height={20} width={120} />
            </div>
          )}
        </div>
      )}
      {breathing != null && (
        <div className="card" style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--hairline)" }}>
          <div className="card-label" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: "var(--breath)" }} />
            Breathing
          </div>
          <div className="display-num" style={{ fontSize: 18, marginTop: 4, color: "var(--breath)" }}>{breathing}/m</div>
          {week && week.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Sparkline values={getSeries("breathingRate")} color="var(--breath)" height={20} width={120} />
            </div>
          )}
        </div>
      )}
      {weight != null && (
        <div className="card" style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--hairline)" }}>
          <div className="card-label" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: "var(--food)" }} />
            Weight
          </div>
          <div className="display-num" style={{ fontSize: 18, marginTop: 4, color: "var(--food)" }}>{weight} kg</div>
          {week && week.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Sparkline values={getSeries("weightKg")} color="var(--food)" height={20} width={120} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 5. EnergyBalanceCard
export function EnergyBalanceCard({
  caloriesIn = 0,
  caloriesOut = 0,
}: {
  caloriesIn?: number;
  caloriesOut?: number;
}) {
  const balance = Number(caloriesIn) - Number(caloriesOut);
  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      <div className="card-label" style={{ color: "var(--food)" }}>
        <span className="dot" style={{ background: "var(--food)" }} />
        Energy Balance
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 10, alignItems: "baseline" }}>
        <div>
          <span className="display-num" style={{ fontSize: 20 }}>{Number(caloriesIn).toLocaleString()}</span>
          <span style={{ fontSize: 11, color: "var(--ink-soft)" }}> in</span>
        </div>
        <span className="display-num" style={{ fontSize: 15, color: balance > 0 ? "var(--food)" : "var(--activity)" }}>
          {balance > 0 ? "+" : ""}{balance.toLocaleString()}
        </span>
        <div>
          <span className="display-num" style={{ fontSize: 20 }}>{Number(caloriesOut).toLocaleString()}</span>
          <span style={{ fontSize: 11, color: "var(--ink-soft)" }}> out</span>
        </div>
      </div>
    </div>
  );
}

// 6. WeeklyStepsChart
export function WeeklyStepsChart({
  values = [],
  labels,
}: {
  values?: number[];
  labels?: string[];
}) {
  const dayLabels = labels || ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      <div className="card-label" style={{ color: "var(--activity)", marginBottom: 12 }}>
        <span className="dot" style={{ background: "var(--activity)" }} />
        Weekly Steps Trend
      </div>
      <Bars values={values} color="var(--activity)" labels={dayLabels} height={50} />
    </div>
  );
}

// 7. Dynamic DataCard (AG-UI system)
export function DataCard({
  title,
  value,
  color = "breath",
  progress,
  details = [],
  vitals = [],
  chartType = "none",
  chartData = [],
  chartLabels = [],
}: {
  title: string;
  value?: string;
  color?: string;
  progress?: number;
  details?: { label: string; value: string }[];
  vitals?: { label: string; value: string; color?: string; trend?: number[] }[];
  chartType?: "sparkline" | "bar" | "none";
  chartData?: number[];
  chartLabels?: string[];
}) {
  // Resolve theme color CSS variables if typical words are used
  const c = color.startsWith("var(--")
    ? color
    : ["sleep", "activity", "heart", "breath", "food"].includes(color)
    ? `var(--${color})`
    : color;

  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: 16,
        width: "100%",
        maxWidth: 360,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        alignSelf: "flex-start",
      }}
    >
      {/* Header */}
      <div className="card-label" style={{ color: c }}>
        <span className="dot" style={{ background: c }} />
        {title}
      </div>

      {/* Value */}
      {value != null && (
        <div className="display-num" style={{ fontSize: 26, marginTop: 8, color: c }}>
          {value}
        </div>
      )}

      {/* Progress Bar */}
      {progress != null && (
        <div style={{ marginTop: 8 }}>
          <GoalBar value={progress * 100} goal={100} color={c} />
        </div>
      )}

      {/* Details (Key-Value stack) */}
      {details && details.length > 0 && (
        <div className="stack" style={{ gap: 4, marginTop: 12, fontSize: 11.5 }}>
          {details.map((d, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-soft)" }}>{d.label}</span>
              <strong>{d.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Vitals Grid */}
      {vitals && vitals.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginTop: 12,
          }}
        >
          {vitals.map((v, i) => {
            const vc = v.color
              ? v.color.startsWith("var(--")
                ? v.color
                : ["sleep", "activity", "heart", "breath", "food"].includes(v.color)
                ? `var(--${v.color})`
                : v.color
              : "var(--ink)";
            return (
              <div
                key={i}
                className="card"
                style={{
                  padding: 10,
                  background: "var(--bg-raised)",
                  border: "1px solid var(--hairline)",
                }}
              >
                <div className="card-label" style={{ fontSize: 10.5, color: vc }}>
                  <span className="dot" style={{ background: vc }} />
                  {v.label}
                </div>
                <div className="display-num" style={{ fontSize: 16, marginTop: 4, color: vc }}>
                  {v.value}
                </div>
                {v.trend && v.trend.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Sparkline values={v.trend} color={vc} height={16} width={100} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Chart */}
      {chartType === "sparkline" && chartData && chartData.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Sparkline values={chartData} color={c} height={32} width={328} fill={true} />
        </div>
      )}

      {chartType === "bar" && chartData && chartData.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Bars values={chartData} color={c} labels={chartLabels || []} height={48} />
        </div>
      )}
    </div>
  );
}

