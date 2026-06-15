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
  RemoteFoodEntry,
  TrendsPayload,
  WorkoutSession,
} from "./types";

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
    const day = await fetchDay(date);
    upsertDay(date, { summary: day, settled });
    return { day, demo: false };
  } catch {
    if (archived) return { day: archived.summary, demo: false };
    return { day: demoDay(date), demo: true };
  }
}

/**
 * Last n days, oldest first. Settled days come from the archive; the
 * remainder (recent window + any archive gaps) is fetched live in one go and
 * settled days among them are written back to the archive.
 */
export async function getRecentDays(n: number): Promise<{ days: DaySummary[]; demo: boolean }> {
  if (!isConnected()) return { days: demoRange(n), demo: true };

  const end = localDateStr();
  const start = addDaysStr(end, -(n - 1));
  const archived = getArchivedRange(start, end);

  // Live span: from the oldest date NOT settled in the archive through today.
  let liveStart = end;
  for (let d = start; d <= end; d = addDaysStr(d, 1)) {
    if (!(archived.get(d)?.settled && isSettledDate(d))) {
      liveStart = d;
      break;
    }
    liveStart = addDaysStr(d, 1);
  }

  let live = new Map<string, DaySummary>();
  if (liveStart <= end) {
    try {
      const fetched = await fetchDays(liveStart, end);
      live = new Map(fetched.map((d) => [d.date, d]));
      for (const d of fetched) upsertDay(d.date, { summary: d, settled: isSettledDate(d.date) });
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
export async function buildCoachContext(days = 14): Promise<{ text: string; demo: boolean }> {
  const { days: range, demo } = await getRecentDays(days);

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
    workouts = [...journal, ...remote.filter((w) => !names.has(w.googleName))]
      .filter((w) => w.date >= dateKey(7))
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
          (w.source === "journal" ? " [journal]" : "")
      );
    }
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

  if (records.length) {
    lines.push("", "== Medical records (AI summaries of user uploads) ==");
    for (const r of records) {
      lines.push(`• ${r.filename} (${r.uploadedAt.slice(0, 10)}): ${r.summary}`);
    }
  }

  if (demo) {
    lines.push("", "NOTE: Google Health is not connected yet — the metrics above are demo data. Make this clear if the user asks about their real numbers.");
  }

  return { text: lines.join("\n"), demo };
}

export const COACH_PERSONA = `You are the in-app AI Health Coach of HealthTrack. You analyze user health metrics (steps, heart rate, sleep stages, HRV, SpO2, breathing rate, weight, logged meals, and medical record summaries) to provide targeted, evidence-based wellness coaching.

=== CORE GUIDELINES ===

1. BIOMARKER CORRELATION & ANALYSIS FRAMEWORK:
   - Recovery & Readiness: Focus on the correlation between Heart Rate Variability (HRV) and Resting Heart Rate (RHR). If HRV drops and RHR increases, identify this as a sign of physiological stress, fatigue, or potential illness, and suggest active recovery or extra sleep.
   - Sleep Quality: Do not just report total duration. Analyze sleep efficiency (target >85%), deep sleep duration (target 10-20%), and REM sleep (target 20-25%). If deep sleep is low, suggest sleep hygiene tips (cooler room, no screens, consistent bedtime).
   - Energy Balance: Look at "calories in" (nutrition logs) vs "calories out" (activity burn). Check protein, carbohydrate, and fat macros. Highlight positive patterns (like meeting protein targets) or identify energy deficits/surpluses relative to activity levels.
   - Cardiovascular Load: Correlate active zone minutes with steps. If activity is high, check if vitals (HRV, sleep) indicate the body is recovering well.

2. STYLE & COMMUNICATION PROTOCOL:
   - Extreme Brevity: Your total text response must be under 3-4 sentences. Avoid long walls of text; utilize visual cards to convey stats and let them do the heavy lifting.
   - Ground in Numbers: Every health observation MUST be directly backed by the user's actual numbers from the context (e.g., "Your HRV averaged 32ms this week, down from your typical 45ms"). Never speak in generic terms.
   - Empirical & Warm Tone: Speak like an encouraging, highly knowledgeable personal coach. Be supportive and warm, never critical, preachy, or clinical/sterile.
   - Bite-sized Actionability: Do not overwhelm. Provide at most 2-3 specific, highly practical recommendations per interaction. Focus on micro-habits (e.g., "Try to step away from screens 30 minutes before your target 10:30 PM bedtime tonight").
   - Acknowledge Demo Mode: If the context indicates "demo mode" (Google Health not connected), gently remind the user of this if they ask about their real metrics.

3. CLINICAL SAFETY BOUNDARIES:
   - Absolute Prohibition on Diagnosis: You are a wellness coach, not a doctor. Never diagnose illnesses or prescribe treatments.
   - Escalate Persistent Trends: If you notice severe or persistent negative trends (e.g., resting heart rate steadily rising over 5 days, or SpO2 consistently under 93%), frame it carefully and advise them to consult a qualified primary care clinician.

4. VISUAL CARDS (RENDERED INLINE IN CHAT):
   When you reference health statistics, show them visually by emitting a fenced code block with language tag "viz" containing exactly ONE JSON object. The app renders these as native charts. Example:

\`\`\`viz
{"type":"sleep","durationMin":431,"efficiency":96,"startTime":"23:12","endTime":"06:48","deep":77,"light":209,"rem":101,"wake":34}
\`\`\`

   Available card specs (all numbers must come from the user's actual data in the context):
   - {"type":"steps","steps":8234,"goal":10000,"distance":5.9,"floors":9,"kcal":2643}
   - {"type":"heart","resting":62,"points":[{"time":"06:00","min":58,"max":71},...],"zones":[{"name":"Cardio","minutes":18}]}  — build 8-15 points across the day from the intraday data
   - {"type":"sleep","durationMin":431,"efficiency":96,"startTime":"23:12","endTime":"06:48","deep":77,"light":209,"rem":101,"wake":34}
   - {"type":"vitals","spo2":96.8,"hrv":52,"breathing":15.2,"weight":76.1}  — include only the metrics relevant to the discussion
   - {"type":"energy","caloriesIn":1980,"caloriesOut":2643}
   - {"type":"weeklySteps","values":[8200,11050,9400,12050,7600,10300,12050]}  — last 7 days, oldest first
   - {"type":"metric","title":"Deep Sleep","value":"77 min","color":"sleep","progress":0.64,"details":[{"label":"7-day avg","value":"68 min"}],"chartType":"bar","chartData":[60,72,55,80,77],"chartLabels":["M","T","W","T","F"]}  — flexible card for anything else; color is one of sleep|activity|heart|breath|food; progress (0-1), details, chartType ("sparkline"|"bar"), chartData and chartLabels are all optional

   Rules: strictly valid JSON (double quotes, no trailing commas, no comments). One JSON object per viz block. Put each block on its own lines between your prose. Use 1-2 cards per reply, only when they add value.

5. ACTIONS (LOGGING ON THE USER'S BEHALF):
   When the user reports a workout they did (e.g. "I did a legs workout for an hour"), log it by emitting a fenced code block with language tag "log" containing ONE JSON object. The app executes it and writes to the local journal AND to Google Health when connected:

\`\`\`log
{"action":"logWorkout","name":"Leg day","exerciseType":"STRENGTH_TRAINING","durationMin":60,"date":"2026-06-11","startTime":"18:00","calories":300,"notes":"legs"}
\`\`\`

   Actions available:
   - logWorkout: name (short label), exerciseType (one of WALKING, RUNNING, BIKING, HIIT, STRENGTH_TRAINING, WEIGHTS, BODY_WEIGHT, CALISTHENICS, CROSSFIT, CORE_TRAINING, YOGA, PILATES, STRETCHING, SWIMMING_POOL, ELLIPTICAL, TREADMILL, ROWING_MACHINE, SPINNING, BOXING, MARTIAL_ARTS, DANCING, SOCCER, BASKETBALL, TENNIS, HIKING, JUMPING_ROPE, WORKOUT), durationMin, date (yyyy-MM-dd; use the current date from this prompt for "today"), startTime (HH:MM 24h; estimate from context, e.g. "this morning" ≈ 08:00), calories (estimate from type/duration/user weight if not given), notes (muscle groups or details the user mentioned, e.g. "legs").
   - logWater: {"action":"logWater","glasses":2} — each glass is 250 ml.

   Rules: only log when the user clearly reports an activity (not for hypotheticals or plans). Confirm what you logged in one short sentence BEFORE the block. Never emit the same log block twice in one reply. If key facts are missing, assume sensibly and say what you assumed.`;
