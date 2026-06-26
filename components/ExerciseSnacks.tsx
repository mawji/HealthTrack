"use client";

// Exercise Snacks — the pinned row of "snack" circles. Self-contained (fetches
// its own state) so it can drop onto both Daily and Fitness with no wiring. Tap
// the next (breathing) circle to credit a breathless minute; completions pop
// with an encouraging emoji; hitting the goal celebrates. "Suggest a snack"
// opens the routine panel; grabbing a routine drops its animated figure into the
// next circle (a pending pick) which the user then taps to mark done — grabbing
// never auto-completes. See plans/exercise-snacks.md.

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

// Live timer (mirror lib/exercise-snacks AUTOSTOP_SEC).
const AUTOSTOP_SEC = 15 * 60;
const TIMER_NODIALOG_KEY = "ht-snack-timer-nodialog";

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
  // Live timer: clock for the fill ring, the start dialog, and the lead-in count.
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Briefly shown after stop: the just-finished session's duration (seconds).
  const [durationSec, setDurationSec] = useState<number | null>(null);

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
      const d = dayRef.current;
      const s = d?.session;
      const partialPending = !!(s && !s.startedAt && s.carrySec > 0 && s.partialAt && s.partialMaxHr === undefined);
      if (d?.completed.some((e) => e.maxHr === undefined) || partialPending) load();
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

  // ── live timer ──────────────────────────────────────────────────────────
  const sessionControl = useCallback(async (action: "start" | "stop", auto = false) => {
    try {
      const res = await fetch("/api/exercise-snacks/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, auto }),
      });
      if (res.ok) setDay(await res.json());
    } catch {
      /* offline */
    }
  }, []);

  // Tick the clock once a second while playing (drives the fill ring + counts).
  const playing = !!day?.session?.startedAt;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [playing]);

  // The 5-second lead-in countdown, then start the wall-clock.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      sessionControl("start");
      return;
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown, sessionControl]);

  // Safety: auto-stop a session that's run past the cap (also enforced server-side).
  const sess = day?.session ?? null;
  useEffect(() => {
    if (!playing || !sess?.startedAt) return;
    const el = sess.carrySec + (Date.now() - Date.parse(sess.startedAt)) / 1000;
    if (el >= AUTOSTOP_SEC) sessionControl("stop", true);
  }, [nowTs, playing, sess, sessionControl]);

  const onPlayClick = useCallback(() => {
    let skip = false;
    try {
      skip = localStorage.getItem(TIMER_NODIALOG_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (skip) setCountdown(5);
    else setDialogOpen(true);
  }, []);

  const onStopClick = useCallback(() => {
    const cur = sess?.startedAt ? sess.carrySec + (Date.now() - Date.parse(sess.startedAt)) / 1000 : 0;
    setDurationSec(Math.round(cur));
    setTimeout(() => setDurationSec(null), 3800);
    sessionControl("stop");
    // The stop response has no HR yet; nudge a resolve so pills backfill (then
    // the 60s poll keeps trying until the watch syncs).
    setTimeout(() => load(), 1500);
  }, [sess, sessionControl, load]);

  if (!day) return null;

  const target = day.target;
  const session = day.session ?? null;

  // Live elapsed (carry + current run). Minutes pass → more green circles; the
  // partial fills the current circle's clock ring. `count` is the live visual
  // count (committed entries + minutes the running timer has filled, not yet
  // persisted — they commit on stop).
  const baseCount = day.completed.length;
  const elapsedSec = session
    ? session.carrySec + (playing && session.startedAt ? Math.max(0, (nowTs - Date.parse(session.startedAt)) / 1000) : 0)
    : 0;
  const timerMin = playing ? Math.floor(elapsedSec / 60) : 0;
  const ringFrac = playing
    ? (elapsedSec % 60) / 60
    : session && session.carrySec >= 2
      ? (session.carrySec % 60) / 60
      : 0;
  const count = baseCount + timerMin;

  // Show the target's worth of circles, plus one trailing "next" circle so a
  // bonus snack can always be added (even after the goal is met).
  const slots = Math.max(target, count) + (count >= target ? 1 : 0);
  const metGoal = count >= target;
  const pendingRoutine = !playing && pendingRoutineId ? routineById(pendingRoutineId) : undefined;

  // Is the NEXT snack overdue? Due time = the earlier of (a) its equal-parts
  // schedule slot, and (b) one hour after the most recent meal logged today (if
  // nothing's been snacked since that meal). Never "due" while playing, pending,
  // or goal-met. Schedule math uses the committed entries (baseCount).
  const now = Date.now();
  const winStart = todayAtHour(DAY_START_H);
  const winEnd = todayAtHour(DAY_END_H);
  const slot = (winEnd - winStart) / Math.max(target, 1);
  const scheduleDueAt = winStart + (baseCount + 1) * slot;
  const lastSnackAt = baseCount > 0 ? Date.parse(day.completed[baseCount - 1].at) : 0;
  const mealAt = day.lastMealAt ? Date.parse(day.lastMealAt) : 0;
  const mealDueAt = mealAt && mealAt > lastSnackAt ? mealAt + AFTER_MEAL_MS : Infinity;
  const dueAt = Math.min(scheduleDueAt, mealDueAt);
  const nextOverdue = !playing && !metGoal && !pendingRoutine && now > dueAt;

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
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 3, gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden="true">⚡</span> Exercise snacks <SnackInfo />
        </h2>
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <span
            className={celebrate ? "snack-celebrate" : undefined}
            style={{ fontSize: 13, fontWeight: 700, color: metGoal ? "var(--activity)" : "var(--ink-soft)" }}
          >
            {count} / {target}
          </span>
          <button
            type="button"
            aria-label={playing ? "stop the timer" : "start a snack session"}
            onClick={() => (playing ? onStopClick() : onPlayClick())}
            className={playing ? "snack-due" : undefined}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: playing ? "var(--heart)" : "var(--activity)",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {playing ? (
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <div style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45 }}>
        {playing ? (
          "Session running — go as hard as you safely can; the circles fill as minutes pass. Hit stop when you're done."
        ) : metGoal ? (
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
          const filled = i < baseCount; // committed entry
          const isTimerFilled = i >= baseCount && i < count; // green from the running timer
          const isNext = i === count;
          const interactive = !playing && (filled || isNext);
          const entry = filled ? day.completed[i] : undefined;
          const entryId = entry?.id;
          const maxHr = typeof entry?.maxHr === "number" ? entry.maxHr : null;
          const showRing = isNext && (playing || ringFrac > 0);
          // The carried partial circle gets its own HR pill (resolved post-hoc).
          const partialHr = showRing && !playing && session && typeof session.partialMaxHr === "number" ? session.partialMaxHr : null;
          const pillHr = maxHr ?? partialHr;

          // Resolve this circle's state → colors, content, animation.
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
          } else if (isTimerFilled) {
            border = "1.5px solid var(--activity)";
            background = "var(--activity-soft)";
            color = "var(--activity)";
            content = EMOJIS[i % EMOJIS.length];
          } else if (isNext && playing) {
            border = "1.5px solid color-mix(in srgb, var(--activity) 30%, transparent)";
            background = "var(--bg)";
            color = "var(--activity)";
            content = "";
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
            {showRing && <ClockRing frac={ringFrac} />}
            {pillHr !== null && (
              <span
                aria-label={`max heart rate ${pillHr} bpm`}
                style={{
                  position: "absolute",
                  bottom: -7,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: hrZone(pillHr),
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
                {pillHr}
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

      <SnackTimerDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onStart={(dontShowAgain) => {
          if (dontShowAgain) {
            try {
              localStorage.setItem(TIMER_NODIALOG_KEY, "1");
            } catch {
              /* private mode */
            }
          }
          setDialogOpen(false);
          setCountdown(5);
        }}
      />
      {countdown !== null && <CountdownOverlay n={countdown} />}
      {durationSec !== null && <DurationToast sec={durationSec} onDone={() => setDurationSec(null)} />}
    </section>
  );
}

/** Prominent centered "session complete" popup shown briefly after stopping
 *  (auto-dismisses; tap to close early). Portal so it isn't trapped by the card. */
function DurationToast({ sec, onDone }: { sec: number; onDone: () => void }) {
  if (typeof document === "undefined") return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const label = m > 0 ? `${m}m ${s}s` : `${s}s`;
  return createPortal(
    <div
      onClick={onDone}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "color-mix(in srgb, var(--bg) 50%, transparent)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        className="snack-pop"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid color-mix(in srgb, var(--activity) 45%, transparent)",
          borderRadius: 20,
          boxShadow: "var(--shadow)",
          padding: "26px 36px",
          textAlign: "center",
          minWidth: 200,
        }}
      >
        <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">✅</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)", letterSpacing: 0.2, marginBottom: 4 }}>
          Session complete
        </div>
        <div style={{ fontSize: 42, fontWeight: 800, color: "var(--activity)", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
          {label}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Clock-style progress ring (fills clockwise from 12 o'clock) over a circle. */
function ClockRing({ frac }: { frac: number }) {
  const r = 17.25;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 38 38"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <circle
        cx="19"
        cy="19"
        r={r}
        fill="none"
        stroke="var(--activity)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        transform="rotate(-90 19 19)"
      />
    </svg>
  );
}

/** Full-screen 5→1 lead-in countdown (portal, so the fixed overlay isn't trapped
 *  by the card's transformed ancestor). */
function CountdownOverlay({ n }: { n: number }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
        backdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
      }}
    >
      <div
        key={n}
        className="snack-pop"
        style={{ fontSize: 96, fontWeight: 800, color: "var(--activity)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
      >
        {n}
      </div>
      <div style={{ fontSize: 14, color: "var(--ink-soft)", fontWeight: 600 }}>Get into position…</div>
    </div>,
    document.body
  );
}

/** Start-session confirmation dialog with a "don't show again" opt-out. */
function SnackTimerDialog({
  open,
  onCancel,
  onStart,
}: {
  open: boolean;
  onCancel: () => void;
  onStart: (dontShowAgain: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  useEffect(() => {
    if (open) setDontShow(false);
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start a snack session"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "color-mix(in srgb, var(--bg) 55%, transparent)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--bg-raised)",
          border: "1px solid var(--hairline)",
          borderRadius: 18,
          boxShadow: "var(--shadow)",
          padding: "18px 18px 16px",
        }}
      >
        <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700 }}>Start a snack session?</h3>
        <p style={{ margin: "0 0 9px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          We <strong style={{ color: "var(--ink)" }}>won&rsquo;t show a timer</strong> — that&rsquo;s on purpose, so you
          focus on doing as much as you physically can, not watching a clock.
        </p>
        <ul style={{ margin: "0 0 12px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {[
            "The hardest part is starting. Once you're moving, keep going.",
            "Don't over-exert — ease off if you feel dizzy, lightheaded, or any chest tightness.",
            "A 5-second countdown lets you get into position, and we trim 5 seconds when you stop — so no need to rush the start or the stop (rushing is where people get hurt).",
            "Forget to stop? It auto-stops after 15 minutes, then uses your heart-rate data to estimate when you actually finished.",
            "Stop anytime — we'll pick up where you left off next time.",
          ].map((t, i) => (
            <li key={i} style={{ display: "flex", gap: 7 }}>
              <span style={{ color: "var(--activity)", flexShrink: 0 }} aria-hidden="true">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-soft)", cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          Don&rsquo;t show this again
        </label>
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ cursor: "pointer", background: "transparent", border: "1px solid var(--hairline)", color: "var(--ink-soft)", borderRadius: 11, padding: "9px 16px", fontSize: 13, fontWeight: 600 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onStart(dontShow)}
            style={{ cursor: "pointer", background: "var(--activity)", border: "none", color: "#fff", borderRadius: 11, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}
          >
            Start
          </button>
        </div>
      </div>
    </div>,
    document.body
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
