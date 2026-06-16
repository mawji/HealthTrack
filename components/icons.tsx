// Shared metric icon set. Each icon inherits currentColor so it can sit in
// a tinted chip. Keep strokes at 1.8 for visual consistency with the nav.

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const StepsIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M9 4.5c1.8 0 2.7 1.6 2.7 3.4 0 1.5-.6 2.6-1 4.1H7c-.3-1.5-.8-2.6-.8-4.1C6.2 6.1 7.2 4.5 9 4.5z" />
    <path d="M7.2 14h3.3v1.6a1.65 1.65 0 0 1-3.3 0z" />
    <path d="M15.5 8c1.7.3 2.3 1.9 2 3.6-.2 1.4-.9 2.4-1.5 3.7l-3.5-.6c-.1-1.5-.4-2.7-.2-4.1.3-1.7 1.5-2.9 3.2-2.6z" />
    <path d="M12.4 16.6l3.2.6-.3 1.5a1.6 1.6 0 0 1-3.2-.6z" />
  </svg>
);

export const HeartIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M12 20s-7-4.4-9-8.5C1.4 8.2 3.2 5 6.6 5c2 0 3.3 1 4.4 2.4h2C14.1 6 15.4 5 17.4 5c3.4 0 5.2 3.2 3.6 6.5-2 4.1-9 8.5-9 8.5z" />
  </svg>
);

export const PulseIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M3 12h3.5l2-4.5 3 9 2.5-6 1.5 1.5H21" />
  </svg>
);

export const MoonIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
  </svg>
);

export const FlameIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M12 21c-3.9 0-6.2-2.4-6.2-5.7 0-2.3 1.3-4 2.5-5.5.4-.5 1.2-.2 1.3.5.1.6.3 1.2.7 1.7.2-2.2 1.1-5.3 3.7-7.4.5-.4 1.3 0 1.2.7-.1 1.5.1 2.7 1.1 4 1 1.3 1.9 3 1.9 5.2 0 4.1-2.8 6.5-6.2 6.5z" />
  </svg>
);

export const LungsIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M12 4v6" />
    <path d="M12 10c-1 0-1.6.8-2.2 2-.9 1.8-1.8 2-3.3 2-1.6 0-2.5-1.1-2.5-3 0-3.4 2-7 4-7 1.3 0 1.6 1.2 1.6 2.6" />
    <path d="M12 10c1 0 1.6.8 2.2 2 .9 1.8 1.8 2 3.3 2 1.6 0 2.5-1.1 2.5-3 0-3.4-2-7-4-7-1.3 0-1.6 1.2-1.6 2.6" />
  </svg>
);

export const ScaleIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M8.5 9.5A5 5 0 0 1 15.5 9.5l-2.3 2.7a1.7 1.7 0 0 1-2.4 0z" />
  </svg>
);

export const DumbbellIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M7.5 8.5l8 8" />
    <rect x="2.5" y="9" width="3.4" height="6" rx="1.2" transform="rotate(-45 4.2 12)" />
    <rect x="5.6" y="6.6" width="3.4" height="8.5" rx="1.2" transform="rotate(-45 7.3 10.8)" />
    <rect x="15" y="8.9" width="3.4" height="8.5" rx="1.2" transform="rotate(-45 16.7 13.2)" />
    <rect x="18.1" y="9" width="3.4" height="6" rx="1.2" transform="rotate(-45 19.8 12)" />
  </svg>
);

export const RunIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <circle cx="14.5" cy="5" r="1.8" />
    <path d="M10 20l2-4.5-2.5-2 1-4.5 3.5-1 2.5 2.5 2.5.5" />
    <path d="M10.5 9l-3 1-1.5 3" />
    <path d="M12 15.5L8.5 20" />
  </svg>
);

export const DropIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M12 3.5s6 6.6 6 10.7a6 6 0 0 1-12 0C6 10.1 12 3.5 12 3.5z" />
    <path d="M9.5 14.5a2.6 2.6 0 0 0 2 2.4" />
  </svg>
);

