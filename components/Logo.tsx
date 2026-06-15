/** HealthTrack mark — five domain-colored bars tracing a heartbeat.
    Colors come from the theme CSS variables, so it adapts to dark/light. */
export default function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={Math.round((size * 52) / 46)}
      height={size}
      viewBox="0 0 52 46"
      fill="none"
      aria-hidden="true"
    >
      <rect x="0" y="15" width="8" height="16" rx="4" fill="var(--sleep)" />
      <rect x="11" y="9" width="8" height="28" rx="4" fill="var(--breath)" />
      <rect x="22" y="0" width="8" height="46" rx="4" fill="var(--heart)" />
      <rect x="33" y="8" width="8" height="30" rx="4" fill="var(--activity)" />
      <rect x="44" y="14" width="8" height="18" rx="4" fill="var(--food)" />
    </svg>
  );
}
