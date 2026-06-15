"use client";

import { useEffect, useState } from "react";
import Ring from "@/components/Ring";
import GoalBar from "@/components/GoalBar";
import SleepClock from "@/components/SleepClock";
import RangeBars from "@/components/RangeBars";
import Hypnogram from "@/components/Hypnogram";
import { Sparkline, Bars, SignedBars } from "@/components/Sparkline";
import ThemeToggle from "@/components/ThemeToggle";
import AvatarMenu from "@/components/AvatarMenu";
import {
  IconChip,
  StepsIcon,
  HeartIcon,
  PulseIcon,
  MoonIcon,
  FlameIcon,
  LungsIcon,
  ScaleIcon,
  DumbbellIcon,
  DropIcon,
  workoutIcon,
} from "@/components/icons";
import { DaySummary, HealthPayload, WorkoutSession } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Consecutive days (ending today) where the step goal was hit. */
function stepStreak(week: DaySummary[]): number {
  let n = 0;
  for (let i = week.length - 1; i >= 0; i--) {
    if (week[i].steps >= week[i].stepsGoal) n++;
    else if (i === week.length - 1) continue; // today not done yet doesn't break it
    else break;
  }
  return n;
}

const dayLetter = (date: string) => "SMTWTFS"[new Date(date + "T00:00:00").getDay()];

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

