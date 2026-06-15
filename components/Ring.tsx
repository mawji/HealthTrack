"use client";

import { useEffect, useState } from "react";

/** Animated progress ring (Apple-Health-style activity ring). */
export default function Ring({
  progress,
  size = 120,
  stroke = 11,
  color,
  track,
  children,
}: {
  progress: number; // 0..1+
  size?: number;
  stroke?: number;
  color: string;
  track: string;
  children?: React.ReactNode;
}) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setP(Math.min(progress, 1)));
    return () => cancelAnimationFrame(t);
  }, [progress]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{ transition: "stroke-dashoffset 1.3s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
