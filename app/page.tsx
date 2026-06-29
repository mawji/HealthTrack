"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Ring from "@/components/Ring";
import GoalBar from "@/components/GoalBar";
import SleepClock from "@/components/SleepClock";
import RangeBars from "@/components/RangeBars";
import Hypnogram from "@/components/Hypnogram";
import { Sparkline, Bars, SignedBars } from "@/components/Sparkline";
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
  workoutLabel,
  habitIcon,
} from "@/components/icons";
import { WorkoutTypePicker } from "@/components/WorkoutTypePicker";
import { WorkoutDetailForm } from "@/components/WorkoutDetailForm";
import ExerciseSnacks from "@/components/ExerciseSnacks";
import MedicationsWidget from "@/components/MedicationsWidget";
import MedicationAlert from "@/components/MedicationAlert";
import CoachQuestionCard from "@/components/CoachQuestionCard";
import type { WorkoutPlanItem } from "@/lib/training-plan";
import { DEFAULT_QUICK_TYPES, WorkoutType } from "@/lib/workout-types";
import { detailIsEmpty, formatDetail } from "@/lib/workout-detail";
import {
  DaySummary,
  HealthPayload,
  WorkoutSession,
  WorkoutDetail,
  DailyInsightsResponse,
  InsightSection,
  ReadinessScore,
  HabitDefinition,
  HabitComputedStatus,
  HabitsPayload,
  GoalDefinition,
  GoalProgress,
  GoalStatus,
} from "@/lib/types";

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
  const [nextPlan, setNextPlan] = useState<WorkoutPlanItem | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState<WorkoutType>(DEFAULT_QUICK_TYPES[2]);
  const [quickTypes, setQuickTypes] = useState<WorkoutType[]>(DEFAULT_QUICK_TYPES);
  const [logMin, setLogMin] = useState("45"); // raw string so it can be cleared/edited freely
  const [logNotes, setLogNotes] = useState("");
  const [logDetail, setLogDetail] = useState<WorkoutDetail>({});
  const [showDetail, setShowDetail] = useState(false);
  const [logSaving, setLogSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [insights, setInsights] = useState<DailyInsightsResponse | null>(null);
  const [habits, setHabits] = useState<HabitsPayload | null>(null);
  const [habitBusy, setHabitBusy] = useState<string | null>(null);
  const [goalsData, setGoalsData] = useState<{ goals: GoalDefinition[]; progress: GoalProgress[] } | null>(null);

  // Auto-refresh and lastUpdated states
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshCurrentData = useCallback(async (date: string, isSilent = false) => {
    if (!date) return;
    if (!isSilent) setDayBusy(true);
    try {
      const [healthRes, workoutsRes, goalsRes, waterRes] = await Promise.all([
        fetch(`/api/health?view=today&date=${date}`).then((r) => r.json()),
        fetch("/api/workouts?days=7").then((r) => r.json()),
        fetch("/api/goals").then((r) => r.json()),
        fetch(`/api/water?date=${date}`).then((r) => r.json()),
      ]);

      setData(healthRes);
      setWorkouts(workoutsRes.sessions ?? []);
      if (workoutsRes.quickTypes?.length) setQuickTypes(workoutsRes.quickTypes);
      setGoalsData(goalsRes);
      setWater(waterRes);

      const [insightsRes, habitsRes] = await Promise.all([
        fetch(`/api/daily-insights?date=${date}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/habits?date=${date}`).then((r) => r.json()).catch(() => null),
      ]);
      if (insightsRes) setInsights(insightsRes);
      if (habitsRes) setHabits(habitsRes);

      setLastUpdated(new Date());
    } catch (e) {
      console.error("Auto refresh failed", e);
    } finally {
      if (!isSilent) setDayBusy(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/health?view=today")
      .then((r) => r.json())
      .then((j: HealthPayload) => {
        setData(j);
        setServerToday(j.today.date); // the app's "today" in the data timezone
        loadWater(j.today.date);
        setLastUpdated(new Date());
      })
      .catch(() => setErr("Could not load health data."));
    loadWorkouts();
    loadPlan();
    fetch("/api/goals").then((r) => r.json()).then(setGoalsData).catch(() => {});
  }, []);

  // Auto-refresh timer effect
  useEffect(() => {
    const shownDate = data?.today.date;
    const saved = localStorage.getItem("ht-auto-refresh") || "5";
    if (saved === "disabled" || !shownDate) return;

    const intervalMinutes = parseInt(saved, 10);
    if (isNaN(intervalMinutes) || intervalMinutes <= 0) return;

    const intervalMs = intervalMinutes * 60 * 1000;

    const doRefresh = () => {
      setIsRefreshing(true);
      refreshCurrentData(shownDate, true).finally(() => setIsRefreshing(false));
    };

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") doRefresh();
    }, intervalMs);

    // PWAs/mobile browsers suspend setInterval when backgrounded, so the timer
    // alone leaves the dashboard stale until a navigation remounts it. Refetch
    // when the app returns to the foreground — throttled so it doesn't double up
    // with a tick that just fired.
    let lastForeground = 0;
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastForeground < 30_000) return;
      lastForeground = now;
      doRefresh();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [data?.today.date, refreshCurrentData]);

  // Daily inline insights + app-derived readiness dial, refetched per displayed day.
  const shownDate = data?.today.date;
  useEffect(() => {
    if (!shownDate) return;
    setInsights(null);
    fetch(`/api/daily-insights?date=${shownDate}`)
      .then((r) => r.json())
      .then(setInsights)
      .catch(() => {});
    loadHabits(shownDate);
  }, [shownDate]);

  const loadHabits = (date: string) =>
    fetch(`/api/habits?date=${date}`).then((r) => r.json()).then(setHabits).catch(() => {});

  async function logHabit(habitId: string, value: boolean | number | null) {
    if (!shownDate) return;
    setHabitBusy(habitId);
    try {
      await fetch("/api/habits/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId, date: shownDate, value }),
      });
      await loadHabits(shownDate);
    } finally {
      setHabitBusy(null);
    }
  }

  async function reorderHabits(ids: string[]) {
    // The widget already shows the new order optimistically; persist + resync.
    await fetch("/api/habits/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
    if (shownDate) loadHabits(shownDate);
  }

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
      setLastUpdated(new Date());
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
      setLastUpdated(new Date());
    } finally {
      setDayBusy(false);
    }
  }

  /** Soonest planned workout dated today or tomorrow, for the Daily card. */
  const loadPlan = () => {
    const today = new Date().toISOString().slice(0, 10);
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const tmrw = t.toISOString().slice(0, 10);
    fetch("/api/workout-plans?upcoming=1")
      .then((r) => r.json())
      .then((j) => {
        const list: WorkoutPlanItem[] = j.items ?? [];
        setNextPlan(list.find((p) => p.date === today) ?? list.find((p) => p.date === tmrw) ?? null);
      })
      .catch(() => {});
  };

  async function completeNextPlan() {
    if (!nextPlan) return;
    setPlanBusy(true);
    try {
      await fetch(`/api/workout-plans?id=${nextPlan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete" }) });
      loadPlan();
      await loadWorkouts();
    } finally {
      setPlanBusy(false);
    }
  }

  const loadWorkouts = () =>
    fetch("/api/workouts?days=7")
      .then((r) => r.json())
      .then((j) => {
        setWorkouts(j.sessions ?? []);
        if (j.quickTypes?.length) setQuickTypes(j.quickTypes);
      })
      .catch(() => {});

  // Relabel a session locally when Google reports a wrong/generic type that
  // editing in the Health app never propagates back. Pass no type to revert.
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
    await loadWorkouts();
  }

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
        body: JSON.stringify({
          name: logType.label,
          exerciseType: logType.type,
          durationMin: Math.max(1, Math.round(Number(logMin) || 45)),
          notes: logNotes || undefined,
          detail: detailIsEmpty(logDetail) ? undefined : logDetail,
        }),
      });
      setLogOpen(false);
      setLogNotes("");
      setLogDetail({});
      setShowDetail(false);
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

  const insightFor = (s: InsightSection) =>
    insights?.date === t.date ? insights.sections.find((x) => x.section === s)?.text ?? null : null;
  const readiness = insights?.date === t.date ? insights.readiness : null;

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
            <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {data.demo ? (
                <a href="/api/googlehealth/auth" style={{ color: "var(--food)", fontWeight: 600, textDecoration: "none" }}>
                  demo data — connect Google Health
                </a>
              ) : (
                <span style={{ color: "var(--activity)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="pulse-dot" style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--activity)",
                    display: "inline-block",
                  }} />
                  live · Google Health
                </span>
              )}
              {lastUpdated && (
                <span style={{
                  color: "var(--ink-soft)",
                  fontSize: 12.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "opacity 0.3s ease",
                  opacity: isRefreshing ? 0.6 : 0.85,
                }}>
                  · Updated {lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  {isRefreshing && (
                    <svg className="spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ color: "var(--activity)" }}>
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73" />
                    </svg>
                  )}
                </span>
              )}
            </p>
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

      {isToday && <CoachQuestionCard />}
      {isToday && <MedicationAlert />}

      <div className="stack desk-grid">
        {isToday && <ExerciseSnacks />}

        <DailyGoals data={goalsData} />

        <h2 className="section-title desk-span rise rise-1">Daily activity</h2>

        {insightFor("movement") && (
          <div className="desk-span"><Insight text={insightFor("movement")} color="var(--activity)" /></div>
        )}

        {/* Movement — steps, weekly trend and goal streak grouped together */}
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

          {/* Steps this week */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)" }}>Steps this week</span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                avg <strong className="display-num" style={{ fontSize: 14, color: "var(--ink)" }}>{Math.round(data.week.reduce((a, d) => a + d.steps, 0) / data.week.length).toLocaleString()}</strong>/day
              </span>
            </div>
            <Bars values={data.week.map((d) => d.steps)} color="var(--activity)" labels={weekLabels} height={54} />
          </div>

          {/* Goal streak */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)" }}>
                <span style={{ width: 15, height: 15, display: "inline-flex", verticalAlign: "-2px", marginRight: 6, color: "var(--activity)" }}>{FlameIcon}</span>
                Goal streak
              </span>
              <span className="badge" style={{ background: "var(--activity-soft)", color: "var(--activity)" }}>
                {streak} day{streak === 1 ? "" : "s"}
              </span>
            </div>
            <div className="row" style={{ gap: 4, marginTop: 12, justifyContent: "space-between" }}>
              {data.week.map((d, i) => {
                const hit = d.steps >= d.stepsGoal;
                const isLast = i === data.week.length - 1;
                return (
                  <div key={d.date} className={`streak-day ${isLast ? "today" : ""}`} title={`${d.date}: ${d.steps.toLocaleString()} steps`}>
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
          </div>
        </section>

        {/* Next planned workout (today / tomorrow) */}
        {nextPlan && (
          <section className="card rise rise-3" style={{ borderLeft: "3px solid var(--activity)" }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <IconChip icon={workoutIcon(nextPlan.exerciseType)} color="var(--activity)" size={30} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--activity)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {nextPlan.date === new Date().toISOString().slice(0, 10) ? "Planned today" : "Planned tomorrow"}
                  </span>
                  <strong style={{ fontSize: 15, display: "block" }}>{nextPlan.name}</strong>
                  <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                    {nextPlan.durationMin} min{nextPlan.intensity ? ` · ${nextPlan.intensity}` : ""}
                    {nextPlan.exercises?.length ? ` · ${nextPlan.exercises.length} exercise${nextPlan.exercises.length > 1 ? "s" : ""}` : ""}
                    {nextPlan.estCalories ? ` · ~${nextPlan.estCalories} kcal` : ""}
                  </p>
                </div>
              </div>
              <button className="btn" style={{ background: "var(--activity)", padding: "8px 16px", fontSize: 13, flex: "none", alignSelf: "center" }} disabled={planBusy} onClick={completeNextPlan}>
                {planBusy ? "…" : "Complete"}
              </button>
            </div>
          </section>
        )}

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
              <div key={w.id}>
                <div className="row" style={{ gap: 10, justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    <IconChip icon={workoutIcon(w.exerciseType)} color="var(--food)" size={30} />
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5, textTransform: "capitalize" }}>{workoutLabel(w)}</strong>
                      <p style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                        {w.date === data.today.date ? "Today" : dayLetter(w.date) + " " + w.date.slice(5)} · {w.startTime} · {w.durationMin} min
                        {w.source === "journal" && (w.syncedToHealth ? " · ✓ synced" : " · journal")}
                        {w.overridden ? (w.overrideSynced ? " · relabeled ✓ Google" : " · relabeled locally") : ""}
                      </p>
                      {!detailIsEmpty(w.detail) && (
                        <p style={{ fontSize: 11, color: "var(--food)", marginTop: 1 }}>{formatDetail(w.detail)}</p>
                      )}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, flex: "none" }}>
                    <span className="display-num" style={{ fontSize: 14, color: "var(--food)" }}>
                      {w.calories ? `${w.calories} kcal` : w.avgHr ? `${w.avgHr} bpm` : ""}
                    </span>
                    <button
                      onClick={() => setEditing(editing === w.id ? null : w.id)}
                      style={{ background: "none", border: "none", color: editing === w.id ? "var(--food)" : "var(--ink-faint)", cursor: "pointer", fontSize: 13 }}
                      aria-label="relabel workout type"
                      title="Fix workout type"
                    >
                      ✎
                    </button>
                  </div>
                </div>
                {editing === w.id && (
                  <div style={{ marginTop: 8, marginLeft: 40 }}>
                    <WorkoutTypePicker
                      quickTypes={quickTypes}
                      selected={w.exerciseType}
                      onPick={(t) => relabel(w, t)}
                      onRevert={w.overridden ? () => relabel(w) : undefined}
                      accent="var(--food)"
                      accentSoft="var(--food-soft)"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {logOpen ? (
            <div style={{ marginTop: 12 }}>
              <WorkoutTypePicker
                quickTypes={quickTypes}
                selected={logType.type}
                onPick={setLogType}
                accent="var(--food)"
                accentSoft="var(--food-soft)"
              />
              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
                <input
                  className="field"
                  type="number"
                  value={logMin}
                  min={1}
                  inputMode="numeric"
                  onChange={(e) => setLogMin(e.target.value)}
                  onBlur={() => setLogMin((s) => (s.trim() === "" ? "45" : String(Math.max(1, Math.round(Number(s) || 45)))))}
                  style={{ width: 90, padding: "8px 10px" }}
                />
                <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>min</span>
                <input
                  className="field"
                  placeholder="Notes…"
                  value={logNotes}
                  onChange={(e) => setLogNotes(e.target.value)}
                  style={{ flex: 1, minWidth: 80, padding: "8px 10px" }}
                />
              </div>
              {showDetail ? (
                <div style={{ marginTop: 12 }}>
                  <WorkoutDetailForm value={logDetail} onChange={setLogDetail} />
                </div>
              ) : (
                <button
                  onClick={() => setShowDetail(true)}
                  style={{ background: "none", border: "none", color: "var(--food)", cursor: "pointer", fontSize: 12.5, padding: 0, marginTop: 10 }}
                >
                  + Add detail (intensity, effort, exercises)
                </button>
              )}
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
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

        <h2 className="section-title desk-span rise rise-3">Hydration</h2>

        {insightFor("hydration") && (
          <div className="desk-span"><Insight text={insightFor("hydration")} color="var(--breath)" /></div>
        )}

        {/* Water — its own section; quick-add is a "now" action, so the +/− controls only appear on today. */}
        <section className="card desk-span rise rise-3">
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

        <h2 className="section-title desk-span rise rise-3">Habits</h2>

        {insightFor("habits") && (
          <div className="desk-span"><Insight text={insightFor("habits")} color="var(--activity)" /></div>
        )}

        <HabitsWidget
          habits={habits}
          busyId={habitBusy}
          onLog={logHabit}
          onReorder={reorderHabits}
        />

        <MedicationsWidget date={shownDate} />

        <h2 className="section-title desk-span rise rise-3">Sleep</h2>

        {insightFor("sleep") && (
          <div className="desk-span"><Insight text={insightFor("sleep")} color="var(--sleep)" /></div>
        )}

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

        <h2 className="section-title desk-span rise rise-4">Recovery</h2>

        {insightFor("readiness") && (
          <div className="desk-span"><Insight text={insightFor("readiness")} color={readiness?.color ?? "var(--heart)"} /></div>
        )}

        {readiness && <ReadinessDial readiness={readiness} rise={4} />}

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
        <h2 className="section-title desk-span rise rise-5">Energy</h2>

        {insightFor("nutrition") && (
          <div className="desk-span"><Insight text={insightFor("nutrition")} color="var(--food)" /></div>
        )}

        {/* Energy balance */}
        <section className="card rise rise-5">
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
      </div>
    </main>
  );
}

const GOAL_STATUS_COLOR: Record<GoalStatus, string> = {
  met: "var(--activity)",
  on_track: "var(--food)",
  needs_attention: "var(--heart)",
  no_data: "var(--ink-soft)",
};

type GoalOverlay = { label: string; line?: number; band?: [number, number]; statusColor: string };

function goalTargetText(g: GoalDefinition): string {
  const u = g.unit ? ` ${g.unit}` : "";
  if (g.direction === "lower_is_better") return g.targetMax != null ? `≤ ${g.targetMax}${u}` : "set a target";
  if (g.direction === "higher_is_better") return g.targetMin != null ? `≥ ${g.targetMin}${u}` : "set a target";
  return g.targetMin != null && g.targetMax != null ? `${g.targetMin}–${g.targetMax}${u}` : "set a target";
}

/** Goals the user opted onto Daily (showOnDaily). Sits near the top — they're
 *  what the user is steering toward. Status/progress are deterministic. */
function DailyGoals({ data }: { data: { goals: GoalDefinition[]; progress: GoalProgress[] } | null }) {
  if (!data) return null;
  const shown = data.goals.filter((g) => g.active && g.showOnDaily);
  if (!shown.length) return null;
  const byId = new Map(data.progress.map((p) => [p.goalId, p]));
  return (
    <section className="card desk-span rise rise-1">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-label">
          <IconChip icon={habitIcon("check")} color="var(--sleep)" />
          Goals
        </div>
        <a href="/goals" style={{ fontSize: 12, color: "var(--ink-soft)", textDecoration: "none" }}>Manage →</a>
      </div>
      <div className="stack" style={{ gap: 10, marginTop: 12 }}>
        {shown.map((g) => {
          const p = byId.get(g.id);
          const hasValue = p?.latestValue != null;
          const noTarget =
            g.direction === "lower_is_better" ? g.targetMax == null : g.direction === "higher_is_better" ? g.targetMin == null : g.targetMin == null || g.targetMax == null;
          const status: GoalStatus = !hasValue || noTarget ? "no_data" : p!.status;
          const color = GOAL_STATUS_COLOR[status];
          const pct = Math.round((p?.progress ?? 0) * 100);
          return (
            <div key={g.id}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="card-label" style={{ gap: 8, fontSize: 13.5, textTransform: "none", letterSpacing: 0 }}>
                  <IconChip icon={habitIcon(g.iconKey)} color={color} size={22} />
                  {g.label}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
                  <span style={{ color: "var(--ink)", fontWeight: 600 }}>{hasValue ? p!.latestValue : "—"}</span>
                  {" / "}
                  {goalTargetText(g)}
                </span>
              </div>
              <div style={{ marginTop: 6, height: 5, borderRadius: 999, background: "var(--bg-inset)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: status === "no_data" ? "var(--hairline)" : color, transition: "width 0.3s" }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Inline AI insight snippet, rendered at the head of a Daily cluster. Renders
 * nothing when there is no meaningful advice for that section (today only).
 */
function Insight({ text, color = "var(--activity)" }: { text: string | null; color?: string }) {
  if (!text) return null;
  return (
    <div
      className="rise rise-1"
      style={{
        display: "flex",
        gap: 9,
        alignItems: "flex-start",
        padding: "10px 14px",
        borderRadius: 14,
        background: `color-mix(in srgb, ${color} 9%, var(--bg-raised))`,
        border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
        fontSize: 13,
        lineHeight: 1.45,
        color: "var(--ink)",
      }}
    >
      <span aria-hidden style={{ color, fontWeight: 800, flex: "none", marginTop: -1 }}>✦</span>
      <span>{text}</span>
    </div>
  );
}

const READINESS_LABEL: Record<ReadinessScore["band"], string> = {
  low: "Low",
  fair: "Fair",
  good: "Good",
  high: "High",
};

/** App-derived recovery dial (0-100, color-banded). Not Google's readiness score. */
function ReadinessDial({ readiness, rise }: { readiness: ReadinessScore; rise: number }) {
  const { score, band, color, reasons, confident } = readiness;
  return (
    <section className={`card rise rise-${rise}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-label">
          <IconChip icon={PulseIcon} color={color} />
          Readiness
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-soft)", marginLeft: 6 }}>
            · as of last night
          </span>
        </div>
        <span className="badge" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
          {READINESS_LABEL[band]}
        </span>
      </div>
      <div className="row" style={{ gap: 20, marginTop: 14, alignItems: "center" }}>
        <Ring progress={score / 100} color={color} track={`color-mix(in srgb, ${color} 16%, var(--bg-inset))`} size={96} stroke={9}>
          <span className="display-num" style={{ fontSize: 26, color }}>{score}</span>
          <span style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>/ 100</span>
        </Ring>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {reasons.length ? (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          ) : (
            <p style={{ margin: 0 }}>HRV, resting heart rate and sleep are in line with your baseline.</p>
          )}
          <p style={{ margin: "8px 0 0", fontSize: 11, opacity: 0.8 }}>
            App-derived from HRV · RHR · sleep{confident ? "" : " · baseline still building"}
          </p>
        </div>
      </div>
    </section>
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
  goal,
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
  goal?: GoalOverlay;
}) {
  return (
    <section className={`card rise rise-${rise}`} style={{ padding: "15px 18px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <div className="card-label">
          <IconChip icon={icon} color={color} />
          {label}
        </div>
        {goal && (
          <span
            className="badge"
            style={{ background: `color-mix(in srgb, ${goal.statusColor} 16%, transparent)`, color: goal.statusColor, fontSize: 11 }}
          >
            Goal {goal.label}
          </span>
        )}
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
            <Sparkline values={series} color={color} dots labels={labels} height={56} width={230} target={goal?.line} targetBand={goal?.band} />
          )}
        </div>
      </div>
    </section>
  );
}

