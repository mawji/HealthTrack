"use client";

import { useState } from "react";

function Tip({ leftPct, text }: { leftPct: number; text: string }) {
  return (
    <div
      className="chart-tip"
      style={{ left: `${Math.min(Math.max(leftPct, 8), 92)}%` }}
    >
      {text}
    </div>
  );
}

/** Smooth SVG sparkline with optional dots, axis labels, and hover values. */
export function Sparkline({
  values,
  color,
  width = 300,
  height = 56,
  fill = false,
  ecg = false,
  dots = false,
  labels,
  tipLabels,
  tipFormat = (v) => v.toLocaleString(),
  target,
  targetBand,
}: {
  values: (number | null)[];
  color: string;
  width?: number;
  height?: number;
  fill?: boolean;
  ecg?: boolean;
  dots?: boolean;
  labels?: string[];
  tipLabels?: string[]; // hover prefix per point (falls back to labels)
  tipFormat?: (v: number) => string;
  target?: number; // optional dashed goal-target line
  targetBand?: [number, number]; // optional shaded goal target range [lo, hi]
}) {
  const [hover, setHover] = useState<number | null>(null);

  const pts = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null && !Number.isNaN(p.v));
  if (pts.length < 2) {
    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="11" fill="var(--ink-faint)">
          no data yet
        </text>
      </svg>
    );
  }
  // Keep any goal target inside the y-domain so its line/band is always visible.
  const domain = pts.map((p) => p.v);
  if (target != null) domain.push(target);
  if (targetBand) domain.push(targetBand[0], targetBand[1]);
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const span = max - min || 1;
  const pad = 5;
  const labelH = labels ? 13 : 0;
  const plotH = height - labelH;
  // Anchor the x-axis to the data's own extent so a sparse series (e.g. only
  // recent days populated) still spans the full width instead of bunching into
  // the right edge. Dense series (first..last covers everything) are unchanged.
  const i0 = pts[0].i;
  const iN = pts[pts.length - 1].i;
  const ispan = iN - i0 || 1;
  const x = (i: number) => ((i - i0) / ispan) * (width - 8) + 4;
  const y = (v: number) => plotH - pad - ((v - min) / span) * (plotH - 2 * pad);

  let d = `M ${x(pts[0].i)} ${y(pts[0].v)}`;
  for (let k = 1; k < pts.length; k++) {
    const prev = pts[k - 1];
    const cur = pts[k];
    const mx = (x(prev.i) + x(cur.i)) / 2;
    d += ` C ${mx} ${y(prev.v)}, ${mx} ${y(cur.v)}, ${x(cur.i)} ${y(cur.v)}`;
  }

  const last = pts[pts.length - 1];

  // nearest point with data to a hovered fraction of the chart
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    const target = i0 + f * ispan;
    let best = pts[0].i;
    for (const p of pts) if (Math.abs(p.i - target) < Math.abs(best - target)) best = p.i;
    setHover(best);
  }

  const hoverVal = hover !== null ? values[hover] : null;

  return (
    <div className="chart-wrap">
      {hover !== null && hoverVal != null && (
        <Tip
          leftPct={((hover - i0) / ispan) * 100}
          text={`${(tipLabels ?? labels)?.[hover] ? `${(tipLabels ?? labels)![hover]} · ` : ""}${tipFormat(hoverVal)}`}
        />
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {targetBand && (
          <rect
            x={4}
            y={Math.min(y(targetBand[0]), y(targetBand[1]))}
            width={width - 8}
            height={Math.abs(y(targetBand[0]) - y(targetBand[1]))}
            fill="var(--activity)"
            opacity={0.08}
          />
        )}
        {target != null && (
          <line
            x1={4}
            x2={width - 4}
            y1={y(target)}
            y2={y(target)}
            stroke="var(--ink-soft)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}
        {fill && (
          <path
            d={`${d} L ${x(last.i)} ${plotH} L ${x(pts[0].i)} ${plotH} Z`}
            fill={color}
            opacity={0.09}
          />
        )}
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          className={ecg ? "ecg-path" : undefined}
        />
        {dots &&
          pts.map((p) => (
            <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.8} fill={color} stroke="var(--bg-raised)" strokeWidth={1} />
          ))}
        {hover !== null && hoverVal != null && (
          <circle cx={x(hover)} cy={y(hoverVal)} r={4.5} fill={color} stroke="var(--bg-raised)" strokeWidth={1.5} />
        )}
        <circle cx={x(last.i)} cy={y(last.v)} r={3.2} fill={color} className={ecg ? "pulsing" : undefined} />
        {labels &&
          labels.map((l, i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 2}
              fontSize={8.5}
              fontWeight={600}
              fill="var(--ink-faint)"
              textAnchor="middle"
            >
              {l}
            </text>
          ))}
      </svg>
    </div>
  );
}

/** Diverging bar chart around a zero baseline — e.g. net kcal surplus/deficit per day. */
export function SignedBars({
  values,
  posColor,
  negColor,
  highlight = values.length - 1,
  height = 56,
  labels,
  tipLabels,
  tipFormat = (v) => v.toLocaleString(),
}: {
  values: number[];
  posColor: string;
  negColor: string;
  highlight?: number;
  height?: number;
  labels?: string[];
  tipLabels?: string[];
  tipFormat?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);
  const labelH = labels ? 16 : 0;
  const barsH = height - labelH;
  return (
    <div className="chart-wrap">
      {hover !== null && values[hover] != null && (
        <Tip
          leftPct={((hover + 0.5) / values.length) * 100}
          text={`${(tipLabels ?? labels)?.[hover] ? `${(tipLabels ?? labels)![hover]} · ` : ""}${tipFormat(values[hover])}`}
        />
      )}
      <div style={{ display: "flex", gap: 6 }} onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => {
          const color = v >= 0 ? posColor : negColor;
          const mag = `${v === 0 ? 0 : Math.max((Math.abs(v) / maxAbs) * 100, 3)}%`;
          const bg =
            i === hover
              ? `color-mix(in srgb, ${color} 75%, white)`
              : i === highlight
                ? color
                : `color-mix(in srgb, ${color} 28%, transparent)`;
          const fill = {
            width: "100%",
            height: mag,
            background: bg,
            transition: "height 0.9s cubic-bezier(0.22,1,0.36,1), background 0.15s",
          } as const;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(i)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              <div style={{ display: "flex", flexDirection: "column", width: "100%", height: barsH }}>
                {/* positive half: bar grows down to the zero line */}
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                  {v > 0 && <div style={{ ...fill, borderRadius: "6px 6px 0 0" }} />}
                </div>
                <div style={{ height: 1, background: "var(--hairline)" }} />
                {/* negative half: bar grows down from the zero line */}
                <div style={{ flex: 1, display: "flex", alignItems: "flex-start" }}>
                  {v < 0 && <div style={{ ...fill, borderRadius: "0 0 6px 6px" }} />}
                </div>
              </div>
              {labels && <span style={{ fontSize: 9.5, color: "var(--ink-faint)", fontWeight: 600, marginTop: 3 }}>{labels[i]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tiny bar chart for weekly comparisons, with hover values. */
export function Bars({
  values,
  color,
  highlight = values.length - 1,
  height = 56,
  labels,
  tipLabels,
  tipFormat = (v) => v.toLocaleString(),
  baseline = 0,
}: {
  values: number[];
  color: string;
  highlight?: number;
  height?: number;
  labels?: string[];
  tipLabels?: string[];
  tipFormat?: (v: number) => string;
  // Value mapped to the bottom of the chart. Defaults to 0 (bars scale from
  // zero). Set above 0 for series with a high constant floor — e.g. daily
  // calories burned — so day-to-day variation isn't compressed into a flat band.
  baseline?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, baseline + 1);
  const floor = Math.min(baseline, ...values);
  const span = max - floor || 1;
  return (
    <div className="chart-wrap">
      {hover !== null && values[hover] != null && (
        <Tip
          leftPct={((hover + 0.5) / values.length) * 100}
          text={`${(tipLabels ?? labels)?.[hover] ? `${(tipLabels ?? labels)![hover]} · ` : ""}${tipFormat(values[hover])}`}
        />
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height }} onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(i)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}
          >
            <div
              style={{
                width: "100%",
                borderRadius: 6,
                height: `${Math.max(((v - floor) / span) * 100, 4)}%`,
                background:
                  i === hover
                    ? `color-mix(in srgb, ${color} 75%, white)`
                    : i === highlight
                      ? color
                      : `color-mix(in srgb, ${color} 28%, transparent)`,
                transition: "height 0.9s cubic-bezier(0.22,1,0.36,1), background 0.15s",
              }}
            />
            {labels && <span style={{ fontSize: 9.5, color: "var(--ink-faint)", fontWeight: 600 }}>{labels[i]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
