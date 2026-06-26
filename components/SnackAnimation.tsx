"use client";

// Authored, looping SVG demo figures for the exercise-snack routines. Each
// routine gets its OWN motion. Figures are side-profile (or front, or plank)
// with two-segment jointed limbs (thigh+shin, upperarm+forearm) so knees and
// elbows actually bend — that's what makes a squat / high-knee / plank / burpee
// readable. Driven by SMIL <animateTransform> (no global keyframes, no gifs, no
// external assets), theme-aware via currentColor, and honoring
// prefers-reduced-motion by freezing on a representative pose. See
// plans/exercise-snacks.md.
//
// Angle convention (profile faces right): negative thigh = knee swings FORWARD;
// positive shin = foot tucks back/up (knee bends); positive lean = torso tips
// FORWARD; negative arm = hand swings forward/up.

import { ReactNode } from "react";
import { SnackAnimationKey } from "@/lib/snack-routines";

type Track = number[]; // rotation (deg) per keyframe

interface Move {
  orient: "profile" | "front" | "plank";
  dur: number;
  keyTimes?: number[];
  still?: number;
  base?: string;
  ground?: "incline" | "stairs" | "floor";
  /** Scroll the ground [dx,dy] per loop to imply forward travel. */
  groundScroll?: [number, number];
  rootX?: Track;
  rootY?: Track;
  lean?: Track;
  thighN?: Track; shinN?: Track;
  thighF?: Track; shinF?: Track;
  uarmN?: Track; farmN?: Track;
  uarmF?: Track; farmF?: Track;
}

// Standing profile geometry (viewBox 0 0 48 64, faces right).
const P = {
  head: [22, 9, 5] as const, eye: [25, 8.5] as const,
  sh: [22, 17] as const, hip: [22, 34] as const,
  knee: [22, 46] as const, foot: [25, 57] as const,
  el: [22, 26] as const, hand: [24, 34] as const,
};
// Front geometry.
const F = {
  head: [24, 9, 5] as const,
  sh: [24, 17] as const, hip: [24, 34] as const,
  lknee: [20, 46] as const, lfoot: [19, 57] as const,
  rknee: [28, 46] as const, rfoot: [29, 57] as const,
  lel: [19, 26] as const, lhand: [18, 34] as const,
  rel: [29, 26] as const, rhand: [30, 34] as const,
};
// Purpose-drawn PLANK geometry (don't rotate the standing figure — that clipped
// and read as "lying down"). Side-profile, facing right: hands planted on the
// floor at the right, a near-horizontal back from shoulders up-left to the hip,
// legs extended back-left with toes on the floor, head forward past the
// shoulders. Knees drive forward (toward the hands) via the thigh+shin joints.
const PL = {
  head: [38, 38, 4] as const, eye: [40, 37] as const,
  sh: [32, 42] as const, hip: [16, 48] as const, // back DESCENDS head→shoulder→hip
  hand: [38, 58] as const, // planted; support arm runs shoulder→hand
  knee: [11, 53] as const, foot: [5, 58] as const, // extended-back rest pose
};
const line = (a: readonly number[], b: readonly number[]) => (
  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
);