export const ForkIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M7 3v7a2.5 2.5 0 0 0 5 0V3" />
    <path d="M9.5 3v18" />
    <path d="M17 3c-1.7 1.5-2.5 4-2.5 6.5 0 2 1 3 2.5 3v8.5" />
  </svg>
);

// ── Habit icon set ─────────────────────────────────────────────────────────
// Extra glyphs for user-defined habits. Stored data only ever references a
// stable string key (never raw SVG/HTML) — HABIT_ICONS maps keys to nodes.

export const BookIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z" />
    <path d="M20 5.5C20 4.7 19.3 4 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" />
  </svg>
);

export const CoffeeIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M5 8h12v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z" />
    <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
    <path d="M8 3.5c-.5.7-.5 1.3 0 2M11.5 3.5c-.5.7-.5 1.3 0 2" />
    <path d="M4 21h14" />
  </svg>
);

export const MeditateIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="5.5" r="2" />
    <path d="M12 8v4" />
    <path d="M12 12c-2 0-5 1.2-6.5 2.5L8 17M12 12c2 0 5 1.2 6.5 2.5L16 17" />
    <path d="M7 20l5-3 5 3" />
  </svg>
);

export const LeafIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M5 19c0-8 6-13 14-13 0 8-5 14-13 14a6 6 0 0 1-1-1z" />
    <path d="M9 15c2.5-2.5 5-4 8-5" />
  </svg>
);

export const NoEntryIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6.5 6.5l11 11" />
  </svg>
);

export const CheckCircleIcon = (
  <svg viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.2l2.4 2.4 4.6-5" />
  </svg>
);

/** Stable key → habit icon node. Keys are the only thing stored in data. */
export const HABIT_ICONS: Record<string, React.ReactNode> = {
  check: CheckCircleIcon,
  book: BookIcon,
  coffee: CoffeeIcon,
  moon: MoonIcon,
  dumbbell: DumbbellIcon,
  heart: HeartIcon,
  water: DropIcon,
  walk: RunIcon,
  meditate: MeditateIcon,
  leaf: LeafIcon,
  flame: FlameIcon,
  scale: ScaleIcon,
  pulse: PulseIcon,
  fork: ForkIcon,
  steps: StepsIcon,
  "no-entry": NoEntryIcon,
};

export const HABIT_ICON_KEYS = Object.keys(HABIT_ICONS);

export function habitIcon(key: string): React.ReactNode {
  return HABIT_ICONS[key] ?? HABIT_ICONS.check;
}

/** Tinted rounded chip wrapping a metric icon (Apple Health category style). */
export function IconChip({ icon, color, size = 26 }: { icon: React.ReactNode; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      <span style={{ width: size * 0.62, height: size * 0.62, display: "flex" }}>{icon}</span>
    </span>
  );
}

/** Human-facing label for a workout's kind. Google often returns a generic
 *  "Workout" displayName while the real activity lives in exerciseType
 *  (e.g. LACROSSE) — prefer the specific type in that case so the list shows
 *  what the session actually was. */
export function workoutLabel(w: { name?: string; exerciseType?: string }): string {
  const type =
    w.exerciseType && w.exerciseType.toUpperCase() !== "WORKOUT"
      ? w.exerciseType.replace(/_/g, " ").toLowerCase()
      : null;
  const name = w.name?.trim();
  if (name && !/^workout$/i.test(name)) return name;
  return type ?? name ?? "Workout";
}

/** Picks a workout icon by exercise type keyword. */
export function workoutIcon(type: string) {
  const t = type.toUpperCase();
  if (/WALK|HIK|RUN|TREADMILL|JOG/.test(t)) return RunIcon;
  if (/WEIGHT|STRENGTH|CROSSFIT|POWERLIFT|RESISTANCE|BODY_WEIGHT|CALISTHENICS|HIIT|CIRCUIT/.test(t)) return DumbbellIcon;
  if (/YOGA|PILATES|STRETCH|MEDITAT|TAI_CHI/.test(t)) return LungsIcon;
  if (/HEART|CARDIO/.test(t)) return HeartIcon;
  return FlameIcon;
}
