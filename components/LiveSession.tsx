"use client";

import { useEffect, useRef, useState } from "react";
import { WorkoutTypePicker } from "@/components/WorkoutTypePicker";
import ExerciseListEditor from "@/components/ExerciseListEditor";
import { IconChip, workoutIcon } from "@/components/icons";
import { WorkoutType, labelForType } from "@/lib/workout-types";
import type { WorkoutExercise } from "@/lib/types";

interface ActiveSession {
  id: string;
  name: string;
  exerciseType: string;
  startedAt: string;
  pausedMs: number;
  pauseStartedAt?: string;
  exercises: WorkoutExercise[];
  planItemId?: string;
}

function computeElapsed(s: ActiveSession): number {
  const paused = s.pausedMs + (s.pauseStartedAt ? Date.now() - new Date(s.pauseStartedAt).getTime() : 0);
  return Math.max(0, Date.now() - new Date(s.startedAt).getTime() - paused);
}

function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function LiveSession({
  quickTypes,
  startFor,
  onConsumedStart,
  onFinished,
}: {
  quickTypes: WorkoutType[];
  // When set (e.g. "Start" tapped on a planned workout), auto-start this session.
  startFor?: { name: string; exerciseType: string; exercises?: WorkoutExercise[]; planItemId?: string } | null;
  onConsumedStart?: () => void;
  onFinished?: () => void;
}) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [, setTick] = useState(0);
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => fetch("/api/workout-session").then((r) => r.json()).then((j) => setSession(j.session ?? null)).catch(() => {});

  useEffect(() => {
    load();
  }, []);

  // 1s timer while a session is running (and not paused).
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (session && !session.pauseStartedAt) {
      tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [session]);

  async function start(name: string, exerciseType: string, exercises?: WorkoutExercise[], planItemId?: string) {
    setBusy(true);
    try {
      const j = await fetch("/api/workout-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, exerciseType, exercises, planItemId }) }).then((r) => r.json());
      setSession(j.session ?? null);
      setPicking(false);
    } finally {
      setBusy(false);
    }
  }

  // Auto-start when a parent hands us a start request (e.g. from a plan).
  useEffect(() => {
    if (startFor && !session) {
      start(startFor.name, startFor.exerciseType, startFor.exercises, startFor.planItemId);
      onConsumedStart?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startFor]);

  async function patch(body: Record<string, unknown>) {
    const j = await fetch("/api/workout-session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (j.session) setSession(j.session);
  }

  async function discard() {
    if (!confirm("Discard this session? Nothing will be saved.")) return;
    await fetch("/api/workout-session", { method: "DELETE" });
    setSession(null);
    setFinishing(false);
  }

  async function finish(trackedOnWatch: boolean) {
    if (!session) return;
    setBusy(true);
    try {
      const started = new Date(session.startedAt);
      const durationMin = Math.max(1, Math.round(computeElapsed(session) / 60000));
      const date = new Date().toISOString().slice(0, 10);
      const startTime = started.toTimeString().slice(0, 5);
      await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: session.name,
          exerciseType: session.exerciseType,
          durationMin,
          date,
          startTime,
          detail: session.exercises.length ? { exercises: session.exercises } : undefined,
          skipGoogleSync: trackedOnWatch,
        }),
      });
      await fetch("/api/workout-session", { method: "DELETE" });
      setSession(null);
      setFinishing(false);
      onFinished?.();
    } finally {
      setBusy(false);
    }
  }

  // ── idle: start controls ──────────────────────────────────────────────────
  if (!session) {
    return (
      <section className="card rise rise-2">
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 560, marginBottom: 12 }}>Start a workout</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {quickTypes.slice(0, 6).map((t) => (
            <button key={t.type} className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13 }} disabled={busy} onClick={() => start(t.label, t.type)}>
              <span className="row" style={{ gap: 6 }}>
                <IconChip icon={workoutIcon(t.type)} color="var(--activity)" size={20} />
                {t.label}
              </span>
            </button>
          ))}
          <button className="btn" style={{ padding: "8px 14px", fontSize: 13, background: "var(--activity)" }} onClick={() => setPicking((p) => !p)}>
            {picking ? "Close" : "Other…"}
          </button>
        </div>
        {picking && (
          <div style={{ marginTop: 12 }}>
            <WorkoutTypePicker quickTypes={quickTypes} onPick={(t) => start(t.label, t.type)} />
          </div>
        )}
      </section>
    );
  }

  // ── active session ────────────────────────────────────────────────────────
  const elapsed = computeElapsed(session);
  const paused = !!session.pauseStartedAt;
  return (
    <section className="card rise rise-2" style={{ borderLeft: "3px solid var(--activity)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <IconChip icon={workoutIcon(session.exerciseType)} color="var(--activity)" size={30} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 16 }}>{session.name}</strong>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{labelForType(session.exerciseType)} · in progress{paused ? " · paused" : ""}</div>
          </div>
        </div>
        <div className="display-num" style={{ fontSize: 30, color: paused ? "var(--ink-soft)" : "var(--activity)", fontVariantNumeric: "tabular-nums" }}>
          {fmtClock(elapsed)}
        </div>
      </div>

      <ExerciseListEditor exercises={session.exercises} onChange={(next) => { setSession({ ...session, exercises: next }); patch({ exercises: next }); }} accent="var(--activity)" />

      {!finishing ? (
        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => patch({ action: paused ? "resume" : "pause" })}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn" style={{ padding: "8px 16px", fontSize: 13, background: "var(--activity)", flex: 1 }} onClick={() => setFinishing(true)}>
            Finish
          </button>
          <button className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13, color: "var(--heart)" }} onClick={discard}>
            Discard
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10, marginTop: 14, padding: 12, borderRadius: 12, background: "var(--bg-inset)" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Did you also track this on your watch / Google Health?</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>If yes, we’ll wait and merge with the watch’s session (no duplicate). If no, we’ll save it to Google now.</span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" style={{ background: "var(--activity)", flex: 1, fontSize: 13 }} disabled={busy} onClick={() => finish(true)}>Yes — merge with watch</button>
            <button className="btn btn-ghost" style={{ flex: 1, fontSize: 13 }} disabled={busy} onClick={() => finish(false)}>No — save to Google now</button>
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 12.5, alignSelf: "flex-start" }} onClick={() => setFinishing(false)}>Back</button>
        </div>
      )}
    </section>
  );
}
