"use client";

import { SleepSegment, SleepStageName } from "@/lib/types";

const ROWS: { stage: SleepStageName; label: string; color: string }[] = [
  { stage: "wake", label: "Awake", color: "var(--heart)" },
  { stage: "rem", label: "REM", color: "var(--breath)" },
  { stage: "light", label: "Light", color: "color-mix(in srgb, var(--sleep) 45%, var(--bg-raised))" },
  { stage: "deep", label: "Deep", color: "var(--sleep)" },
];

function clock(start: string, plusMin: number) {
  const [h, m] = start.split(":").map(Number);
  const total = (h * 60 + m + plusMin) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

/**
 * Google-Health-style sleep hypnogram: one row band per stage, rounded
 * segments along a shared time axis.
 */
export default function Hypnogram({
  segments,
  startTime,
}: {
  segments: SleepSegment[];
  startTime: string;
}) {
  const total = Math.max(...segments.map((s) => s.startMin + s.durMin), 1);
  const W = 520;
  const bandH = 13;
  const labelH = 17;
  const rowGap = 7;
  const rowPitch = labelH + bandH + rowGap;
  const axisH = 16;
  const H = ROWS.length * rowPitch + axisH;

  const sums = ROWS.map((r) =>
    segments.filter((s) => s.stage === r.stage).reduce((a, s) => a + s.durMin, 0)
  );

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {ROWS.map((row, ri) => {
        const yLabel = ri * rowPitch + 12;
        const yBand = ri * rowPitch + labelH;
        return (
          <g key={row.stage}>
            <text x={0} y={yLabel} fontSize={11} fontWeight={600} fill="var(--ink-soft)">
              {row.label} · {fmtDur(sums[ri])}
            </text>
            {/* faint track */}
            <rect x={0} y={yBand} width={W} height={bandH} rx={bandH / 2} fill="var(--bg-inset)" />
            {segments
              .filter((s) => s.stage === row.stage)
              .map((s, i) => (
                <rect
                  key={i}
                  x={(s.startMin / total) * W}
                  y={yBand}
                  width={Math.max((s.durMin / total) * W, 4)}
                  height={bandH}
                  rx={bandH / 2}
                  fill={row.color}
                />
              ))}
          </g>
        );
      })}
      {[0, 0.5, 1].map((f) => (
        <text
          key={f}
          x={f * W}
          y={H - 3}
          fontSize={10}
          fill="var(--ink-faint)"
          textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
        >
          {clock(startTime, Math.round(total * f))}
        </text>
      ))}
    </svg>
  );
}
