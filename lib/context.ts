import {
  isConnected,
  fetchDay,
  fetchDays,
  fetchHeartIntraday,
  fetchWorkouts,
  fetchWaterTotal,
  trendsFromDays,
} from "./googlehealth";
import {
  getArchivedDay,
  getArchivedRange,
  upsertDay,
  isSettledDate,
} from "./archive";
import { demoDay, demoRange, demoWorkouts } from "./demo";
import { getRemoteMeals } from "./remote-food";
import { readJson, localDateStr } from "./store";
import {
  DaySummary,
  FoodEntry,
  MedicalRecord,
  ReadinessScore,
  RemoteFoodEntry,
  TrendsPayload,
  WorkoutSession,
  WorkoutDetail,
} from "./types";
import { computeReadiness } from "./readiness";
import { getGoals, buildAllProgress, formatGoalsForCoach } from "./goals";
import { recentMeasurements, MEASUREMENT_LABELS } from "./measurements";
import { formatDetail } from "./workout-detail";
import {
  getHabitDefinitions,
  getHabitRecords,
  computeHabitStatus,
  formatHabitForCoach,
} from "./habits";
import { getProfile, deriveProfile, ACTIVITY_LABELS, GOAL_LABELS } from "./profile";
import { formatEvidenceForCoach } from "./evidence";
import { formatMemoryForCoach } from "./memory";
import { getOpenQuestion } from "./coach-questions";
import {
  summarizeWeeklyActivity,
  classifyTrainingBalance,
  recommendTrainingIntensity,
  formatExerciseForCoach,
} from "./coach/exercise-rules";
import { computeTargets, formatTargetsForCoach } from "./coach/nutrition-targets";
import { formatPreventionForCoach } from "./coach/prevention";
import { formatPlanForCoach } from "./training-plan";
import { formatSnacksForCoach } from "./exercise-snacks";

/** A meal normalized across the local log and Google Health for the coach. */
type CoachMeal = {
  loggedAt: string;
  name: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  glycemicLoad?: number | null;
};

function toCoachMeal(f: FoodEntry | RemoteFoodEntry): CoachMeal {
  const loggedAt = "loggedAt" in f ? f.loggedAt : f.at;
  return {
    loggedAt,
    name: f.name,
    calories: f.calories,
    proteinG: f.proteinG ?? null,
    carbsG: f.carbsG ?? null,
    fatG: f.fatG ?? null,
    glycemicLoad: f.glycemicLoad,
  };
}

function dateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return localDateStr(d);
}

