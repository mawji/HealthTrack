"use client";

import { useEffect, useState, useId } from "react";

type Device = { name?: string; displayName?: string; deviceVersion?: string; overrideLabel?: string; batteryLevel?: number | null };

/** Compact battery capsule shown next to the avatar: a stadium that fills with
 *  charge level and shows the percentage number *inside* the icon — light where
 *  it sits over the filled portion, dark where it sits over the empty track.
 *  Device label on hover (title). Reads the local-override-applied label from
 *  /api/devices, so a relabeled device shows its friendly name. */
export default function BatteryIndicator({ showLabel = false }: { showLabel?: boolean }) {
  const [device, setDevice] = useState<Device | null>(null);
  const rawId = useId();
  const idSuffix = rawId.replace(/:/g, "");
  const batCapsuleId = `bat-capsule-${idSuffix}`;
  const batChargeId = `bat-charge-${idSuffix}`;

  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d: { devices?: Device[] }) =>
        setDevice((d.devices ?? []).find((x) => x.batteryLevel != null) ?? null)
      )
      .catch(() => {});
  }, []);

  if (!device || device.batteryLevel == null) return null;

  const pct = Math.max(0, Math.min(100, Math.round(device.batteryLevel)));
  const label = device.displayName || device.deviceVersion || device.name?.split("/").pop() || "Device";

  let fill = "var(--activity)";
  if (pct <= 20) {
    fill = "var(--heart)";
  } else if (pct <= 50) {
    fill = "var(--food)";
  }

  const W = 42;
  const H = 21;
  const fillW = (pct / 100) * W;

  const svgContent = (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <clipPath id={batCapsuleId}>
          <rect x="0" y="0" width={W} height={H} rx={H / 2} />
        </clipPath>
        <clipPath id={batChargeId}>
          <rect x="0" y="0" width={fillW} height={H} />
        </clipPath>
      </defs>
      {/* empty track */}
      <rect x="0" y="0" width={W} height={H} rx={H / 2} fill="color-mix(in srgb, var(--ink) 12%, transparent)" />
      {/* charged portion */}
      <g clipPath={`url(#${batCapsuleId})`}>
        <rect x="0" y="0" width={fillW} height={H} fill={fill} />
      </g>
      {/* outer capsule border */}
      <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx={(H - 1.5) / 2} fill="none" stroke="var(--hairline)" strokeWidth="1.5" />
      {/* number over the empty track */}
      <text x={W / 2} y={H / 2 + 0.5} textAnchor="middle" dominantBaseline="middle"
        fontSize="11.5" fontWeight="800" fontFamily="var(--font-ui)" fill="var(--ink-soft)">
        {pct}
      </text>
      {/* same number, clipped to the charged portion, in the contrasting colour */}
      <g clipPath={`url(#${batChargeId})`}>
        <text x={W / 2} y={H / 2 + 0.5} textAnchor="middle" dominantBaseline="middle"
          fontSize="11.5" fontWeight="800" fontFamily="var(--font-ui)" fill="var(--bg)">
          {pct}
        </text>
      </g>
    </svg>
  );

  if (showLabel) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1 }} title={label}>
          {label}
        </span>
        <span
          title={`${label} · ${pct}%`}
          aria-label={`${label} battery ${pct}%`}
          style={{ display: "inline-flex", alignItems: "center", flex: "none", cursor: "default" }}
        >
          {svgContent}
        </span>
      </div>
    );
  }

  return (
    <span
      title={`${label} · ${pct}%`}
      aria-label={`${label} battery ${pct}%`}
      style={{ display: "inline-flex", alignItems: "center", flex: "none", cursor: "default" }}
    >
      {svgContent}
    </span>
  );
}
