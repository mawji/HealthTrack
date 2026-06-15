"use client";

import { useState } from "react";

/**
 * Apple-Health-style heart rate chart: vertical min→max range bars per
 * interval with MAX/MIN annotations and hover values.
 */
export default function RangeBars({
  points,
  color,
  width = 320,
  height = 110,
}: {
  points: { time: string; min: number; max: number }[];
  color: string;
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="11" fill="var(--ink-faint)">
          no data yet
        </text>
      </svg>
    );
  }
  const padTop = 18;
  const padBottom = 16;
  const lo = Math.min(...points.map((p) => p.min));
  const hi = Math.max(...points.map((p) => p.max));
  const span = hi - lo || 1;
  const y = (v: number) => padTop + (1 - (v - lo) / span) * (height - padTop - padBottom);
  const slot = width / points.length;
  const barW = Math.min(slot * 0.55, 7);

  const maxIdx = points.findIndex((p) => p.max === hi);
  const minIdx = points.findIndex((p) => p.min === lo);

  // time axis labels: first, middle, last
  const labels = [0, Math.floor(points.length / 2), points.length - 1];

  return (
    <div className="chart-wrap">
      {hover !== null && points[hover] && (
        <div className="chart-tip" style={{ left: `${Math.min(Math.max(((hover + 0.5) / points.length) * 100, 10), 90)}%` }}>
          {points[hover].time} · {points[hover].min}–{points[hover].max} bpm
        </div>
      )}
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - rect.left) / rect.width;
        setHover(Math.min(points.length - 1, Math.max(0, Math.floor(f * points.length))));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {/* gridlines */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0}
          x2={width}
          y1={padTop + f * (height - padTop - padBottom)}
          y2={padTop + f * (height - padTop - padBottom)}
          stroke="var(--hairline)"
          strokeWidth={0.6}
        />
      ))}
      {points.map((p, i) => {
        const x = i * slot + slot / 2;
        const yTop = y(p.max);
        const yBot = Math.max(y(p.min), yTop + barW); // min visual length
        return (
          <rect
            key={i}
            className="range-bar"
            x={x - barW / 2}
            y={yTop}
            width={barW}
            height={yBot - yTop}
            rx={barW / 2}
            fill={i === hover ? `color-mix(in srgb, ${color} 70%, white)` : color}
            opacity={0.92}
            style={{ animationDelay: `${0.15 + (i / points.length) * 0.5}s` }}
          />
        );
      })}
      {/* MAX / MIN annotations (halo keeps them readable over bars) */}
      <text
        x={Math.min(maxIdx * slot + slot / 2 + 6, width - 34)}
        y={y(hi) - 5}
        fontSize={9.5}
        fontWeight={700}
        fill={color}
        stroke="var(--bg-raised)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        MAX {hi}
      </text>
      <text
        x={Math.min(minIdx * slot + slot / 2 + 6, width - 32)}
        y={Math.min(y(lo) + 14, height - 18)}
        fontSize={9.5}
        fontWeight={700}
        fill="var(--ink-soft)"
        stroke="var(--bg-raised)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        MIN {lo}
      </text>
      {labels.map((i) => (
        <text
          key={i}
          x={i * slot + slot / 2}
          y={height - 3}
          fontSize={9}
          fill="var(--ink-faint)"
          textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
        >
          {points[i].time}
        </text>
      ))}
    </svg>
    </div>
  );
}