function addDaysStr(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Single day. Settled dates are served from the local archive (zero API
 * calls); recent dates are always fetched live, with the archived snapshot as
 * an API-failure fallback before degrading to demo data.
 */
export async function getDay(date: string): Promise<{ day: DaySummary; demo: boolean }> {
  if (!isConnected()) return { day: demoDay(date), demo: true };

  const settled = isSettledDate(date);
  const archived = getArchivedDay(date);

  if (settled && archived?.settled) {
    // Range fetches archive days without the intraday HR curve; fill it in
    // once, on first day-view visit, then it's permanent.
    if (!archived.summary.heartIntraday?.length) {
      try {
        archived.summary.heartIntraday = await fetchHeartIntraday(date);
        upsertDay(date, { summary: archived.summary, settled: true });
      } catch {
        // serve without the curve; next visit retries
      }
    }
    return { day: archived.summary, demo: false };
  }

  try {
    // Capture workouts too, so a day that settles via the detail view (not just
    // the range fetch) lands its sessions in the archive for Trends.
    const [day, workouts] = await Promise.all([
      fetchDay(date),
      fetchWorkouts(date, date).catch(() => [] as WorkoutSession[]),
    ]);
    upsertDay(date, { summary: day, workouts, settled });
    return { day, demo: false };
  } catch {
    if (archived) return { day: archived.summary, demo: false };
    return { day: demoDay(date), demo: true };
  }
}

// Short-TTL cache for the live day-range fetch. A single coach turn pulls two
// overlapping windows (14-day context + 45-day readiness), and the proactive
// scheduler / daily view / sharing each pull their own — without this they all
// hammer the Google Health API independently and trip its per-minute quota
// (429s), which both slows the coach (~10s context builds) and degrades the
// data (429 → archive fallback). The TTL is short enough that staleness is
// imperceptible in a conversation; a larger cached window also satisfies a
// smaller request by slicing, so 14 reuses a fresh 45.
type RangeResult = { days: DaySummary[]; demo: boolean };
// Stored on globalThis so it survives Next dev HMR module reloads (a plain
// module-level Map gets wiped on every Fast Refresh, defeating the cache during
// development). In production it's an ordinary process-lifetime cache.
const recentCache: Map<number, { at: number; data: RangeResult }> =
  ((globalThis as any).__htRecentCache ??= new Map());
const RECENT_TTL_MS = 30_000;

/** Drop the cache — call after a write so the coach reflects a fresh log at once. */
export function invalidateRecentDays() {
  recentCache.clear();
}

export async function getRecentDays(n: number): Promise<RangeResult> {
  const now = Date.now();
  const exact = recentCache.get(n);
  if (exact && now - exact.at < RECENT_TTL_MS) return exact.data;
  // Satisfy a smaller request from a larger fresh window (e.g. 14 from 45).
  for (const [m, entry] of recentCache) {
    if (m > n && now - entry.at < RECENT_TTL_MS && entry.data.days.length >= n) {
      return { days: entry.data.days.slice(-n), demo: entry.data.demo };
    }
  }
  const data = await getRecentDaysUncached(n);
  recentCache.set(n, { at: now, data });
  return data;
}

/**
 * Last n days, oldest first. Settled days come from the archive; the
 * remainder (recent window + any archive gaps) is fetched live in one go and
 * settled days among them are written back to the archive.
 */
async function getRecentDaysUncached(n: number): Promise<{ days: DaySummary[]; demo: boolean }> {
  if (!isConnected()) return { days: demoRange(n), demo: true };

  const end = localDateStr();
  const start = addDaysStr(end, -(n - 1));
  const archived = getArchivedRange(start, end);

  // A settled archived day is reusable only if its workouts were also captured.
  // Legacy rows that settled before workouts were archived (workouts === null)
  // are treated as incomplete so the live fetch below repairs them.
  const complete = (d: string) => {
    const a = archived.get(d);
    return !!a?.settled && isSettledDate(d) && a.workouts != null;
  };

  // Live span: from the oldest incomplete date in range through today.
  let liveStart = end;
  for (let d = start; d <= end; d = addDaysStr(d, 1)) {
    if (!complete(d)) {
      liveStart = d;
      break;
    }
    liveStart = addDaysStr(d, 1);
  }

  let live = new Map<string, DaySummary>();
  if (liveStart <= end) {
    try {
      // Fetch workouts alongside summaries so a day's sessions are archived when
      // it settles — otherwise settled days show no workouts in Trends. Page
      // deep enough to cover the (possibly healing) live window.
      const span = Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(liveStart + "T12:00:00Z")) / 86400000) + 1;
      const [fetched, liveWorkouts] = await Promise.all([
        fetchDays(liveStart, end),
        fetchWorkouts(liveStart, end, Math.min(40, Math.max(8, span))).catch(() => [] as WorkoutSession[]),
      ]);
      live = new Map(fetched.map((d) => [d.date, d]));
      const woByDate = new Map<string, WorkoutSession[]>();
      for (const w of liveWorkouts) {
        const arr = woByDate.get(w.date);
        if (arr) arr.push(w);
        else woByDate.set(w.date, [w]);
      }
      for (const d of fetched) {
        upsertDay(d.date, { summary: d, workouts: woByDate.get(d.date) ?? [], settled: isSettledDate(d.date) });
      }
    } catch {
      // fall back to snapshots below; demo only if nothing at all
      if (archived.size === 0) return { days: demoRange(n), demo: true };
    }
  }

  const days: DaySummary[] = [];
  for (let d = start; d <= end; d = addDaysStr(d, 1)) {
    const day = live.get(d) ?? archived.get(d)?.summary;
    if (day) days.push(day);
  }
  return { days, demo: false };
}

// Readiness baseline window. MUST match /api/daily-insights so the coach
// quotes the SAME number the user sees on the Daily dial (not the coach's
// shorter default display window).
const READINESS_WINDOW = 45;

