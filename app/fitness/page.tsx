"use client";

import { useEffect, useState } from "react";
import { Sparkline, Bars } from "@/components/Sparkline";
import { IconChip, DumbbellIcon, FlameIcon, HeartIcon, workoutIcon } from "@/components/icons";
import { TrendsPayload, WorkoutSession } from "@/lib/types";

const RANGES = [
  { label: "Week", days: 7 },
  { label: "Month", days: 31 },
];

const QUICK_TYPES = [
  { label: "Walk", type: "WALKING" },
  { label: "Run", type: "RUNNING" },
  { label: "Weights", type: "STRENGTH_TRAINING" },
  { label: "HIIT", type: "HIIT" },
  { label: "Yoga", type: "YOGA" },
  { label: "Bike", type: "BIKING" },
  { label: "Swim", type: "SWIMMING_POOL" },
  { label: "Other", type: "WORKOUT" },
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
  const [logType, setLogType] = useState(QUICK_TYPES[2]);
  const [logMin, setLogMin] = useState(45);
  const [logDate, setLogDate] = useState("");
  const [logTime, setLogTime] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logSaving, setLogSaving] = useState(false);

  const load = (d: number) => {
    setLoading(true);
    Promise.all([
      fetch(`/api/workouts?days=${d}`).then((r) => r.json()),
      fetch(`/api/health?view=trends&days=14`).then((r) => r.json()),
    ])
      .then(([w, t]) => {
        setSessions(w.sessions ?? []);
        setRange(w.range ?? null);
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
          durationMin: logMin,
          date: logDate || undefined,
          startTime: logTime || undefined,
          notes: logNotes || undefined,
        }),
      });
      setLogOpen(false);
      setLogNotes("");
      load(days);
    } finally {
      setLogSaving(false);
    }
  }

  async function removeSession(id: string) {
    await fetch(`/api/workouts?id=${id}`, { method: "DELETE" });
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
            {trends && (
              <Bars
                values={trends.caloriesOut.slice(-7).map((p) => p.value ?? 0)}
                color="var(--food)"
                labels={trends.caloriesOut.slice(-7).map((p) => dayLetter(p.date))}
                tipFormat={(v) => `${Math.round(v).toLocaleString()} kcal`}
                height={56}
              />
            )}
          </div>
        </section>

        {/* Log a workout */}
        <section className="card rise rise-3">
          <div className="card-label">
            <IconChip icon={DumbbellIcon} color="var(--activity)" />
            Log a workout
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {QUICK_TYPES.map((q) => (
              <button
                key={q.type}
                className="badge"
                onClick={() => setLogType(q)}
                style={{
                  cursor: "pointer",
                  border: "none",
                  background: q.type === logType.type ? "var(--activity)" : "var(--activity-soft)",
                  color: q.type === logType.type ? "var(--bg)" : "var(--activity)",
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 80px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase" }}>min</span>
              <input className="field" type="number" min={1} value={logMin} onChange={(e) => setLogMin(Number(e.target.value))} style={{ padding: "8px 10px", marginTop: 3 }} />
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
          <button className="btn" style={{ background: "var(--activity)", marginTop: 10, width: "100%" }} onClick={saveWorkout} disabled={logSaving}>
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
                      <div key={w.id} className="card row" style={{ padding: "12px 16px", justifyContent: "space-between", gap: 10 }}>
                        <div className="row" style={{ gap: 12, minWidth: 0 }}>
                          <IconChip icon={workoutIcon(w.exerciseType)} color="var(--food)" size={34} />
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ fontSize: 14.5, textTransform: "capitalize" }}>{w.name}</strong>
                            <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                              {w.startTime} · {fmtDur(w.durationMin)}
                              {w.distanceKm ? ` · ${w.distanceKm} km` : ""}
                              {w.avgHr ? ` · ${w.avgHr} bpm avg` : ""}
                              {w.notes ? ` · ${w.notes}` : ""}
                              {w.source === "journal" && (w.syncedToHealth ? " · ✓ synced" : " · journal")}
                            </p>
                          </div>
                        </div>
                        <div className="row" style={{ gap: 10, flex: "none" }}>
                          {w.calories != null && (
                            <span className="display-num" style={{ fontSize: 16, color: "var(--food)" }}>
                              {w.calories} kcal
                            </span>
                          )}
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
