"use client";

/**
 * Apple-Health-style 24h sleep clock: a dial with an arc sweeping from
 * bedtime to wake time, moon at sleep start, sun at wake.
 */
export default function SleepClock({
  start, // "23:12"
  end, // "06:48"
  durationMin,
  size = 150,
}: {
  start: string;
  end: string;
  durationMin: number;
  size?: number;
}) {
  const toAngle = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return ((h * 60 + m) / 1440) * 360 - 90; // midnight at top
  };
  const a0 = toAngle(start);
  let a1 = toAngle(end);
  if (a1 <= a0) a1 += 360;

  const c = size / 2;
  const rArc = c - 12;
  const rTicks = c - 4;
  const pt = (angle: number, r: number) => {
    const rad = (angle * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  };
  const [x0, y0] = pt(a0, rArc);
  const [x1, y1] = pt(a1, rArc);
  const large = a1 - a0 > 180 ? 1 : 0;

  // hour ticks, bolder at 0/6/12/18
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const ang = (i / 24) * 360 - 90;
    const major = i % 6 === 0;
    const [tx0, ty0] = pt(ang, rTicks - (major ? 5 : 3));
    const [tx1, ty1] = pt(ang, rTicks);
    return { tx0, ty0, tx1, ty1, major };
  });

  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: "none" }}>
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.tx0}
          y1={t.ty0}
          x2={t.tx1}
          y2={t.ty1}
          stroke={t.major ? "var(--ink-soft)" : "var(--hairline)"}
          strokeWidth={t.major ? 1.8 : 1}
          strokeLinecap="round"
        />
      ))}
      {/* dial track */}
      <circle cx={c} cy={c} r={rArc} fill="none" stroke="var(--hairline)" strokeWidth={7} opacity={0.55} />
      {/* sleep arc */}
      <path
        d={`M ${x0} ${y0} A ${rArc} ${rArc} 0 ${large} 1 ${x1} ${y1}`}
        fill="none"
        stroke="var(--sleep)"
        strokeWidth={7}
        strokeLinecap="round"
      />
      {/* moon at bedtime */}
      <g transform={`translate(${x0}, ${y0})`}>
        <circle r={8.5} fill="var(--sleep)" />
        <path
          d="M2.6 -1.2 A3.4 3.4 0 1 1 -1.6 -3 A4.3 4.3 0 0 0 2.6 -1.2 Z"
          fill="var(--bg-raised)"
          transform="translate(0.3, 1)"
        />
      </g>
      {/* sun at wake */}
      <g transform={`translate(${x1}, ${y1})`}>
        <circle r={8.5} fill="var(--food)" />
        <circle r={3} fill="var(--bg-raised)" />
        {Array.from({ length: 8 }, (_, i) => {
          const ang = (i / 8) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={4.6 * Math.cos(ang)}
              y1={4.6 * Math.sin(ang)}
              x2={6.2 * Math.cos(ang)}
              y2={6.2 * Math.sin(ang)}
              stroke="var(--bg-raised)"
              strokeWidth={1.2}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      {/* center readout */}
      <text
        x={c}
        y={c - 4}
        textAnchor="middle"
        fontSize={size * 0.17}
        fontFamily="var(--font-ui)"
        style={{ fontVariantNumeric: "tabular-nums" }}
        fill="var(--ink)"
        fontWeight={600}
      >
        {h}h {m}m
      </text>
      <text x={c} y={c + 15} textAnchor="middle" fontSize={10.5} fill="var(--ink-soft)">
        {start} → {end}
      </text>
    </svg>
  );
}