/**
 * App-derived readiness for `date` (default today), scored against the same
 * 45-day rolling baseline as the Daily dial. Today is the last element of the
 * window; `history` is the preceding days. Returns null if the date isn't in
 * the window or no component can be scored. See lib/readiness.ts.
 */
export async function readinessForDate(date = localDateStr()): Promise<ReadinessScore | null> {
  const { days } = await getRecentDays(READINESS_WINDOW);
  const idx = days.findIndex((d) => d.date === date);
  if (idx === -1) return null;
  return computeReadiness(days[idx], days.slice(0, idx));
}

/**
 * Latest synced body weight (kg) from real device data, newest-first, or null
 * when disconnected/demo. Profile BMI prefers this over the manual figure; demo
 * weight is deliberately ignored so a disconnected app doesn't fabricate a BMI.
 */
export async function latestDeviceWeightKg(): Promise<number | null> {
  if (!isConnected()) return null;
  // Read the latest weight from the local archive only — never trigger a live
  // Google fetch here. This runs on every Profile load just to populate BMI,
  // which tolerates a slightly-stale weight; deriveProfile falls back to the
  // manual figure when the archive has none. (Archive rows are kept fresh by
  // the dashboard/trends views, which fetch live and snapshot recent days.)
  const end = localDateStr();
  const start = addDaysStr(end, -60); // weigh-ins are sparse; widen the lookback
  const archived = getArchivedRange(start, end);
  const dates = [...archived.keys()].sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const w = archived.get(dates[i])!.summary.weightKg;
    if (w != null) return w;
  }
  return null;
}

/** Trend series: archived days + a live fetch for only the unsettled window. */
export async function getTrends(days: number): Promise<TrendsPayload | null> {
  if (!isConnected()) return null;
  const { days: range } = await getRecentDays(days);
  if (!range.length) return null;
  const end = localDateStr();
  return trendsFromDays(range, { start: addDaysStr(end, -(days - 1)), end });
}

/**
 * Re-pulls one date from the API and overwrites its archived row — used when
 * a workout is logged/deleted on a settled date, and by the manual re-sync.
 */
export async function refreshArchivedDay(date: string): Promise<boolean> {
  if (!isConnected()) return false;
  try {
    const [day, workouts] = await Promise.all([fetchDay(date), fetchWorkouts(date, date)]);
    upsertDay(date, { summary: day, workouts, settled: isSettledDate(date) });
    return true;
  } catch (e) {
    console.error("Archive day refresh failed:", e);
    return false;
  }
}