function addDaysStr(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Daily() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [err, setErr] = useState("");
  const [serverToday, setServerToday] = useState("");
  const [dayBusy, setDayBusy] = useState(false);
  const [water, setWater] = useState<{ ml: number; glasses: number } | null>(null);
  const [waterBusy, setWaterBusy] = useState(false);
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState(QUICK_TYPES[2]);
  const [logMin, setLogMin] = useState(45);
  const [logSaving, setLogSaving] = useState(false);

  useEffect(() => {
    fetch("/api/health?view=today")
      .then((r) => r.json())
      .then((j: HealthPayload) => {
        setData(j);
        setServerToday(j.today.date); // the app's "today" in the data timezone
        loadWater(j.today.date);
      })
      .catch(() => setErr("Could not load health data."));
    loadWorkouts();
  }, []);

  const loadWater = (date: string) =>
    fetch(`/api/water?date=${date}`).then((r) => r.json()).then(setWater).catch(() => {});

  async function changeDay(delta: number) {
    if (!data || dayBusy) return;
    const next = addDaysStr(data.today.date, delta);
    if (next > serverToday) return;
    setDayBusy(true);
    try {
      const res = await fetch(`/api/health?view=today&date=${next}`);
      setData(await res.json());
      loadWater(next);
    } finally {
      setDayBusy(false);
    }
  }

  async function resyncDay() {
    if (!data || dayBusy) return;
    const date = data.today.date;
    setDayBusy(true);
    try {
      await fetch("/api/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resync", date }),
      });
      const res = await fetch(`/api/health?view=today&date=${date}`);
      setData(await res.json());
      loadWater(date);
    } finally {
      setDayBusy(false);
    }
  }

  const loadWorkouts = () =>
    fetch("/api/workouts?days=7")
      .then((r) => r.json())
      .then((j) => setWorkouts(j.sessions ?? []))
      .catch(() => {});

  async function changeWater(delta: number) {
    if (waterBusy) return;
    setWaterBusy(true);
    // optimistic: reflect the tap instantly, reconcile with the server below
    const before = water;
    if (before) {
      const ml = Math.max(0, before.ml + delta * 250);
      setWater({ ml, glasses: Math.round(ml / 250) });
    }
    try {
      const res = await fetch("/api/water", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) throw new Error();
      setWater(await res.json());
    } catch {
      setWater(before); // revert on failure
    } finally {
      setWaterBusy(false);
    }
  }

  async function saveWorkout() {
    setLogSaving(true);
    try {
      await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: logType.label, exerciseType: logType.type, durationMin: logMin }),
      });
      setLogOpen(false);
      await loadWorkouts();
    } finally {
      setLogSaving(false);
    }
  }

  if (err) return <main className="page"><p>{err}</p></main>;
  if (!data)
    return (
      <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="orb" style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--activity-soft)", border: "2px solid var(--activity)" }} />
      </main>
    );

  const t = data.today;
  const sleep = t.sleep;
  const balance = t.caloriesIn - t.caloriesOut;
  const streak = stepStreak(data.week);
  const todayHit = t.steps >= t.stepsGoal;
  const toGo = Math.max(t.stepsGoal - t.steps, 0);
  const weekLabels = data.week.map((d) => dayLetter(d.date));
  const sleepGoalMet = (sleep?.durationMin ?? 0) >= 420;

  const isToday = t.date === serverToday;
  const isYesterday = t.date === addDaysStr(serverToday, -1);
  const dayLabel = isToday
    ? "Today"
    : isYesterday
      ? "Yesterday"
      : new Date(t.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  const workoutDates = new Set(workouts.map((w) => w.date));
  const exerciseDays = data.week.filter((d) => workoutDates.has(d.date)).length;
  const recentWorkouts = workouts.slice(0, 4);
  const glassesGoal = 8; // 2 L

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 className="page-title">
              {isToday
                ? `${greeting()}.`
                : new Date(t.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + "."}
            </h1>
            <p className="page-sub">
              {data.demo ? (
                <a href="/api/googlehealth/auth" style={{ color: "var(--food)", fontWeight: 600, textDecoration: "none" }}>
                  demo data — connect Google Health
                </a>
              ) : (
                <span style={{ color: "var(--activity)", fontWeight: 600 }}>live · Google Health</span>
              )}
            </p>
          </div>
          <div className="row" style={{ gap: 8, flex: "none" }}>
            <span className="desk-only">
              <ThemeToggle />
            </span>
            <AvatarMenu />
          </div>
        </div>

        {/* second line: day selector + quick water */}
        <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="icon-btn" aria-label="previous day" onClick={() => changeDay(-1)} disabled={dayBusy} style={{ opacity: dayBusy ? 0.5 : 1 }}>
              ‹
            </button>
            <span
              className="badge"
              style={{ background: "var(--bg-raised)", border: "1px solid var(--hairline)", minWidth: 86, justifyContent: "center", height: 38, borderRadius: 19, fontSize: 12.5 }}
            >
              {dayBusy ? "…" : dayLabel}
            </span>
            <button
              className="icon-btn"
              aria-label="next day"
              onClick={() => changeDay(1)}
              disabled={dayBusy || isToday}
              style={{ opacity: dayBusy || isToday ? 0.4 : 1 }}
            >
              ›
            </button>
            {!isToday && (
              <button
                className="icon-btn"
                aria-label="re-sync this day from Google Health"
                title="Re-sync this day from Google Health (picks up edits made in other apps)"
                onClick={resyncDay}
                disabled={dayBusy}
                style={{ opacity: dayBusy ? 0.5 : 1 }}
              >
                ↻
              </button>
            )}
          </div>
          {isToday && water && (
            <button
              aria-label="add a glass of water"
              title="Tap to add a 250 ml glass"
              onClick={() => changeWater(1)}
              disabled={waterBusy}
              className="badge"
              style={{
                cursor: "pointer",
                border: "1px solid color-mix(in srgb, var(--breath) 40%, transparent)",
                background: "var(--breath-soft)",
                color: "var(--breath)",
                height: 38,
                borderRadius: 19,
                gap: 7,
                padding: "0 14px",
                fontSize: 13,
                opacity: waterBusy ? 0.6 : 1,
              }}
            >
              <span style={{ width: 15, height: 15, display: "flex" }}>{DropIcon}</span>
              {(water.ml / 1000).toFixed(2)} L
              <span style={{ fontWeight: 800 }}>+</span>
            </button>
          )}
        </div>
      </header>

      <div className="stack desk-grid">
        <h2 className="section-title desk-span rise rise-1">Daily activity</h2>

        {/* Movement */}
        <section className="card rise rise-2">
          <div className="card-label">
            <IconChip icon={StepsIcon} color="var(--activity)" />
            Movement
          </div>
          <div className="row" style={{ gap: 20, marginTop: 14, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                <span className="display-num" style={{ fontSize: 36, color: "var(--activity)" }}>
                  {t.steps.toLocaleString()}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>steps</span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "2px 0 10px" }}>
                {dayLabel}
                {todayHit ? " · goal met" : isToday ? ` · ${toGo.toLocaleString()} to go` : " · goal missed"}
              </p>
              <GoalBar value={t.steps} goal={t.stepsGoal} color="var(--activity)" />
              <div className="row" style={{ gap: 16, marginTop: 14, fontSize: 12.5, color: "var(--ink-soft)", flexWrap: "wrap" }}>
                <span><strong className="display-num" style={{ fontSize: 15, color: "var(--ink)" }}>{t.distanceKm.toFixed(1)}</strong> km</span>
                <span><strong className="display-num" style={{ fontSize: 15, color: "var(--ink)" }}>{t.floors}</strong> floors</span>
                <span><strong className="display-num" style={{ fontSize: 15, color: "var(--ink)" }}>{t.caloriesOut.toLocaleString()}</strong> kcal</span>
              </div>
            </div>
            <Ring progress={t.activeZoneMinutes / t.azmGoal} color="var(--food)" track="var(--food-soft)" size={96} stroke={9}>
              <span className="display-num" style={{ fontSize: 21 }}>{t.activeZoneMinutes}</span>
              <span style={{ fontSize: 9.5, color: "var(--ink-soft)", textAlign: "center", lineHeight: 1.2 }}>zone min<br />of {t.azmGoal}</span>
            </Ring>
          </div>
        </section>

        {/* Streak */}
        <section className="card rise rise-2">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="card-label">
              <IconChip icon={FlameIcon} color="var(--activity)" />
              Streak
            </div>
            <span className="badge" style={{ background: "var(--activity-soft)", color: "var(--activity)" }}>
              {streak} day{streak === 1 ? "" : "s"}
            </span>
          </div>
          <div className="row" style={{ gap: 4, marginTop: 16, justifyContent: "space-between" }}>
            {data.week.map((d, i) => {
              const hit = d.steps >= d.stepsGoal;
              const isToday = i === data.week.length - 1;
              return (
                <div key={d.date} className={`streak-day ${isToday ? "today" : ""}`} title={`${d.date}: ${d.steps.toLocaleString()} steps`}>
                  <div className={`streak-dot ${hit ? "hit" : ""}`}>
                    {hit ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "block" }} />
                    )}
                  </div>
                  <span className="day-letter">{dayLetter(d.date)}</span>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 13 }}>
            {todayHit
              ? streak >= 3
                ? `On fire — ${streak} days straight. Keep the chain alive tomorrow.`
                : "Goal hit today. One day at a time builds the chain."
              : `${toGo.toLocaleString()} steps to keep the streak going today.`}
          </p>
        </section>

        {/* Water — shown every day; quick-add is a "now" action, so the +/− controls only appear on today. */}
        <section className="card rise rise-3">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="card-label">
              <IconChip icon={DropIcon} color="var(--breath)" />
              Water
            </div>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>glass = 250 ml</span>
          </div>
          <div className="row" style={{ gap: 16, marginTop: 14, justifyContent: "space-between" }}>
            <div>
              <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
                <span className="display-num" style={{ fontSize: 32, color: "var(--breath)" }}>
                  {((water?.ml ?? 0) / 1000).toFixed(2)}
                </span>
                <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>L</span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
                {water?.glasses ?? 0} of {glassesGoal} glasses
              </p>
            </div>
            {isToday && (
            <div className="row" style={{ gap: 10 }}>
              <button
                className="icon-btn"
                aria-label="remove glass"
                disabled={waterBusy || !water?.glasses}
                onClick={() => changeWater(-1)}
                style={{ opacity: waterBusy || !water?.glasses ? 0.4 : 1 }}
              >
                −
              </button>
              <button
                className="icon-btn"
                aria-label="add glass"
                disabled={waterBusy}
                onClick={() => changeWater(1)}
                style={{ background: "var(--breath)", color: "var(--bg)", borderColor: "var(--breath)", fontSize: 18 }}
              >
                +
              </button>
            </div>
            )}
          </div>
          <div className="row" style={{ gap: 5, marginTop: 13 }}>
            {Array.from({ length: glassesGoal }, (_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 9,
                  borderRadius: 5,
                  background:
                    i < (water?.glasses ?? 0)
                      ? "var(--breath)"
                      : "color-mix(in srgb, var(--breath) 15%, var(--bg-inset))",
                  transition: "background 0.3s",
                }}
              />
            ))}
          </div>
        </section>

        {/* Activity / workouts */}
        <section className="card rise rise-3">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="card-label">
              <IconChip icon={DumbbellIcon} color="var(--food)" />
              Workouts
            </div>
            <span className="badge" style={{ background: "var(--food-soft)", color: "var(--food)" }}>
              {exerciseDays} of 5 exercise days
            </span>
          </div>
          <div className="row" style={{ gap: 4, marginTop: 14, justifyContent: "space-between" }}>
            {data.week.map((d, i) => {
              const hit = workoutDates.has(d.date);
              const isToday = i === data.week.length - 1;
              return (
                <div key={d.date} className={`streak-day ${isToday ? "today" : ""}`}>
                  <div className={`streak-dot ${hit ? "hit" : ""}`} style={hit ? { background: "var(--food)", borderColor: "var(--food)" } : undefined}>
                    {hit ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "block" }} />
                    )}
                  </div>
                  <span className="day-letter">{dayLetter(d.date)}</span>
                </div>
              );
            })}
          </div>

          <div className="stack" style={{ gap: 8, marginTop: 14 }}>
            {recentWorkouts.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>No workouts this week yet.</p>
            )}
            {recentWorkouts.map((w) => (
              <div key={w.id} className="row" style={{ gap: 10, justifyContent: "space-between" }}>
                <div className="row" style={{ gap: 10, minWidth: 0 }}>
                  <IconChip icon={workoutIcon(w.exerciseType)} color="var(--food)" size={30} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5, textTransform: "capitalize" }}>{w.name}</strong>
                    <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                      {w.date === data.today.date ? "Today" : dayLetter(w.date) + " " + w.date.slice(5)} · {w.startTime} · {w.durationMin} min
                      {w.source === "journal" && (w.syncedToHealth ? " · ✓ synced" : " · journal")}
                    </p>
                  </div>
                </div>
                <span className="display-num" style={{ fontSize: 14, color: "var(--food)", flex: "none" }}>
                  {w.calories ? `${w.calories} kcal` : w.avgHr ? `${w.avgHr} bpm` : ""}
                </span>
              </div>
            ))}
          </div>

          {logOpen ? (
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {QUICK_TYPES.map((q) => (
                  <button
                    key={q.type}
                    className="badge"
                    onClick={() => setLogType(q)}
                    style={{
                      cursor: "pointer",
                      border: "none",
                      background: q.type === logType.type ? "var(--food)" : "var(--food-soft)",
                      color: q.type === logType.type ? "var(--bg)" : "var(--food)",
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <input
                  className="field"
                  type="number"
                  value={logMin}
                  min={1}
                  onChange={(e) => setLogMin(Number(e.target.value))}
                  style={{ width: 90, padding: "8px 10px" }}
                />
                <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>min</span>
                <button className="btn" style={{ background: "var(--food)", padding: "9px 18px", fontSize: 13 }} onClick={saveWorkout} disabled={logSaving}>
                  {logSaving ? "Saving…" : "Save"}
                </button>
                <button className="btn btn-ghost" style={{ padding: "9px 14px", fontSize: 13 }} onClick={() => setLogOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 13, padding: "8px 16px" }} onClick={() => setLogOpen(true)}>
              + Log activity
            </button>
          )}
        </section>

        <h2 className="section-title desk-span rise rise-3">Sleep</h2>

        {/* Sleep */}
        <section className="card desk-span rise rise-3">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="card-label">
              <IconChip icon={MoonIcon} color="var(--sleep)" />
              Sleep
            </div>
            {sleep && (
              <div className="row" style={{ gap: 8 }}>
                <span className="badge" style={{ background: "var(--sleep-soft)", color: "var(--sleep)" }}>
                  {sleep.efficiency}% efficiency
                </span>
                <span
                  className="badge"
                  style={{
                    background: sleepGoalMet ? "var(--activity-soft)" : "var(--food-soft)",
                    color: sleepGoalMet ? "var(--activity)" : "var(--food)",
                  }}
                >
                  {sleepGoalMet ? "Goal met" : "Goal not met"}
                </span>
              </div>
            )}
          </div>
          {sleep ? (
            <div className="row" style={{ gap: 26, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <SleepClock start={sleep.startTime} end={sleep.endTime} durationMin={sleep.durationMin} size={148} />
              <div style={{ flex: 1, minWidth: 260 }}>
                {sleep.segments?.length ? (
                  <Hypnogram segments={sleep.segments} startTime={sleep.startTime} />
                ) : (
                  <div className="row" style={{ gap: 14, fontSize: 12, color: "var(--ink-soft)", flexWrap: "wrap" }}>
                    <span>deep {sleep.stages.deep}m</span>
                    <span>rem {sleep.stages.rem}m</span>
                    <span>light {sleep.stages.light}m</span>
                    <span>awake {sleep.stages.wake}m</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p style={{ marginTop: 10, color: "var(--ink-soft)" }}>No sleep recorded last night.</p>
          )}
        </section>

        <h2 className="section-title desk-span rise rise-4">Key metrics</h2>

        {/* Heart */}
        <section className="card rise rise-4">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="card-label">
              <IconChip icon={HeartIcon} color="var(--heart)" />
              Heart
            </div>
            {t.restingHeartRate && (
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                resting <strong className="display-num" style={{ fontSize: 16, color: "var(--heart)" }}>{t.restingHeartRate}</strong> bpm
              </span>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <RangeBars points={t.heartIntraday} color="var(--heart)" />
          </div>
          <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {t.heartZones.filter((z) => z.name !== "Out of Range" && z.minutes > 0).map((z) => (
              <span key={z.name} className="badge" style={{ background: "var(--heart-soft)", color: "var(--heart)" }}>
                {z.name} {z.minutes}m
              </span>
            ))}
          </div>
        </section>

        {/* Energy balance */}
        <section className="card rise rise-4">
          <div className="card-label">
            <IconChip icon={FlameIcon} color="var(--food)" />
            Energy balance
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 12, alignItems: "baseline" }}>
            <div>
              <span className="display-num" style={{ fontSize: 25 }}>{t.caloriesIn.toLocaleString()}</span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}> in</span>
            </div>
            <span className="display-num" style={{ fontSize: 16, color: balance > 0 ? "var(--food)" : "var(--activity)" }}>
              {balance > 0 ? "+" : ""}{balance.toLocaleString()}
            </span>
            <div>
              <span className="display-num" style={{ fontSize: 25 }}>{t.caloriesOut.toLocaleString()}</span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}> out</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <SignedBars
              values={data.week.map((d) => d.caloriesIn - d.caloriesOut)}
              posColor="var(--food)"
              negColor="var(--activity)"
              labels={weekLabels}
              height={64}
              tipFormat={(v) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()} kcal`}
            />
          </div>
        </section>

        <MetricRow
          label="Resting heart rate"
          icon={HeartIcon}
          value={t.restingHeartRate != null ? String(t.restingHeartRate) : "—"}
          unit="bpm"
          color="var(--heart)"
          series={data.week.map((d) => d.restingHeartRate)}
          labels={weekLabels}
          sub={dayLabel}
          rise={5}
        />
        <MetricRow
          label="Heart rate variability"
          icon={PulseIcon}
          value={t.hrv != null ? String(t.hrv) : "—"}
          unit="ms"
          color="var(--heart)"
          series={data.week.map((d) => d.hrv)}
          labels={weekLabels}
          sub={dayLabel}
          rise={5}
        />
        <MetricRow
          label="SpO₂"
          icon={LungsIcon}
          value={t.spo2 != null ? String(t.spo2) : "—"}
          unit="%"
          color="var(--breath)"
          series={data.week.map((d) => d.spo2)}
          labels={weekLabels}
          sub={dayLabel}
          rise={5}
        />
        <MetricRow
          label="Breathing rate"
          icon={LungsIcon}
          value={t.breathingRate != null ? String(t.breathingRate) : "—"}
          unit="br/min"
          color="var(--breath)"
          series={data.week.map((d) => d.breathingRate)}
          labels={weekLabels}
          sub={dayLabel}
          rise={6}
        />
        <MetricRow
          label="Weight"
          icon={ScaleIcon}
          value={t.weightKg != null ? String(t.weightKg) : "—"}
          unit="kg"
          color="var(--food)"
          series={data.week.map((d) => d.weightKg)}
          labels={weekLabels}
          sub={dayLabel}
          rise={6}
        />
        <MetricRow
          label="Steps this week"
          icon={StepsIcon}
          value={Math.round(data.week.reduce((a, d) => a + d.steps, 0) / data.week.length).toLocaleString()}
          unit="avg/day"
          color="var(--activity)"
          series={data.week.map((d) => d.steps)}
          labels={weekLabels}
          sub="Last 7 days"
          bars
          rise={6}
        />
      </div>
    </main>
  );
}

/** Google-Health-style key-metric row: value left, weekly chart right. */
function MetricRow({
  label,
  icon,
  value,
  unit,
  color,
  series,
  labels,
  bars = false,
  rise,
  sub = "Today",
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  unit: string;
  color: string;
  series: (number | null)[];
  labels: string[];
  bars?: boolean;
  rise: number;
  sub?: string;
}) {
  return (
    <section className={`card rise rise-${rise}`} style={{ padding: "15px 18px" }}>
      <div className="card-label">
        <IconChip icon={icon} color={color} />
        {label}
      </div>
      <div className="row" style={{ justifyContent: "space-between", gap: 18, marginTop: 8 }}>
        <div style={{ flex: "none" }}>
          <div className="row" style={{ gap: 5, alignItems: "baseline" }}>
            <span className="display-num" style={{ fontSize: 27 }}>{value}</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{unit}</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{sub}</p>
        </div>
        <div style={{ width: "52%", maxWidth: 230, alignSelf: "center" }}>
          {bars ? (
            <Bars values={series.map((v) => v ?? 0)} color={color} labels={labels} height={52} />
          ) : (
            <Sparkline values={series} color={color} dots labels={labels} height={56} width={230} />
          )}
        </div>
      </div>
    </section>
  );
}