export default function SnackAnimation({
  kind,
  size = 46,
}: {
  kind: SnackAnimationKey;
  size?: number;
}) {
  // Demos always animate (functional content). Decorative page motion honors
  // prefers-reduced-motion via CSS, not here — see header note.
  const m = MOVES[kind];
  const kt = m.keyTimes?.join(";");

  const rot = (angles: Track | undefined, cx: number, cy: number, children: ReactNode): ReactNode => {
    if (!angles) return <g>{children}</g>;
    return (
      <g>
        <animateTransform attributeName="transform" type="rotate"
          values={angles.map((a) => `${a} ${cx} ${cy}`).join(";")} keyTimes={kt}
          dur={`${m.dur}s`} repeatCount="indefinite" />
        {children}
      </g>
    );
  };

  const trans = (xs: Track | undefined, ys: Track | undefined, children: ReactNode): ReactNode => {
    if (!xs && !ys) return <>{children}</>;
    const n = (xs ?? ys)!.length;
    const X = xs ?? Array(n).fill(0);
    const Y = ys ?? Array(n).fill(0);
    return (
      <g>
        <animateTransform attributeName="transform" type="translate"
          values={X.map((x, k) => `${x} ${Y[k]}`).join(";")} keyTimes={kt}
          dur={`${m.dur}s`} repeatCount="indefinite" />
        {children}
      </g>
    );
  };

  let groundInner: ReactNode = null;
  if (m.ground === "floor") groundInner = line([-10, 60], [58, 60]);
  else if (m.ground === "incline") groundInner = line([-10, 70], [58, 46]);
  else if (m.ground === "stairs")
    groundInner = (
      <polyline points="-8,74 4,74 4,66 16,66 16,58 28,58 28,50 40,50 40,42 52,42 52,34 64,34" />
    );
  const ground = m.ground && (
    <g opacity="0.4" strokeWidth={2}>
      {m.groundScroll ? (
        <g>
          <animateTransform attributeName="transform" type="translate"
            values={`0 0;${m.groundScroll[0]} ${m.groundScroll[1]}`}
            dur={`${m.dur}s`} repeatCount="indefinite" />
          {groundInner}
        </g>
      ) : (
        groundInner
      )}
    </g>
  );

  let figure: ReactNode;
  if (m.orient === "profile") {
    const leg = (thigh: Track | undefined, shin: Track | undefined) =>
      rot(thigh, P.hip[0], P.hip[1], (
        <>{line(P.hip, P.knee)}{rot(shin, P.knee[0], P.knee[1], line(P.knee, P.foot))}</>
      ));
    const arm = (uarm: Track | undefined, farm: Track | undefined) =>
      rot(uarm, P.sh[0], P.sh[1], (
        <>{line(P.sh, P.el)}{rot(farm, P.el[0], P.el[1], line(P.el, P.hand))}</>
      ));
    const upper = rot(m.lean, P.hip[0], P.hip[1], (
      <>
        <g opacity="0.45">{arm(m.uarmF, m.farmF)}</g>
        {line(P.sh, P.hip)}
        <circle cx={P.head[0]} cy={P.head[1]} r={P.head[2]} />
        <circle cx={P.eye[0]} cy={P.eye[1]} r="1" fill="currentColor" stroke="none" />
        {arm(m.uarmN, m.farmN)}
      </>
    ));
    figure = trans(m.rootX, m.rootY, (
      <>
        <g opacity="0.45">{leg(m.thighF, m.shinF)}</g>
        {upper}
        {leg(m.thighN, m.shinN)}
      </>
    ));
  } else if (m.orient === "plank") {
    const pleg = (thigh: Track | undefined, shin: Track | undefined) =>
      rot(thigh, PL.hip[0], PL.hip[1], (
        <>{line(PL.hip, PL.knee)}{rot(shin, PL.knee[0], PL.knee[1], line(PL.knee, PL.foot))}</>
      ));
    figure = trans(m.rootX, m.rootY, (
      <>
        <g opacity="0.45">{pleg(m.thighF, m.shinF)}</g>
        {line(PL.sh, PL.hip)}
        {line(PL.sh, PL.hand)}
        <circle cx={PL.head[0]} cy={PL.head[1]} r={PL.head[2]} />
        <circle cx={PL.eye[0]} cy={PL.eye[1]} r="1" fill="currentColor" stroke="none" />
        {pleg(m.thighN, m.shinN)}
      </>
    ));
  } else {
    const fleg = (knee: readonly number[], foot: readonly number[], thigh: Track | undefined, shin: Track | undefined) =>
      rot(thigh, F.hip[0], F.hip[1], (
        <>{line(F.hip, knee)}{rot(shin, knee[0], knee[1], line(knee, foot))}</>
      ));
    const farm = (el: readonly number[], hand: readonly number[], uarm: Track | undefined, fore: Track | undefined) =>
      rot(uarm, F.sh[0], F.sh[1], (
        <>{line(F.sh, el)}{rot(fore, el[0], el[1], line(el, hand))}</>
      ));
    figure = trans(m.rootX, m.rootY, (
      <>
        {fleg(F.lknee, F.lfoot, m.thighN, m.shinN)}
        {fleg(F.rknee, F.rfoot, m.thighF, m.shinF)}
        {line(F.sh, F.hip)}
        <circle cx={F.head[0]} cy={F.head[1]} r={F.head[2]} />
        {farm(F.lel, F.lhand, m.uarmN, m.farmN)}
        {farm(F.rel, F.rhand, m.uarmF, m.farmF)}
      </>
    ));
  }

  return (
    <svg
      viewBox="0 0 48 64"
      width={size}
      height={(size * 64) / 48}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ground}
      {m.base ? <g transform={m.base}>{figure}</g> : figure}
    </svg>
  );
}