function fmtDay(d: DaySummary): string {
  const parts = [
    `${d.date}: ${d.steps} steps`,
    `${d.caloriesOut} kcal out`,
    d.caloriesIn ? `${d.caloriesIn} kcal in` : null,
    `${d.activeZoneMinutes} active-zone min`,
    d.restingHeartRate ? `RHR ${d.restingHeartRate}` : null,
    d.sleep ? `sleep ${(d.sleep.durationMin / 60).toFixed(1)}h (deep ${d.sleep.stages.deep}m, REM ${d.sleep.stages.rem}m, eff ${d.sleep.efficiency}%)` : "no sleep data",
    d.hrv ? `HRV ${d.hrv}ms` : null,
    d.spo2 ? `SpO2 ${d.spo2}%` : null,
    d.breathingRate ? `BR ${d.breathingRate}/min` : null,
    d.weightKg ? `weight ${d.weightKg}kg` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Compact plain-text health context for the AI coach system prompt. */
export async function buildCoachContext(days = 14, query?: string): Promise<{ text: string; demo: boolean }> {
  // Fetch the largest window this build needs ONCE (the readiness baseline is the
  // widest), then derive the shorter context window by slicing — so the 14-day
  // context and the 45-day readiness share a single live Google Health fetch
  // instead of two. getRecentDays caches it, so readinessForDate() below reuses it.
  const { days: full, demo } = await getRecentDays(Math.max(days, READINESS_WINDOW));
  const range = full.slice(-days);

  // Meals from both sources the coach should reason over: the local food log
  // and meals logged in other apps, synced back from Google Health (which the
  // calorie-only daily rollup drops the macros from). Normalized to one shape,
  // deduped, oldest→newest, capped to the most recent.
  const localFoods = readJson<FoodEntry[]>("food-log.json", []);
  const remoteFoods = await getRemoteMeals(localFoods, days);
  const recentFoods: CoachMeal[] = [
    ...localFoods.map(toCoachMeal),
    ...remoteFoods.map(toCoachMeal),
  ]
    .sort((a, b) => (a.loggedAt < b.loggedAt ? -1 : 1))
    .slice(-15);
  const records = readJson<MedicalRecord[]>("records-index.json", []);

  // Recent workouts: synced sessions + local journal entries.
  let workouts: WorkoutSession[] = [];
  try {
    const journal = readJson<WorkoutSession[]>("workout-journal.json", []);
    const remote = isConnected() ? await fetchWorkouts(dateKey(7), dateKey(0)) : demoWorkouts(8);
    const names = new Set(journal.map((w) => w.googleName).filter(Boolean));
    // App-local structured detail (RPE/intensity/soreness/exercises), keyed by
    // session id and merged on read — same side-store the API route serves.
    const details = readJson<Record<string, WorkoutDetail>>("workout-detail.json", {});
    workouts = [...journal, ...remote.filter((w) => !names.has(w.googleName))]
      .filter((w) => w.date >= dateKey(7))
      .map((w) => (details[w.id] ? { ...w, detail: details[w.id] } : w))
      .sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1))
      .slice(0, 12);
  } catch {
    // workouts are optional context
  }

  let waterMl: number | null = null;
  if (isConnected()) {
    try {
      waterMl = await fetchWaterTotal(dateKey(0));
    } catch {
      // optional
    }
  }

  const lines: string[] = [];

  // App-derived readiness FIRST, scored against the same 45-day window as the
  // Daily dial so the coach answers "am I recovered?" with the dial's number
  // instead of re-reasoning from raw HRV/RHR (and possibly contradicting it).
  let readiness: ReadinessScore | null = null;
  try {
    readiness = await readinessForDate();
    if (readiness) {
      const drivers = readiness.reasons.length ? ` Drivers: ${readiness.reasons.join("; ")}.` : "";
      const building = readiness.confident ? "" : " (baseline still building)";
      lines.push(
        "== Readiness (app-derived: HRV/RHR/sleep vs your baseline) ==",
        `${readiness.score}/100 (${readiness.band}).${drivers}${building}`,
        ""
      );
    }
  } catch {
    // readiness is optional context
  }

  // Deterministic exercise read: weekly active-zone minutes + strength days vs
  // ODPHP, plus a readiness-gated intensity call. The app computes these numbers
  // so the coach quotes them rather than summing the week itself. See
  // lib/coach/exercise-rules.ts.
  try {
    const limitations = getProfile().conditions;
    const weekly = summarizeWeeklyActivity(range, workouts);
    if (weekly.daysCounted > 0) {
      const intensity = recommendTrainingIntensity(readiness, weekly, limitations);
      const balance = classifyTrainingBalance(weekly);
      lines.push(formatExerciseForCoach(weekly, intensity, balance), "");
    }
  } catch {
    // exercise read is optional context
  }

  // User profile + deterministic derivations (BMI, healthy-weight range, and the
  // safety-critical fields still missing before precise targets). The coach
  // quotes these figures; it must NOT recompute BMI or invent targets. Device
  // weight (newest in range) is preferred over the manual figure for BMI.
  try {
    const profile = getProfile();
    let deviceWeight: number | null = null;
    if (!demo) {
      for (let i = range.length - 1; i >= 0; i--) {
        if (range[i].weightKg != null) {
          deviceWeight = range[i].weightKg;
          break;
        }
      }
    }
    const d = deriveProfile(profile, deviceWeight);
    const parts: string[] = [];
    if (d.age != null) parts.push(`age ${d.age}`);
    if (profile.sex) parts.push(profile.sex);
    if (profile.heightCm) parts.push(`height ${profile.heightCm}cm`);
    if (d.weightKgResolved != null) parts.push(`weight ${d.weightKgResolved}kg (${d.weightSource})`);
    if (d.bmi != null) parts.push(`BMI ${d.bmi} (${d.bmiCategory}, CDC framing)`);
    if (d.healthyWeightRangeKg)
      parts.push(`healthy-weight range ${d.healthyWeightRangeKg.min}–${d.healthyWeightRangeKg.max}kg`);
    if (profile.activityLevel) parts.push(`activity: ${ACTIVITY_LABELS[profile.activityLevel]}`);
    if (profile.goal) parts.push(`goal: ${GOAL_LABELS[profile.goal]}${profile.targetRateKgPerWeek ? ` at ${profile.targetRateKgPerWeek}kg/week` : ""}`);
    if (profile.pregnantOrLactating) parts.push("pregnant or lactating (use conservative defaults)");
    if (profile.conditions) parts.push(`conditions: ${profile.conditions}`);
    if (parts.length) {
      lines.push("== Profile (user-entered; BMI/ranges are deterministic, not a diagnosis) ==", parts.join(", "));
      if (d.missingForTargets.length) {
        lines.push(
          `Missing for precise targets: ${d.missingForTargets.join(", ")} — ask for these before committing to exact calorie/macro targets or detailed plans.`
        );
      }
      lines.push("");
    }

    // Deterministic nutrition targets (#11): calorie/macro/hydration ranges from
    // the profile, with a weekly intake comparison so the coach frames the WEEK,
    // not a single day. Only emitted when the profile is complete enough.
    const targets = computeTargets(profile, d.weightKgResolved, d.age);
    if (targets.ok) {
      const last7 = range.slice(-7).filter((x) => x.caloriesIn > 0);
      const recentIntake = last7.length
        ? { avgKcal: Math.round(last7.reduce((s, x) => s + x.caloriesIn, 0) / last7.length), daysLogged: last7.length }
        : null;
      lines.push(formatTargetsForCoach(targets, recentIntake), "");
    }
  } catch {
    // profile is optional context
  }

  lines.push(`== Daily metrics (last ${days} days, oldest first) ==`);
  for (const d of range) lines.push(fmtDay(d));

  // Today's intraday heart rate (hourly min–max) so the coach can chart it.
  try {
    const { day: today } = await getDay(dateKey(0));
    const hourly = today.heartIntraday.filter((_, i) => i % 2 === 0);
    if (hourly.length >= 2) {
      lines.push(
        "",
        "== Today's intraday heart rate (time min-max bpm) ==",
        hourly.map((p) => `${p.time} ${p.min}-${p.max}`).join(", ")
      );
    }
  } catch {
    // intraday is optional context
  }

  if (workouts.length) {
    lines.push("", "== Recent workouts (last 7 days, newest first) ==");
    for (const w of workouts) {
      lines.push(
        `${w.date} ${w.startTime}: ${w.name} (${w.exerciseType}) ${w.durationMin} min` +
          (w.calories ? `, ${w.calories} kcal` : "") +
          (w.avgHr ? `, avg HR ${w.avgHr}` : "") +
          (w.notes ? ` — notes: ${w.notes}` : "") +
          (formatDetail(w.detail) ? ` — ${formatDetail(w.detail)}` : "") +
          (w.source === "journal" ? " [journal]" : "")
      );
    }
  }

  // Upcoming PLANNED workouts (separate from completed history above). Kept
  // clearly distinct so the coach never logs a future plan as done.
  try {
    const plan = formatPlanForCoach();
    if (plan) lines.push("", plan);
  } catch {
    // planned workouts are optional context
  }

  if (waterMl !== null) {
    lines.push("", `== Water today == ${waterMl} ml`);
  }

  if (recentFoods.length) {
    lines.push("", "== Recent logged meals ==");
    for (const f of recentFoods) {
      lines.push(
        `${f.loggedAt.slice(0, 16).replace("T", " ")}: ${f.name} — ${f.calories} kcal (P${f.proteinG ?? "?"}/C${f.carbsG ?? "?"}/F${f.fatG ?? "?"}g${f.glycemicLoad != null ? `, GL ${f.glycemicLoad}` : ""})`
      );
    }
  }

  // User-defined habits (boost/avoid) the user marked coach-visible, with
  // today's progress and current streak. See lib/habits.ts.
  try {
    const today = dateKey(0);
    const allRecords = getHabitRecords();
    const habitLines = getHabitDefinitions()
      .filter((h) => h.active && h.coachVisible)
      .map((h) => formatHabitForCoach(h, computeHabitStatus(h, allRecords, today, today)));
    if (habitLines.length) {
      lines.push("", "== Habits (today) ==");
      for (const l of habitLines) lines.push(l);
      // Loggable ids so the coach can emit a logHabit action for the right habit.
      const ids = getHabitDefinitions()
        .filter((h) => h.active && h.coachVisible)
        .map((h) => {
          const t =
            h.targetType === "yes_no"
              ? "yes/no"
              : `${h.targetType}${h.unit ? " in " + h.unit : ""}`;
          return `${h.id} (${t})`;
        });
      lines.push(`logHabit ids: ${ids.join(", ")}`);
    }
  } catch {
    // habits are optional context
  }

  // Today's exercise snacks (breathless-minute bursts) — progress + loggable
  // routine ids so the coach can nudge and log via logExerciseSnack.
  try {
    lines.push("", formatSnacksForCoach(dateKey(0)));
  } catch {
    // snacks are optional context
  }

  // User-set macro goals (coach-visible only), with deterministic status. The
  // coach explains/prioritizes these — it must not recompute or invent targets.
  try {
    const goals = getGoals();
    const { progress } = await buildAllProgress(goals);
    const goalsBlock = formatGoalsForCoach(goals, progress);
    if (goalsBlock) lines.push("", goalsBlock);
  } catch {
    // goals are optional context
  }

  // Manually logged measurements (weight, glucose, body temp/fat, sleep) from
  // the "+ Log" sheet — the user's hand-entered readings.
  try {
    const measurements = recentMeasurements({ limit: 12 });
    if (measurements.length) {
      lines.push("", "== Manually logged measurements (newest first) ==");
      for (const m of measurements) {
        const when = m.at.slice(0, 16).replace("T", " ");
        const val =
          m.kind === "sleep"
            ? `${(m.value / 60).toFixed(1)}h`
            : m.kind === "blood-pressure"
              ? `${m.value}/${m.value2 ?? "?"} ${m.unit}`
              : `${m.value} ${m.unit}`;
        const ctx = m.context ? ` (${m.context.replace("_", " ")})` : "";
        const note = m.note ? ` — ${m.note}` : "";
        lines.push(`${when}: ${MEASUREMENT_LABELS[m.kind]} ${val}${ctx}${note}`);
      }
    }
  } catch {
    // measurements are optional context
  }

  if (records.length) {
    lines.push("", "== Medical records (AI summaries of user uploads) ==");
    for (const r of records) {
      lines.push(`• ${r.filename} (${r.uploadedAt.slice(0, 10)}): ${r.summary}`);
    }
  }

  // Conservative prevention review from the user's own labs/BP — educational
  // category flags + clinician-review prompts, with urgent routing for red
  // flags. Deterministic; the coach never diagnoses. See lib/coach/prevention.ts.
  try {
    const prevention = formatPreventionForCoach();
    if (prevention) lines.push("", prevention);
  } catch {
    // prevention review is optional context
  }

  // Durable, user-owned facts the coach has learned about the person (preferences,
  // constraints, conditions, lifestyle, goals, prior advice). Ranked + budgeted so
  // the prompt stays bounded as memories grow; the current message lightly boosts
  // relevance. See lib/memory.ts + plans/coach-memory-system.md.
  try {
    const memory = formatMemoryForCoach(query);
    if (memory) lines.push("", memory);
  } catch {
    // memory is optional context
  }

  // One open proactive question the coach should weave in naturally (and capture
  // the answer to memory). See lib/coach-questions.ts + plans/coach-proactive-questions.md.
  try {
    const openQ = getOpenQuestion();
    if (openQ) {
      lines.push(
        "",
        "== Open question (you raised this; weave it in warmly, don't interrogate) ==",
        `id: ${openQ.id} · topic: ${openQ.topic}${openQ.observation ? ` · observation: ${openQ.observation}` : ""}`,
        `The question to explore: "${openQ.prompt}"`
      );
    }
  } catch {
    // open question is optional context
  }

  // Sourced evidence rules the coach may cite (general population guidance; the
  // user's own deterministic values above take precedence). Static for now — all
  // active rules are injected; intent-based retrieval comes when the set grows.
  const evidence = formatEvidenceForCoach();
  if (evidence) lines.push("", evidence);

  if (demo) {
    lines.push("", "NOTE: Google Health is not connected yet — the metrics above are demo data. Make this clear if the user asks about their real numbers.");
  }

  return { text: lines.join("\n"), demo };
}

export { COACH_PERSONA } from "./coach/persona";
