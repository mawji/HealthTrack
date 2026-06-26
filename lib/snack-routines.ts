// Exercise Snacks — the built-in routine catalog + shared types.
//
// PURE module: no fs / no server-only imports, so it is safe to import from
// both the client components (the circle row, the suggestion panel) and the
// server store (lib/exercise-snacks.ts). See plans/exercise-snacks.md.
//
// An "exercise snack" is ~1 breathless minute of vigorous movement (Dr. Rhonda
// Patrick's framing: replace "10,000 steps" with "10 breathless minutes").
// Routines are intentionally low-equipment and doable almost anywhere; the
// suggestion panel orders them easiest-first given the owner's profile.

export type SnackTier = "easy" | "moderate" | "hard";

/** Which authored SVG demo loop a routine shows (components/SnackAnimation).
 *  One distinct motion per routine. */
export type SnackAnimationKey =
  | "jog"
  | "walk"
  | "uphill"
  | "march"
  | "play"
  | "march"
  | "dance"
  | "squat"
  | "squat-jump"
  | "jacks"
  | "high-knees"
  | "stairs"
  | "climber"
  | "burpee";

export interface SnackRoutine {
  id: string;
  name: string;
  /** Where it works, for the chips (e.g. "anywhere", "stairs", "outdoors"). */
  where: string[];
  tier: SnackTier;
  /** One-line, do-it-now cue (~1 minute). */
  cue: string;
  animation: SnackAnimationKey;
}

/** Self-calibration hint shown in the panel — intensity by feel, not heart rate,
 *  exactly as framed in the source. */
export const SNACK_SELF_CALIBRATION =
  "Breathless = you can say only a few words, not sing. Go just hard enough to get there.";

/** The 12 built-in routines. Tiers default the panel ordering to gentler first. */
export const SNACK_ROUTINES: SnackRoutine[] = [
  { id: "uphill-walk", name: "Walk uphill", where: ["outdoors"], tier: "easy",
    cue: "Find any incline and push the pace until talking gets hard. One minute up.", animation: "uphill" },
  { id: "walk-jog-intervals", name: "Walk → jog intervals", where: ["outdoors"], tier: "easy",
    cue: "Alternate ~20s easy jog / 40s brisk walk for the minute. Easiest way into the breathless zone.", animation: "jog" },
  { id: "speed-walk", name: "Speed-walk the block", where: ["outdoors", "office"], tier: "easy",
    cue: "Walk somewhere you'd normally drive — fast enough that you feel it for a minute.", animation: "walk" },
  { id: "march", name: "Fast marching", where: ["anywhere"], tier: "easy",
    cue: "March hard on the spot — knees up, arms pumping — for a minute.", animation: "march" },
  { id: "dance", name: "Dance it out", where: ["living room"], tier: "easy",
    cue: "Put a song on and dance full-out for a minute. Arms up, keep moving, get breathless.", animation: "dance" },
  { id: "active-play", name: "Active play", where: ["with kids"], tier: "easy",
    cue: "Chase or play hard with the kids for a minute — tag counts.", animation: "play" },
  { id: "squats", name: "Bodyweight squats", where: ["anywhere"], tier: "moderate",
    cue: "Continuous squats for a minute — go a little faster/deeper to get breathless.", animation: "squat" },
  { id: "jumping-jacks", name: "Jumping jacks", where: ["anywhere"], tier: "moderate",
    cue: "Full-range jacks for 60 seconds. The classic snack.", animation: "jacks" },
  { id: "high-knees", name: "High knees", where: ["anywhere"], tier: "moderate",
    cue: "Jog in place driving your knees to hip height, fast, for a minute.", animation: "high-knees" },
  { id: "fast-stairs", name: "Fast stair climbing", where: ["stairs"], tier: "moderate",
    cue: "Walk or jog fast up the stairs, repeat up/down for a minute. Skip the lift.", animation: "stairs" },

  { id: "mountain-climbers", name: "Mountain climbers", where: ["floor"], tier: "hard",
    cue: "Plank position, drive your knees to your chest fast for 60 seconds.", animation: "climber" },
  { id: "squat-jumps", name: "Squat jumps", where: ["anywhere"], tier: "hard",
    cue: "Explosive jump squats for a minute. Scale down to plain squats if it's too much.", animation: "squat-jump" },
  { id: "burpees", name: "Burpees", where: ["floor"], tier: "hard",
    cue: "Squat → plank → (optional push-up) → jump up. Brutal and time-efficient — one minute.", animation: "burpee" },
];

const TIER_RANK: Record<SnackTier, number> = { easy: 0, moderate: 1, hard: 2 };

/** Catalog ordered gentlest-first (the owner's default). */
export function routinesByEasiest(): SnackRoutine[] {
  return [...SNACK_ROUTINES].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
}

export function routineById(id: string): SnackRoutine | undefined {
  return SNACK_ROUTINES.find((r) => r.id === id);
}

// ── per-day completion shapes (shared with the API + client) ───────────────

export type SnackSource = "manual" | "auto" | "coach";

export interface SnackEntry {
  id: string;
  /** ISO timestamp the snack was credited. */
  at: string;
  source: SnackSource;
  /** Which routine, if the user picked one (a generic snack still counts). */
  routineId?: string;
  /** Max heart rate over the snack's last ~3 min, resolved post-hoc from synced
   *  intraday HR. undefined = not resolved yet (watch hasn't synced); null =
   *  resolved but no HR data for that window; number = bpm. */
  maxHr?: number | null;
}

export interface SnackDayState {
  date: string;
  target: number;
  completed: SnackEntry[];
  /** ISO time of the most recent meal logged today (for the after-meal "due"
   *  trigger), or null. Computed on read, not stored. */
  lastMealAt?: string | null;
}
