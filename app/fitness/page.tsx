"use client";

import { useEffect, useState } from "react";
import { Sparkline, Bars } from "@/components/Sparkline";
import { IconChip, DumbbellIcon, FlameIcon, HeartIcon, workoutIcon, workoutLabel } from "@/components/icons";
import { WorkoutTypePicker } from "@/components/WorkoutTypePicker";
import { WorkoutDetailForm } from "@/components/WorkoutDetailForm";
import TrainingPlan from "@/components/TrainingPlan";
import LiveSession from "@/components/LiveSession";
import type { WorkoutExercise } from "@/lib/types";
import { DEFAULT_QUICK_TYPES, WorkoutType, labelForType } from "@/lib/workout-types";
import { formatDetail, detailIsEmpty } from "@/lib/workout-detail";
import { TrendsPayload, WorkoutSession, WorkoutDetail } from "@/lib/types";

const RANGES = [
  { label: "Week", days: 7 },
  { label: "Month", days: 31 },
];

const dayLetter = (date: string) => "SMTWTFS"[new Date(date + "T00:00:00").getDay()];

function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min} min`;
}

function dayHeading(date: string, today: string) {
  if (date === today) return "Today";
  const d = new Date(date + "T00:00:00");
  const yesterday = new Date(today + "T00:00:00");
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function Fitness() {
  const [days, setDays] = useState(7);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState<WorkoutType>(DEFAULT_QUICK_TYPES[2]);
  const [quickTypes, setQuickTypes] = useState<WorkoutType[]>(DEFAULT_QUICK_TYPES);
  const [logMin, setLogMin] = useState("45"); // raw string so it can be cleared/edited freely
  const [logDate, setLogDate] = useState("");
  const [logTime, setLogTime] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logDetail, setLogDetail] = useState<WorkoutDetail>({});
  const [logSaving, setLogSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // Draft detail for the session currently being edited in the history list.
  const [detailDraft, setDetailDraft] = useState<WorkoutDetail>({});
  // Pending "start this" request handed from a planned workout to the live session.
  const [startReq, setStartReq] = useState<{ name: string; exerciseType: string; exercises?: WorkoutExercise[]; planItemId?: string } | null>(null);

  const load = (d: number) => {
    setLoading(true);
    Promise.all([
      fetch(`/api/workouts?days=${d}`).then((r) => r.json()),
      fetch(`/api/health?view=trends&days=14`).then((r) => r.json()),
    ])
      .then(([w, t]) => {
        setSessions(w.sessions ?? []);
        setRange(w.range ?? null);
        if (w.quickTypes?.length) setQuickTypes(w.quickTypes);
        setTrends(t);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(days);
  }, [days]);

  async function saveWorkout() {
    setLogSaving(true);
    try {
      await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: logType.label,
          exerciseType: logType.type,
          durationMin: Math.max(1, Math.round(Number(logMin) || 45)),
          date: logDate || undefined,
          startTime: logTime || undefined,
          notes: logNotes || undefined,
          detail: detailIsEmpty(logDetail) ? undefined : logDetail,
        }),
      });
      setLogOpen(false);
      setLogNotes("");
      setLogDetail({});
      load(days);
    } finally {
      setLogSaving(false);
    }
  }

  // Save edited structured detail for an existing session (journal or Google).
  async function saveDetail(w: WorkoutSession, detail: WorkoutDetail) {
    await fetch("/api/workouts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: w.id, detail: detailIsEmpty(detail) ? null : detail }),
    });
    setEditing(null);
    load(days);
  }

  async function removeSession(id: string) {
    await fetch(`/api/workouts?id=${id}`, { method: "DELETE" });
    load(days);
  }

  // Resolve a deferred ("awaiting watch match") session: write it to Google now,
  // or manually merge it with a chosen synced watch session ("these are the same").
  async function resolveSession(id: string, body: Record<string, unknown>) {
    await fetch("/api/workouts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    load(days);
  }

  // Relabel a session locally — Google sometimes reports a generic or wrong
  // type (e.g. "Lacrosse" for a gym session) that an edit in the Health app
  // never propagates back to the API. The override is stored on our side.
  async function relabel(w: WorkoutSession, type?: WorkoutType) {
    await fetch("/api/workouts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        type
          ? { id: w.id, source: w.source, googleName: w.googleName, name: type.label, exerciseType: type.type }
          : { id: w.id, clear: true }
      ),
    });
    setEditing(null);
    load(days);
  }

  const today = range?.end ?? new Date().toISOString().slice(0, 10);

  // last 7 civil days for the exercise-day pills, oldest first
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const sessionDates = new Set(sessions.map((s) => s.date));
  const exerciseDays = weekDates.filter((d) => sessionDates.has(d)).length;

  const totalMin = sessions.reduce((a, s) => a + s.durationMin, 0);
  const totalKcal = sessions.reduce((a, s) => a + (s.calories ?? 0), 0);

  // sessions grouped by date, newest day first
  const byDay = new Map<string, WorkoutSession[]>();
  for (const s of sessions) {
    byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  }
  const dayKeys = [...byDay.keys()].sort().reverse();

  const azmToday = trends?.azm?.length ? trends.azm[trends.azm.length - 1].value : null;
  const azmLabels = trends?.azm?.map((p) => dayLetter(p.date)) ?? [];
  const azmDates = trends?.azm?.map((p) =>
    new Date(p.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
  );

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Fitness.</h1>
        <p className="page-sub">Workouts, training load, and effort over time.</p>
      </header>

      <div className="row rise rise-1" style={{ gap: 8, marginBottom: 16 }}>
        {RANGES.map((r) => (
          <button
            key={r.days}
            className={`btn ${r.days === days ? "" : "btn-ghost"}`}
            style={{ padding: "8px 16px", fontSize: 13 }}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="stack" style={{ marginBottom: 16, gap: 16 }}>
        <LiveSession
          quickTypes={quickTypes}
          startFor={startReq}
          onConsumedStart={() => setStartReq(null)}
          onFinished={() => load(days)}
        />
        <TrainingPlan
          onChange={() => load(days)}
          onStart={(it) => setStartReq({ name: it.name, exerciseType: it.exerciseType, exercises: it.exercises, planItemId: it.id })}
        />
      </div>

      <div className="stack desk-grid">
        {/* Exercise days hero */}
        <section className="card rise rise-2">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="card-label">
              <IconChip icon={DumbbellIcon} color="var(--food)" />
              Exercise days
            </div>
            <span className="badge" style={{ background: "var(--food-soft)", color: "var(--food)" }}>
              this week
            </span>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 10 }}>
            <span className="display-num" style={{ fontSize: 34, color: "var(--food)" }}>{exerciseDays}</span>
            <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>of 5 exercise days</span>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"} · {fmtDur(totalMin)}
            {totalKcal ? ` · ${totalKcal.toLocaleString()} kcal` : ""} in the last {days === 7 ? "week" : "month"}
          </p>
          <div className="row" style={{ gap: 4, marginTop: 14, justifyContent: "space-between" }}>
            {weekDates.map((d) => {
              const hit = sessionDates.has(d);
              const isToday = d === today;
              return (
                <div key={d} className={`streak-day ${isToday ? "today" : ""}`}>
                  <div className={`streak-dot ${hit ? "hit" : ""}`} style={hit ? { background: "var(--food)", borderColor: "var(--food)" } : undefined}>
                    {hit ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "block" }} />
                    )}
                  </div>
                  <span className="day-letter">{dayLetter(d)}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Cardio load (estimated from active zone minutes) */}
        <section className="card rise rise-2">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="card-label">
              <IconChip icon={HeartIcon} color="var(--heart)" />
              Cardio load
            </div>
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>est. from zone minutes</span>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 10 }}>
            <span className="display-num" style={{ fontSize: 34, color: "var(--heart)" }}>
              {azmToday != null ? Math.round(azmToday) : "—"}
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>today</span>
          </div>
          <div style={{ marginTop: 10 }}>
            {trends ? (
              <Sparkline
                values={trends.azm.map((p) => p.value)}
                color="var(--heart)"
                dots
                fill
                labels={azmLabels}
                tipLabels={azmDates}
                tipFormat={(v) => `${Math.round(v)} load`}
                height={64}
                width={300}
              />
            ) : (
              <p className="pulsing" style={{ color: "var(--ink-soft)", fontSize: 13 }}>Loading…</p>
            )}
          </div>
        </section>

        {/* Energy burned */}
        <section className="card rise rise-3">
          <div className="card-label">
            <IconChip icon={FlameIcon} color="var(--food)" />
            Energy burned
          </div>
          <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 10 }}>
            <span className="display-num" style={{ fontSize: 30 }}>
              {trends?.caloriesOut?.length
                ? Math.round(trends.caloriesOut[trends.caloriesOut.length - 1].value ?? 0).toLocaleString()
                : "—"}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>kcal today</span>
          </div>
          <div style={{ marginTop: 10 }}>
            {trends && (() => {
              const week = trends.caloriesOut.slice(-7);
              const burned = week.map((p) => p.value ?? 0);
              // Calories burned sit on a high constant floor (~2,500/day), so
              // scaling from zero flattens the bars. Anchor the chart just below
              // the week's lowest day so daily variation actually reads.
              const pos = burned.filter((v) => v > 0);
              const lo = pos.length ? Math.min(...pos) : 0;
              const hi = burned.length ? Math.max(...burned) : 0;
              return (
                <Bars
                  values={burned}
                  color="var(--food)"
                  labels={week.map((p) => dayLetter(p.date))}
                  tipFormat={(v) => `${Math.round(v).toLocaleString()} kcal`}
                  height={56}
                  baseline={lo - (hi - lo) * 0.3}
                />
              );
            })()}
          </div>
        </section>

        {/* Log a workout */}
        <section className="card rise rise-3">
          <div className="card-label">
            <IconChip icon={DumbbellIcon} color="var(--activity)" />
            Log a workout
          </div>
          <div style={{ marginTop: 12 }}>
            <WorkoutTypePicker quickTypes={quickTypes} selected={logType.type} onPick={setLogType} />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 80px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>min</span>
              <input className="field" type="number" min={1} inputMode="numeric" value={logMin} onChange={(e) => setLogMin(e.target.value)} onBlur={() => setLogMin((s) => (s.trim() === "" ? "45" : String(Math.max(1, Math.round(Number(s) || 45)))))} style={{ padding: "8px 10px", marginTop: 3 }} />
            </label>
            <label style={{ flex: "2 1 130px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>date</span>
              <input className="field" type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} style={{ padding: "8px 10px", marginTop: 3 }} />
            </label>
            <label style={{ flex: "1 1 100px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>time</span>
              <input className="field" type="time" value={logTime} onChange={(e) => setLogTime(e.target.value)} style={{ padding: "8px 10px", marginTop: 3 }} />
            </label>
          </div>
          <input
            className="field"
            placeholder="Notes (e.g. legs, push day)…"
            value={logNotes}
            onChange={(e) => setLogNotes(e.target.value)}
            style={{ marginTop: 8, padding: "9px 12px" }}
          />
          <div style={{ marginTop: 12 }}>
            <WorkoutDetailForm value={logDetail} onChange={setLogDetail} accent="var(--activity)" accentSoft="var(--activity-soft)" />
          </div>
          <button className="btn" style={{ background: "var(--activity)", marginTop: 12, width: "100%" }} onClick={saveWorkout} disabled={logSaving}>
            {logSaving ? "Saving…" : "Save workout"}
          </button>
          <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>
            Saved to your journal and synced to Google Health when connected. You can also just tell the coach.
          </p>
        </section>

        {/* History */}
        <h2 className="section-title desk-span rise rise-4">History</h2>
        <section className="desk-span rise rise-4">
          {loading ? (
            <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading workouts…</p>
          ) : dayKeys.length === 0 ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>No workouts in this range.</p>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {dayKeys.map((date) => (
                <div key={date}>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>
                    {dayHeading(date, today)}
                  </p>
                  <div className="stack" style={{ gap: 8 }}>
                    {byDay.get(date)!.map((w) => (
                      <div key={w.id} className="card" style={{ padding: "12px 16px" }}>
                        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                          <div className="row" style={{ gap: 12, minWidth: 0 }}>
                            <IconChip icon={workoutIcon(w.exerciseType)} color="var(--food)" size={34} />
                            <div style={{ minWidth: 0 }}>
                              <strong style={{ fontSize: 14.5, textTransform: "capitalize" }}>{workoutLabel(w)}</strong>
                              <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                                {w.startTime} · {fmtDur(w.durationMin)}
                                {w.distanceKm ? ` · ${w.distanceKm} km` : ""}
                                {w.avgHr ? ` · ${w.avgHr} bpm avg` : ""}
                                {w.notes ? ` · ${w.notes}` : ""}
                                {w.source === "journal" && (w.syncedToHealth ? " · ✓ synced" : " · journal")}
                                {w.overridden ? (w.overrideSynced ? " · relabeled ✓ Google" : " · relabeled locally") : ""}
                              </p>
                              {!detailIsEmpty(w.detail) && (
                                <p style={{ fontSize: 11.5, color: "var(--activity)", marginTop: 2 }}>
                                  {formatDetail(w.detail)}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="row" style={{ gap: 10, flex: "none" }}>
                            {w.calories != null && (
                              <span className="display-num" style={{ fontSize: 16, color: "var(--food)" }}>
                                {w.calories} kcal
                              </span>
                            )}
                            <button
                              onClick={() => {
                                const open = editing === w.id ? null : w.id;
                                setEditing(open);
                                if (open) setDetailDraft(w.detail ?? {});
                              }}
                              style={{ background: "none", border: "none", color: editing === w.id ? "var(--activity)" : "var(--ink-faint)", cursor: "pointer", fontSize: 14 }}
                              aria-label="edit workout"
                              title="Edit type & detail"
                            >
                              ✎
                            </button>
                            {w.source === "journal" && (
                              <button
                                onClick={() => removeSession(w.id)}
                                style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 14 }}
                                aria-label="delete workout"
                                title="Delete journal entry"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                        {w.awaitingWatchMatch && (() => {
                          const candidates = byDay.get(date)!.filter((s) => s.googleName && s.id !== w.id);
                          return (
                            <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 10, background: "var(--bg-inset)", borderLeft: "3px solid var(--activity)" }}>
                              <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Logged here — waiting to merge with your watch’s session so it isn’t counted twice.</p>
                              <div className="row" style={{ gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                                {candidates.map((c) => (
                                  <button key={c.id} className="btn btn-ghost" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => resolveSession(w.id, { action: "linkGoogle", googleName: c.googleName, calories: c.calories, avgHr: c.avgHr })}>
                                    Merge with {c.startTime} {labelForType(c.exerciseType)}
                                  </button>
                                ))}
                                <button className="btn btn-ghost" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => resolveSession(w.id, { action: "pushToGoogle" })}>
                                  Save to Google now
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                        {editing === w.id && (
                          <div style={{ marginTop: 12, borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
                            <p style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", marginBottom: 8 }}>
                              Set type
                            </p>
                            <WorkoutTypePicker
                              quickTypes={quickTypes}
                              selected={w.exerciseType}
                              onPick={(t) => relabel(w, t)}
                              onRevert={w.overridden ? () => relabel(w) : undefined}
                            />
                            <p style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", margin: "14px 0 8px" }}>
                              Detail
                            </p>
                            <WorkoutDetailForm value={detailDraft} onChange={setDetailDraft} accent="var(--activity)" accentSoft="var(--activity-soft)" />
                            <button
                              className="btn"
                              style={{ background: "var(--activity)", marginTop: 12, width: "100%" }}
                              onClick={() => saveDetail(w, detailDraft)}
                            >
                              Save detail
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