// ── per-routine motion ───────────────────────────────────────────────────────
const MOVES: Record<SnackAnimationKey, Move> = {
  jog: {
    orient: "profile", dur: 0.58, ground: "floor", lean: [8, 8, 8], rootY: [0, -2, 0],
    thighN: [-32, 28, -32], shinN: [25, 58, 25], thighF: [28, -32, 28], shinF: [58, 25, 58],
    uarmN: [24, -28, 24], uarmF: [-28, 24, -28], farmN: [-30, -30, -30], farmF: [-30, -30, -30],
  },
  walk: {
    orient: "profile", dur: 0.66, ground: "floor", lean: [4, 4, 4], rootY: [0, -1, 0],
    thighN: [-26, 20, -26], shinN: [12, 40, 12], thighF: [20, -26, 20], shinF: [40, 12, 40],
    uarmN: [18, -20, 18], uarmF: [-20, 18, -20],
  },
  uphill: {
    orient: "profile", dur: 0.78, ground: "incline", groundScroll: [-9, 5], lean: [24, 24, 24], rootY: [0, -2, 0],
    thighN: [-48, 8, -48], shinN: [34, 58, 34], thighF: [8, -48, 8], shinF: [58, 34, 58],
    uarmN: [26, -26, 26], uarmF: [-26, 26, -26], farmN: [-25, -25, -25], farmF: [-25, -25, -25],
  },
  march: {
    orient: "profile", dur: 0.58, ground: "floor", lean: [2, 2, 2], rootY: [0, -3, 0],
    thighN: [-58, 6, -58], shinN: [50, 18, 50], thighF: [6, -58, 6], shinF: [18, 50, 18],
    uarmN: [-40, 34, -40], uarmF: [34, -40, 34],
  },
  dance: {
    orient: "profile", dur: 0.62, ground: "floor", lean: [12, -6, 12], rootY: [0, -4, 0],
    thighN: [-16, 6, -16], shinN: [22, 10, 22], thighF: [6, -16, 6], shinF: [10, 22, 10],
    uarmN: [-128, -152, -128], uarmF: [-152, -128, -152],
  },
  "high-knees": {
    orient: "profile", dur: 0.4, ground: "floor", lean: [2, 2, 2], rootY: [0, -3, 0],
    thighN: [-94, 4, -94], shinN: [88, 22, 88], thighF: [4, -94, 4], shinF: [22, 88, 22],
    uarmN: [50, -50, 50], uarmF: [-50, 50, -50], farmN: [-35, -35, -35], farmF: [-35, -35, -35],
  },
  squat: {
    orient: "profile", dur: 1.1, ground: "floor", still: 1, lean: [0, 28, 0], rootY: [0, 8, 0],
    thighN: [0, -50, 0], shinN: [0, 78, 0], thighF: [0, -50, 0], shinF: [0, 78, 0],
    uarmN: [0, -82, 0], uarmF: [0, -82, 0], farmN: [0, -12, 0], farmF: [0, -12, 0],
  },
  "squat-jump": {
    orient: "profile", dur: 1.0, keyTimes: [0, 0.35, 0.62, 1], ground: "floor", still: 1,
    lean: [0, 28, 4, 0], rootY: [0, 8, -14, 0],
    thighN: [0, -50, 8, 0], shinN: [0, 78, -6, 0], thighF: [0, -50, 8, 0], shinF: [0, 78, -6, 0],
    uarmN: [0, -54, -162, 0], uarmF: [0, -54, -162, 0],
  },
  jacks: {
    orient: "front", dur: 0.7, ground: "floor", still: 1, rootY: [0, -3, 0],
    thighN: [0, -16, 0], thighF: [0, 16, 0], shinN: [0, -4, 0], shinF: [0, 4, 0],
    uarmN: [0, -150, 0], uarmF: [0, 150, 0],
  },
  play: {
    orient: "front", dur: 0.8, keyTimes: [0, 0.45, 1], ground: "floor", still: 1, rootY: [0, -10, 0],
    thighN: [0, -18, 0], thighF: [0, 18, 0], shinN: [0, 24, 0], shinF: [0, 24, 0],
    uarmN: [0, -132, 0], uarmF: [0, 132, 0],
  },
  stairs: {
    orient: "profile", dur: 0.56, ground: "stairs", groundScroll: [-12, 8], lean: [16, 16, 16], rootY: [0, -4, 0],
    thighN: [-64, 2, -64], shinN: [54, 16, 54], thighF: [2, -64, 2], shinF: [16, 54, 16],
    uarmN: [24, -24, 24], uarmF: [-24, 24, -24],
  },
  burpee: {
    orient: "profile", dur: 1.7, keyTimes: [0, 0.18, 0.42, 0.6, 0.82, 1], ground: "floor", still: 2,
    lean: [0, 26, 80, 26, 0, 0], rootY: [0, 8, 6, 8, -12, 0],
    thighN: [0, -42, 70, -42, 6, 0], shinN: [0, 70, -6, 70, -6, 0],
    thighF: [0, -42, 70, -42, 6, 0], shinF: [0, 70, -6, 70, -6, 0],
    uarmN: [0, -60, -100, -60, -160, 0], uarmF: [0, -60, -100, -60, -160, 0],
  },
  // Mountain climbers: a purpose-drawn PLANK (not the standing figure rotated),
  // knees driving forward toward the hands, alternating. thigh negative = knee
  // forward; shin positive = foot tucks (same sign rule as profile).
  climber: {
    orient: "plank", dur: 0.5, ground: "floor", still: 1,
    thighN: [0, -100, 0], shinN: [0, 92, 0],
    thighF: [-100, 0, -100], shinF: [92, 0, 92],
  },
};
