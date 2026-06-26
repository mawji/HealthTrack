"use client";

// Exercise Snacks — the pinned row of "snack" circles. Self-contained (fetches
// its own state) so it can drop onto both Daily and Fitness with no wiring. Tap
// the next (breathing) circle to credit a breathless minute; completions pop
// with an encouraging emoji; hitting the goal celebrates. "Suggest a snack"
// opens the routine panel; grabbing a routine drops its animated figure into the
// next circle (a pending pick) which the user then taps to mark done — grabbing
// never auto-completes. See plans/exercise-snacks.md.

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import SnackSuggestionPanel from "@/components/SnackSuggestionPanel";
import SnackAnimation from "@/components/SnackAnimation";
import { SnackDayState, routineById } from "@/lib/snack-routines";

// Rotating encouragement on completed circles done without a picked routine.
const EMOJIS = ["💪", "🔥", "✅", "⚡", "🙌", "🌟", "🏃", "🦵", "❤️", "✨"];

// Active part of the day the snack schedule is spread across (local hours).
const DAY_START_H = 7;
const DAY_END_H = 22;
// A snack becomes "due" within this long after a meal is logged.
const AFTER_MEAL_MS = 60 * 60 * 1000;

function todayAtHour(h: number): number {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.getTime();
}

/** HR-zone color for the post-hoc max-HR pill. */
function hrZone(bpm: number): string {
  if (bpm < 120) return "var(--breath)"; // blue
  if (bpm < 140) return "var(--activity)"; // green
  if (bpm < 160) return "var(--food)"; // amber
  return "var(--heart)"; // red
}