/** Compact Daily habits card: active, Daily-visible habits with quick logging.
 *  Full configuration lives on the /habits page. */
const HABITS_COLLAPSED = 4;

function HabitsWidget({
  habits,
  busyId,
  onLog,
  onReorder,
}: {
  habits: HabitsPayload | null;
  busyId: string | null;
  onLog: (habitId: string, value: boolean | number | null) => void;
  onReorder: (ids: string[]) => void;
}) {
  const shown = (habits?.habits ?? []).filter((h) => h.active && h.showOnDaily);
  const [order, setOrder] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef<string[]>(order);
  orderRef.current = order;
  const draggingRef = useRef<string | null>(null);

  // Re-seed the local drag order whenever the visible habit set changes.
  const shownIds = shown.map((h) => h.id).join(",");
  useEffect(() => {
    setOrder(shown.map((h) => h.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownIds]);

  if (!shown.length) return null;
  const statusFor = (id: string) => habits?.status.find((s) => s.habitId === id);
  const byId = new Map(shown.map((h) => [h.id, h]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as HabitDefinition[];
  const visible = expanded ? ordered : ordered.slice(0, HABITS_COLLAPSED);
  const doneCount = shown.filter((h) => statusFor(h.id)?.completed).length;

  // Pointer-based drag-to-reorder — one path for mouse and touch (HTML5 DnD
  // doesn't fire on touchscreens). Rows shift live as the pointer moves; the
  // new order is persisted on release.
  const startDrag = (id: string, e: React.PointerEvent) => {
    if (e.button !== undefined && e.button > 0) return; // primary button / touch only
    e.preventDefault();
    draggingRef.current = id;
    setDragId(id);

    const move = (ev: PointerEvent) => {
      const src = draggingRef.current;
      if (!src || !listRef.current) return;
      ev.preventDefault();
      const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-habit-id]")];
      let targetId: string | null = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          targetId = row.dataset.habitId ?? null;
          break;
        }
      }
      if (!targetId) targetId = rows[rows.length - 1]?.dataset.habitId ?? null;
      if (!targetId || targetId === src) return;
      setOrder((prev) => {
        const cur = [...prev];
        const from = cur.indexOf(src);
        const to = cur.indexOf(targetId!);
        if (from < 0 || to < 0) return prev;
        cur.splice(from, 1);
        cur.splice(to, 0, src);
        return cur;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      draggingRef.current = null;
      setDragId(null);
      onReorder(orderRef.current);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <section className="card desk-span rise rise-3">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-label">
          <IconChip
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6.5h10M4 12h10M4 17.5h6" />
                <path d="M17 5.5l1.6 1.6L22 4" />
              </svg>
            }
            color="var(--activity)"
          />
          Habits
          <span className="badge" style={{ marginLeft: 8, background: "var(--activity-soft)", color: "var(--activity)" }}>
            {doneCount}/{shown.length}
          </span>
        </div>
        <a href="/habits" style={{ fontSize: 12.5, color: "var(--ink-soft)", textDecoration: "none" }}>
          Manage →
        </a>
      </div>
      <div ref={listRef} className="stack" style={{ gap: 10, marginTop: 12 }}>
        {visible.map((h) => (
          <HabitMini
            key={h.id}
            habit={h}
            status={statusFor(h.id)}
            busy={busyId === h.id}
            onLog={(v) => onLog(h.id, v)}
            dragging={dragId === h.id}
            onHandlePointerDown={(e) => startDrag(h.id, e)}
          />
        ))}
      </div>
      {ordered.length > HABITS_COLLAPSED && (
        <button
          className="btn btn-ghost"
          onClick={() => setExpanded((e) => !e)}
          style={{ marginTop: 12, fontSize: 13, padding: "8px 16px" }}
        >
          {expanded ? "Show less" : `Show all ${ordered.length}`}
        </button>
      )}
    </section>
  );
}

function HabitMini({
  habit,
  status,
  busy,
  onLog,
  dragging,
  onHandlePointerDown,
}: {
  habit: HabitDefinition;
  status?: HabitComputedStatus;
  busy: boolean;
  onLog: (v: boolean | number | null) => void;
  dragging: boolean;
  onHandlePointerDown: (e: React.PointerEvent) => void;
}) {
  const color = habit.color ?? "var(--activity)";
  const value = status?.value ?? null;
  const completed = status?.completed ?? false;
  const streak = status?.streak ?? 0;

  let control: React.ReactNode;
  if (habit.targetType === "yes_no") {
    if (habit.kind === "avoid") {
      // value false = avoided (nailed it); value true = slipped.
      const nailed = value === false;
      const slipped = value === true;
      control = (
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" disabled={busy} title="Nailed it" aria-label="nailed it" onClick={() => onLog(nailed ? null : false)} style={nailed ? { background: "var(--activity)", color: "var(--bg)", borderColor: "var(--activity)" } : undefined}>
            ✓
          </button>
          <button className="icon-btn" disabled={busy} title="I slipped" aria-label="i slipped" onClick={() => onLog(slipped ? null : true)} style={slipped ? { background: "var(--heart)", color: "var(--bg)", borderColor: "var(--heart)" } : undefined}>
            ✕
          </button>
        </div>
      );
    } else {
      const isGood = value === true;
      control = (
        <button
          className="icon-btn"
          disabled={busy}
          aria-label={isGood ? "clear" : "mark done"}
          onClick={() => onLog(isGood ? null : true)}
          style={isGood ? { background: color, color: "var(--bg)", borderColor: color } : undefined}
        >
          ✓
        </button>
      );
    }
  } else {
    const current = typeof value === "number" ? value : 0;
    const step =
      habit.targetType === "duration" ? 10 : habit.defaultValue && habit.defaultValue > 0 ? habit.defaultValue : 1;
    control = (
      <div className="row" style={{ gap: 8 }}>
        <button
          className="icon-btn"
          disabled={busy || current <= 0}
          aria-label="decrease"
          onClick={() => onLog(Math.max(0, current - step) || null)}
          style={{ opacity: current <= 0 ? 0.4 : 1 }}
        >
          −
        </button>
        <span className="display-num" style={{ fontSize: 17, minWidth: 26, textAlign: "center", color }}>
          {current}
        </span>
        <button
          className="icon-btn"
          disabled={busy}
          aria-label="increase"
          onClick={() => onLog(current + step)}
          style={{ background: color, color: "var(--bg)", borderColor: color, fontSize: 17 }}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div
      data-habit-id={habit.id}
      className="row"
      style={{
        justifyContent: "space-between",
        gap: 10,
        opacity: busy ? 0.6 : dragging ? 0.4 : 1,
        borderRadius: 12,
        outline: dragging ? `2px dashed ${color}` : "none",
        background: dragging ? `color-mix(in srgb, ${color} 8%, var(--bg-raised))` : "transparent",
        transition: "opacity 0.15s, background 0.15s",
      }}
    >
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <span
          onPointerDown={onHandlePointerDown}
          aria-label="drag to reorder"
          title="Drag to reorder"
          style={{ cursor: "grab", color: "var(--ink-faint)", flex: "none", display: "flex", padding: "4px 3px", touchAction: "none", userSelect: "none" }}
        >
          <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden>
            <circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" />
            <circle cx="3" cy="9" r="1.4" /><circle cx="9" cy="9" r="1.4" />
            <circle cx="3" cy="15" r="1.4" /><circle cx="9" cy="15" r="1.4" />
          </svg>
        </span>
        <IconChip icon={habitIcon(habit.iconKey)} color={completed ? color : "var(--ink-soft)"} size={24} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {habit.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
            {streak > 0 ? `🔥 ${streak}d` : habit.kind === "boost" ? "boost" : "avoid"}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, flex: "none" }}>
        <span aria-hidden title={completed ? "goal met" : "not met yet"} style={{ fontSize: 21 }}>
          {completed ? "😊" : value == null ? "" : "😕"}
        </span>
        {control}
      </div>
    </div>
  );
}
