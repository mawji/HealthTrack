"use client";

/**
 * Google-Health-style chunky goal bar: rounded track, luminous fill,
 * milestone ticks at quarters, and a flag at the goal line.
 */
export default function GoalBar({
  value,
  goal,
  color,
  height = 16,
}: {
  value: number;
  goal: number;
  color: string;
  height?: number;
}) {
  const pct = Math.min(value / goal, 1) * 100;
  const over = value > goal;

  return (
    <div>
      <div
        style={{
          position: "relative",
          height,
          borderRadius: height / 2,
          background: `color-mix(in srgb, ${color} 14%, var(--bg-inset))`,
          overflow: "hidden",
        }}
      >
        <div
          className="bar-fill"
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            borderRadius: height / 2,
            background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, var(--bg-raised)), ${color})`,
            boxShadow: `0 0 14px color-mix(in srgb, ${color} 45%, transparent)`,
          }}
        />
        {/* milestone ticks */}
        {[25, 50, 75].map((m) => (
          <span
            key={m}
            style={{
              position: "absolute",
              left: `${m}%`,
              top: "28%",
              bottom: "28%",
              width: 2,
              borderRadius: 2,
              background: "color-mix(in srgb, var(--bg) 55%, transparent)",
            }}
          />
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
          {Math.round((value / goal) * 100)}% of goal
        </span>
        <span
          className="row"
          style={{ gap: 4, fontSize: 11.5, fontWeight: 600, color: over ? color : "var(--ink-soft)" }}
        >
          {/* goal flag */}
          <svg viewBox="0 0 24 24" width="12" height="12" fill={over ? color : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 21V4h11l-2.5 4L16 12H5" />
          </svg>
          {goal.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