export default function ExerciseSnacks() {
  const [day, setDay] = useState<SnackDayState | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [popIndex, setPopIndex] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  // A routine the user grabbed for the next circle but hasn't completed yet.
  const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);
  // Re-evaluate "due" as the clock moves, without refetching.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/exercise-snacks");
      if (res.ok) setDay(await res.json());
    } catch {
      /* offline — leave as-is */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Tick every 30s so an upcoming snack flips to "due" (red) on time.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Latest day in a ref so the HR backfill poll reads it without re-subscribing.
  const dayRef = useRef<SnackDayState | null>(null);
  useEffect(() => {
    dayRef.current = day;
  }, [day]);

  // While any completed snack is still awaiting its synced HR, re-fetch every
  // 60s so the HR pill backfills on its own once the watch syncs.
  useEffect(() => {
    const id = setInterval(() => {
      if (dayRef.current?.completed.some((e) => e.maxHr === undefined)) load();
    }, 60000);
    return () => clearInterval(id);
  }, [load]);

  const complete = useCallback(
    async (routineId?: string) => {
      if (busy) return;
      setBusy(true);
      const prev = day?.completed.length ?? 0;
      try {
        const res = await fetch("/api/exercise-snacks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(routineId ? { routineId } : {}),
        });
        if (!res.ok) return;
        const next: SnackDayState = await res.json();
        setDay(next);
        setPendingRoutineId(null);
        setPopIndex(next.completed.length - 1);
        setTimeout(() => setPopIndex((p) => (p === next.completed.length - 1 ? null : p)), 600);
        if (prev < next.target && next.completed.length >= next.target) {
          setCelebrate(true);
          setTimeout(() => setCelebrate(false), 2600);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, day]
  );

  const undo = useCallback(async (entryId?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const qs = entryId ? `?entryId=${encodeURIComponent(entryId)}` : "";
      const res = await fetch(`/api/exercise-snacks${qs}`, { method: "DELETE" });
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Double-tap a completed circle to undo just that snack (avoids accidental
  // single-tap undos). Works for mouse + touch via a quick second-tap window.
  const lastTap = useRef<{ id: string; t: number }>({ id: "", t: 0 });
  const onCompletedTap = useCallback(
    (entryId: string) => {
      const now = Date.now();
      if (lastTap.current.id === entryId && now - lastTap.current.t < 400) {
        lastTap.current = { id: "", t: 0 };
        undo(entryId);
      } else {
        lastTap.current = { id: entryId, t: now };
      }
    },
    [undo]
  );

  if (!day) return null;

  const count = day.completed.length;
  const target = day.target;
  // Show the target's worth of circles, plus one trailing "next" circle so a
  // bonus snack can always be added (even after the goal is met).
  const slots = Math.max(target, count) + (count >= target ? 1 : 0);
  const metGoal = count >= target;
  const pendingRoutine = pendingRoutineId ? routineById(pendingRoutineId) : undefined;

  // Is the NEXT snack overdue? Due time = the earlier of (a) its equal-parts
  // schedule slot, and (b) one hour after the most recent meal logged today (if
  // nothing's been snacked since that meal). A grabbed/pending snack or a met
  // goal is never "due" (red).
  const now = Date.now();
  const winStart = todayAtHour(DAY_START_H);
  const winEnd = todayAtHour(DAY_END_H);
  const slot = (winEnd - winStart) / Math.max(target, 1);
  const scheduleDueAt = winStart + (count + 1) * slot;
  const lastSnackAt = count > 0 ? Date.parse(day.completed[count - 1].at) : 0;
  const mealAt = day.lastMealAt ? Date.parse(day.lastMealAt) : 0;
  const mealDueAt = mealAt && mealAt > lastSnackAt ? mealAt + AFTER_MEAL_MS : Infinity;
  const dueAt = Math.min(scheduleDueAt, mealDueAt);
  const nextOverdue = !metGoal && !pendingRoutine && now > dueAt;

  return (
    <section
      className="desk-span rise rise-1"
      aria-label="Exercise snacks"
      style={{
        position: "relative",
        background: "var(--bg-raised)",
        border: "1px solid var(--hairline)",
        borderRadius: 18,
        padding: "15px 16px",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 3, gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden="true">⚡</span> Exercise snacks <SnackInfo />
        </h2>
        <span
          className={celebrate ? "snack-celebrate" : undefined}
          style={{ fontSize: 13, fontWeight: 700, color: metGoal ? "var(--activity)" : "var(--ink-soft)" }}
        >
          {count} / {target}
        </span>
      </div>
      <div style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45 }}>
        {metGoal ? (
          `🎉 Goal hit — that's your ${target} breathless minutes for today. Bonus snacks still count.`
        ) : pendingRoutine ? (
          `${pendingRoutine.name} loaded — do your minute, then tap the yellow circle.`
        ) : count === 0 ? (
          <>
            <p style={{ margin: "0 0 7px" }}>
              Each circle is one <strong style={{ color: "var(--ink)" }}>breathless minute</strong> of vigorous
              movement. Do one, or several back-to-back, and tap a circle for each minute.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", rowGap: 4 }}>
              <Legend color="var(--ink-soft)" label="up next" />
              <Legend color="var(--heart)" label="due" />
              <Legend color="var(--food)" label="doing now" />
              <Legend color="var(--activity)" label="done" />
            </div>
          </>
        ) : nextOverdue ? (
          "⏰ A snack's due — squeeze in a breathless minute, then tap the red circle."
        ) : (
          "Do a breathless minute, or a few in a row, then tap a circle for each. Double-tap a done circle to undo."
        )}
      </div>

      <div className="row" style={{ columnGap: 9, rowGap: 16, flexWrap: "wrap", alignItems: "center", paddingBottom: 6 }}>
        {Array.from({ length: slots }).map((_, i) => {
          const filled = i < count;
          const isNext = i === count;
          const interactive = filled || isNext;
          const entry = filled ? day.completed[i] : undefined;
          const entryId = entry?.id;
          const maxHr = typeof entry?.maxHr === "number" ? entry.maxHr : null;

          // Resolve this circle's stoplight state → colors, content, animation.
          let border: string;
          let background: string;
          let color: string;
          let cls = "";
          let content: ReactNode;
          if (filled) {
            const entry = day.completed[i];
            const doneRoutine = entry?.routineId ? routineById(entry.routineId) : null;
            border = "1.5px solid var(--activity)";
            background = "var(--activity-soft)";
            color = "var(--activity)";
            content = doneRoutine ? (
              <SnackAnimation kind={doneRoutine.animation} size={24} />
            ) : (
              EMOJIS[i % EMOJIS.length]
            );
          } else if (isNext && pendingRoutine) {
            border = "1.5px solid var(--food)";
            background = "var(--food-soft)";
            color = "var(--food)";
            cls = "snack-pending";
            content = <SnackAnimation kind={pendingRoutine.animation} size={24} />;
          } else if (isNext && nextOverdue) {
            border = "1.5px solid var(--heart)";
            background = "var(--heart-soft)";
            color = "var(--heart)";
            cls = "snack-due";
            content = "+";
          } else if (isNext) {
            border = "1.5px solid color-mix(in srgb, var(--ink-soft) 55%, transparent)";
            background = "var(--bg)";
            color = "var(--ink-soft)";
            cls = "snack-next";
            content = "+";
          } else {
            border = "1.5px dashed var(--hairline)";
            background = "var(--bg)";
            color = "var(--ink-faint)";
            content = "";
          }

          return (
            <span key={i} style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              disabled={busy || !interactive}
              onClick={() => (filled ? entryId && onCompletedTap(entryId) : complete(pendingRoutineId ?? undefined))}
              aria-label={
                filled
                  ? "completed snack — double-tap to undo"
                  : isNext
                    ? pendingRoutine
                      ? `mark ${pendingRoutine.name} done`
                      : nextOverdue
                        ? "snack due — mark it done"
                        : "mark the next snack done"
                    : "upcoming snack"
              }
              title={
                filled
                  ? "Double-tap to undo"
                  : isNext
                    ? nextOverdue && !pendingRoutine
                      ? "Snack due — do a breathless minute, then tap"
                      : "Tap when you've done your breathless minute"
                    : ""
              }
              className={`${cls} ${popIndex === i ? "snack-pop" : ""}`.trim() || undefined}
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                cursor: interactive && !busy ? "pointer" : "default",
                padding: 0,
                overflow: "hidden",
                touchAction: "manipulation",
                transition: "background 0.2s ease, border-color 0.2s ease",
                border,
                background,
                color,
              }}
            >
              {content}
            </button>
            {maxHr !== null && (
              <span
                aria-label={`max heart rate ${maxHr} bpm`}
                style={{
                  position: "absolute",
                  bottom: -7,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: hrZone(maxHr),
                  color: "var(--bg)",
                  fontSize: 9.5,
                  fontWeight: 800,
                  lineHeight: 1.35,
                  padding: "0 5px",
                  borderRadius: 7,
                  border: "1.5px solid var(--bg-raised)",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {maxHr}
              </span>
            )}
            </span>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        style={{
          marginTop: 13,
          cursor: "pointer",
          background: "transparent",
          border: "none",
          color: "var(--activity)",
          fontSize: 12.5,
          fontWeight: 600,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        💡 Suggest a snack
      </button>

      <p style={{ margin: "12px 0 0", fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.4 }}>
        Inspired by{" "}
        <a
          href="https://youtu.be/BPZBIzf39M0"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--ink-soft)", textDecoration: "none" }}
        >
          Dr. Rhonda Patrick&rsquo;s &ldquo;10 breathless minutes&rdquo;
        </a>
      </p>

      <SnackSuggestionPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onGrab={(routineId) => setPendingRoutineId(routineId)}
      />
    </section>
  );
}

// Why exercise snacks work — shown in the info popover. All points trace to one
// Instagram source, so it's cited once via the pill below (not per line).
const SNACK_BENEFITS: { lead: string; text: string }[] = [
  {
    lead: "The power of intensity",
    text: "Just 1 minute of vigorous exercise equals the health benefits of up to 53 minutes of light activity.",
  },
  {
    lead: "Mortality reduction",
    text: "A few short, breathless bursts through the day is associated with up to a 40% reduction in all-cause mortality, plus significant drops in cancer and cardiovascular risk.",
  },
  {
    lead: "Brain health",
    text: "Short, hard efforts trigger cognitive benefits — increasing blood flow and leaving you feeling sharper.",
  },
  {
    lead: "Beyond the 10,000-steps myth",
    text: "Focusing on intensity over simple step counts is a much stronger predictor of longevity and protection against diseases like dementia.",
  },
];
const SNACK_SOURCE = { handle: "womenshealthmag", url: "https://www.instagram.com/reel/DYW5KBvqc9I/" };

/** Google-style "Instagram · handle" source pill linking to the post. */
function SourcePill() {
  return (
    <a
      href={SNACK_SOURCE.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
        padding: "4px 10px 4px 5px",
        borderRadius: 999,
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        fontSize: 10.5,
        color: "var(--ink-soft)",
        textDecoration: "none",
        width: "fit-content",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#feda75" />
            <stop offset="0.35" stopColor="#fa7e1e" />
            <stop offset="0.6" stopColor="#d62976" />
            <stop offset="1" stopColor="#962fbf" />
          </linearGradient>
        </defs>
        <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#ig-grad)" />
        <circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" strokeWidth="2" />
        <circle cx="17.6" cy="6.4" r="1.4" fill="#fff" />
      </svg>
      <span>
        Instagram · <span style={{ color: "var(--ink)", fontWeight: 600 }}>{SNACK_SOURCE.handle}</span>
      </span>
    </a>
  );
}

/** Info "i" next to the title that reveals the "why" popover on hover or tap. */
function SnackInfo() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const open = pinned || hovered;

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPinned(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      style={{ display: "inline-flex" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label="Why exercise snacks work"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        style={{
          width: 15,
          height: 15,
          borderRadius: "50%",
          border: "1px solid var(--ink-faint)",
          background: "transparent",
          color: "var(--ink-soft)",
          fontSize: 10,
          fontWeight: 700,
          fontStyle: "italic",
          fontFamily: "Georgia, 'Times New Roman', serif",
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        i
      </button>
      {open && (
        // Anchored to the card (section is position:relative) so it spans the
        // card width and never overflows on narrow phones.
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: 44,
            left: 14,
            right: 14,
            zIndex: 50,
            background: "var(--bg-raised)",
            border: "1px solid var(--hairline)",
            borderRadius: 14,
            boxShadow: "var(--shadow)",
            padding: "13px 15px",
            fontSize: 11.5,
            fontWeight: 400,
            lineHeight: 1.5,
            color: "var(--ink-soft)",
            textAlign: "left",
            cursor: "default",
          }}
        >
          <p style={{ margin: "0 0 9px", color: "var(--ink)" }}>
            These brief, intentional bursts of intense effort provide a massive return on investment for your health.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
            {SNACK_BENEFITS.map((b) => (
              <li key={b.lead} style={{ display: "flex", gap: 7 }}>
                <span style={{ color: "var(--activity)", flexShrink: 0 }} aria-hidden="true">•</span>
                <span>
                  <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{b.lead}:</strong> {b.text}
                </span>
              </li>
            ))}
          </ul>
          <SourcePill />
        </div>
      )}
    </span>
  );
}

/** A small colored-dot + label for the empty-state legend. */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}
