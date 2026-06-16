import crypto from "crypto";
import { readJson, writeJson, localDateStr, APP_TZ } from "./store";
import { EXERCISE_TYPE_SET } from "./workout-types";
import {
  DaySummary,
  RemoteFoodEntry,
  SleepSegment,
  SleepSummary,
  TrendPoint,
  TrendsPayload,
  WorkoutSession,
} from "./types";

/**
 * Google Health API client (health.googleapis.com/v4).
 *
 * This is Google's successor to the legacy Fitbit Web API (which shuts down
 * September 2026). Auth is standard Google OAuth 2.0; the app is registered
 * in Google Cloud Console with the Health API enabled. Data is queried per
 * data type: `dataPoints:dailyRollUp` for civil-day aggregates,
 * `dataPoints:rollUp` for intraday windows, and `dataPoints` list for
 * observation records (sleep sessions, daily vitals). Nutrition is written
 * back as anonymous-food `nutrition-log` data points.
 */

const API = "https://health.googleapis.com/v4";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
  "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
  // Manual workout logging (chat + journal). Added later than the read
  // scopes — reconnect Google Health once to grant it.
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly",
  // Settings page: units, timezone, profile, paired devices.
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
  "https://www.googleapis.com/auth/googlehealth.settings.readonly",
  // Google account name + profile photo for the avatar.
  "openid",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

// Max dailyRollUp/rollUp range is 14 days for these types, 90 for the rest.
const SHORT_RANGE_TYPES = new Set(["heart-rate", "total-calories", "active-minutes", "calories-in-heart-rate-zone"]);

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

const clientId = () => process.env.GOOGLE_HEALTH_CLIENT_ID || "";
const clientSecret = () => process.env.GOOGLE_HEALTH_CLIENT_SECRET || "";
const redirectUri = () =>
  (process.env.APP_BASE_URL || "http://localhost:3210") + "/api/googlehealth/callback";

export function hasCredentials() {
  return Boolean(clientId() && clientSecret());
}

export function getTokens(): Tokens | null {
  return readJson<Tokens | null>("googlehealth-tokens.json", null);
}

export function isConnected() {
  return hasCredentials() && getTokens() !== null;
}

export function disconnect() {
  writeJson("googlehealth-tokens.json", null);
}

// -- OAuth 2.0 (Google) ------------------------------------------

export function buildAuthUrl(): string {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  writeJson("googlehealth-pkce.json", { verifier, state });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: SCOPES,
    access_type: "offline", // ask for a refresh token
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string, state: string): Promise<void> {
  const pkce = readJson<{ verifier: string; state: string } | null>("googlehealth-pkce.json", null);
  if (!pkce || pkce.state !== state) throw new Error("OAuth state mismatch");

  await tokenRequest(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    })
  );
}

async function tokenRequest(body: URLSearchParams): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${JSON.stringify(json)}`);
  // Google omits refresh_token on refresh responses — keep the existing one.
  const prev = getTokens();
  const tokens: Tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? prev?.refresh_token ?? "",
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
  writeJson("googlehealth-tokens.json", tokens);
  return tokens;
}

async function freshTokens(): Promise<Tokens> {
  let tokens = getTokens();
  if (!tokens) throw new Error("Google Health not connected");
  if (Date.now() >= tokens.expires_at) {
    tokens = await tokenRequest(
      new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      })
    );
  }
  return tokens;
}

async function gFetch(path: string, init?: { method?: string; body?: unknown }): Promise<any | null> {
  const tokens = await freshTokens();
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    console.error(`Google Health ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  return res.json();
}

// -- Time helpers ------------------------------------------------

function toDateObj(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { year: y, month: m, day: d };
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fromDateObj(d: { year: number; month: number; day: number } | undefined): string {
  if (!d) return "";
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Physical-time ISO instant for local midnight of a civil date in Asia/Dubai. */
function localMidnightIso(date: string, timeZone = "Asia/Dubai"): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const utcDate = new Date(`${date}T00:00:00Z`);
    const tzParts = formatter.formatToParts(utcDate);
    const tzYear = Number(tzParts.find((p) => p.type === "year")?.value);
    const tzMonth = Number(tzParts.find((p) => p.type === "month")?.value) - 1;
    const tzDay = Number(tzParts.find((p) => p.type === "day")?.value);
    const tzHour = Number(tzParts.find((p) => p.type === "hour")?.value);
    const tzMin = Number(tzParts.find((p) => p.type === "minute")?.value);
    const tzSec = Number(tzParts.find((p) => p.type === "second")?.value);
    
    const localAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMin, tzSec);
    const offsetMs = localAsUtc - utcDate.getTime();
    
    const targetUtc = Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      0, 0, 0
    );
    return new Date(targetUtc - offsetMs).toISOString();
  } catch (e) {
    return new Date(`${date}T00:00:00`).toISOString();
  }
}


/** "HH:MM" clock time of an instant, in the app's data timezone. */
function tzTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: APP_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toTimeString().slice(0, 5);
  }
}

/** UTC offset of APP_TZ (in seconds, as a google-duration string). */
function utcOffsetDuration(at: Date): string {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, timeZoneName: "longOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00";
    const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    const secs = m ? (Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 * Math.sign(Number(m[1]) || 1)) : 0;
    return `${secs}s`;
  } catch {
    return `${-at.getTimezoneOffset() * 60}s`;
  }
}

// -- Query primitives --------------------------------------------

/** Civil-day aggregates; chunks requests to respect per-type range limits. */
async function dailyRollUp(dataType: string, start: string, endExclusive: string): Promise<any[]> {
  const maxDays = SHORT_RANGE_TYPES.has(dataType) ? 14 : 90;
  const out: any[] = [];
  let cursor = start;
  while (cursor < endExclusive) {
    const chunkEnd = addDays(cursor, maxDays) < endExclusive ? addDays(cursor, maxDays) : endExclusive;
    const res = await gFetch(`/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
      method: "POST",
      body: {
        range: { start: { date: toDateObj(cursor) }, end: { date: toDateObj(chunkEnd) } },
        windowSizeDays: 1,
        pageSize: maxDays,
      },
    });
    out.push(...(res?.rollupDataPoints ?? []));
    cursor = chunkEnd;
  }
  return out;
}

/** Physical-time aggregates within a single day (intraday curves). */
async function intradayRollUp(dataType: string, date: string, windowSeconds: number): Promise<any[]> {
  const maxDays = SHORT_RANGE_TYPES.has(dataType) ? 14 : 90;
  const limitSeconds = maxDays * 86400;
  const calculatedPageSize = windowSeconds > 0 ? Math.min(1000, Math.floor(limitSeconds / windowSeconds)) : 1000;

  const res = await gFetch(`/users/me/dataTypes/${dataType}/dataPoints:rollUp`, {
    method: "POST",
    body: {
      range: { startTime: localMidnightIso(date), endTime: localMidnightIso(addDays(date, 1)) },
      windowSize: `${windowSeconds}s`,
      pageSize: calculatedPageSize,
    },
  });
  return res?.dataPoints ?? res?.rollupDataPoints ?? [];
}

/** Raw data points filtered to a date window (AIP-160 filter). */
async function listDataPoints(dataType: string, filter: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ filter, pageSize: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(`/users/me/dataTypes/${dataType}/dataPoints?${params}`);
    if (!res) break;
    out.push(...(res.dataPoints ?? []));
    pageToken = res.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Daily observation types (daily-resting-heart-rate etc.) filtered by date. */
function listDaily(dataType: string, field: string, start: string, endInclusive: string) {
  return listDataPoints(
    dataType,
    `${field}.date >= "${start}" AND ${field}.date < "${addDays(endInclusive, 1)}"`
  );
}

// -- Data assembly -----------------------------------------------

const STAGE_MAP: Record<string, SleepSegment["stage"]> = {
  AWAKE: "wake",
  RESTLESS: "wake",
  LIGHT: "light",
  ASLEEP: "light",
  DEEP: "deep",
  REM: "rem",
};

/**
 * Combine all sleep sessions of one night into a single summary, matching how
 * Google Health (and `fetchTrends`) reports a night's total. A watch often
 * splits a fragmented night into several sessions (a long wake-up, an early
 * rise then back to bed); keeping only the longest one — as this used to —
 * dropped the later segments, so the dashboard showed an earlier, shorter
 * sleep than the user's Google Health app. We span the earliest start to the
 * latest end and sum stage minutes across every session.
 */
export function combineSleepSessions(rawPoints: any[]): SleepSummary | null {
  const sessions = rawPoints
    .map((p) => p?.sleep)
    .filter((s: any) => s && s.interval?.startTime && s.interval?.endTime)
    .sort(
      (a: any, b: any) =>
        new Date(a.interval.startTime).getTime() - new Date(b.interval.startTime).getTime()
    );
  if (!sessions.length) return null;

  const startIso = sessions[0].interval.startTime;
  const endIso = sessions[sessions.length - 1].interval.endTime;
  const globalStartMs = new Date(startIso).getTime();
  const fmt = (iso: string) => (iso ? tzTime(iso) : "");

  let asleep = 0;
  let inBed = 0;
  const stages = { deep: 0, light: 0, rem: 0, wake: 0 };
  const segments: SleepSegment[] = [];
  const gaps: SleepSegment[] = [];
  let prevEndMs = 0;

  for (const s of sessions) {
    const summary = s.summary ?? {};
    asleep += Number(summary.minutesAsleep ?? 0);
    inBed += Number(summary.minutesInSleepPeriod ?? 0);
    for (const st of summary.stagesSummary ?? []) {
      const stage = STAGE_MAP[st.type];
      if (stage) stages[stage] += Number(st.minutes ?? 0);
    }
    // The awake stretch between two sessions (out of bed, back later) gets no
    // stage points from the API, so without this it renders as an empty hole in
    // the hypnogram. Fill it with a wake segment so the Awake bar spans the
    // whole night. It's not added to `stages.wake` (the in-period wake the coach
    // reasons about) or to efficiency — this is out-of-bed time, timeline only.
    const sessStartMs = new Date(s.interval.startTime).getTime();
    if (prevEndMs && sessStartMs > prevEndMs) {
      gaps.push({
        stage: "wake",
        startMin: Math.round((prevEndMs - globalStartMs) / 60000),
        durMin: Math.round((sessStartMs - prevEndMs) / 60000),
      });
    }
    prevEndMs = new Date(s.interval.endTime).getTime();
    // Stage timeline for the hypnogram, relative to the night's first start.
    for (const st of s.stages ?? []) {
      if (!st.startTime || !st.endTime || !STAGE_MAP[st.type]) continue;
      const durMin = Math.round(
        (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000
      );
      if (durMin <= 0) continue;
      segments.push({
        stage: STAGE_MAP[st.type],
        startMin: Math.round((new Date(st.startTime).getTime() - globalStartMs) / 60000),
        durMin,
      });
    }
  }
  // Only bridge gaps when we actually have a stage timeline to bridge.
  if (segments.length) segments.push(...gaps);

  return {
    durationMin: asleep || inBed,
    efficiency: inBed ? Math.round((asleep / inBed) * 100) : 0,
    startTime: fmt(startIso),
    endTime: fmt(endIso),
    stages,
    segments: segments.length ? segments : undefined,
  };
}

/** Sleep sessions that *end* on the given civil date (i.e. last night). */
async function fetchSleepFor(date: string): Promise<SleepSummary | null> {
  const sessions = await listDataPoints(
    "sleep",
    `sleep.interval.end_time >= "${localMidnightIso(addDays(date, -1))}" AND sleep.interval.end_time < "${localMidnightIso(addDays(date, 1))}"`
  );
  const ending = sessions.filter((p) => {
    const end = p.sleep?.interval?.endTime;
    return end && new Date(end).toISOString() >= localMidnightIso(date);
  });
  return combineSleepSessions(ending);
}

interface DailyAggregates {
  steps: Map<string, number>;
  caloriesOut: Map<string, number>;
  azm: Map<string, { total: number; fatBurn: number; cardio: number; peak: number }>;
  distance: Map<string, number>;
  floors: Map<string, number>;
  caloriesIn: Map<string, number>;
  weight: Map<string, number>;
  restingHr: Map<string, number>;
  spo2: Map<string, number>;
  hrv: Map<string, number>;
  breathing: Map<string, number>;
}

async function fetchAggregates(start: string, endInclusive: string): Promise<DailyAggregates> {
  const endEx = addDays(endInclusive, 1);
  const [steps, totalCal, azm, distance, floors, nutrition, weight, rhr, spo2, hrv, br] =
    await Promise.all([
      dailyRollUp("steps", start, endEx),
      dailyRollUp("total-calories", start, endEx),
      dailyRollUp("active-zone-minutes", start, endEx),
      dailyRollUp("distance", start, endEx),
      dailyRollUp("floors", start, endEx),
      dailyRollUp("nutrition-log", start, endEx),
      dailyRollUp("weight", start, endEx),
      listDaily("daily-resting-heart-rate", "daily_resting_heart_rate", start, endInclusive),
      listDaily("daily-oxygen-saturation", "daily_oxygen_saturation", start, endInclusive),
      listDaily("daily-heart-rate-variability", "daily_heart_rate_variability", start, endInclusive),
      listDaily("daily-respiratory-rate", "daily_respiratory_rate", start, endInclusive),
    ]);

  const byDay = <T>(points: any[], pick: (p: any) => T | null): Map<string, T> => {
    const m = new Map<string, T>();
    for (const p of points) {
      const date = fromDateObj(p.civilStartTime?.date);
      const v = pick(p);
      if (date && v !== null) m.set(date, v);
    }
    return m;
  };

  const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));

  return {
    steps: byDay(steps, (p) => num(p.steps?.countSum)),
    caloriesOut: byDay(totalCal, (p) => num(p.totalCalories?.kcalSum)),
    azm: byDay(azm, (p) => {
      const z = p.activeZoneMinutes;
      if (!z) return null;
      const fatBurn = Number(z.sumInFatBurnHeartZone ?? 0);
      const cardio = Number(z.sumInCardioHeartZone ?? 0);
      const peak = Number(z.sumInPeakHeartZone ?? 0);
      return { total: fatBurn + cardio + peak, fatBurn, cardio, peak };
    }),
    distance: byDay(distance, (p) => num(p.distance?.millimetersSum)),
    floors: byDay(floors, (p) => num(p.floors?.countSum)),
    caloriesIn: byDay(nutrition, (p) => num(p.nutritionLog?.energy?.kcalSum ?? p.nutritionLog?.energy?.kcal)),
    weight: byDay(weight, (p) => num(p.weight?.weightGramsAvg)),
    restingHr: new Map(
      rhr.map((p) => [
        fromDateObj(p.dailyRestingHeartRate?.date),
        Number(p.dailyRestingHeartRate?.beatsPerMinute ?? 0),
      ])
    ),
    spo2: new Map(
      spo2.map((p) => [
        fromDateObj(p.dailyOxygenSaturation?.date),
        Number(p.dailyOxygenSaturation?.averagePercentage ?? 0),
      ])
    ),
    hrv: new Map(
      hrv.map((p) => [
        fromDateObj(p.dailyHeartRateVariability?.date),
        Number(p.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds ?? 0),
      ])
    ),
    breathing: new Map(
      br.map((p) => [
        fromDateObj(p.dailyRespiratoryRate?.date),
        Number(p.dailyRespiratoryRate?.breathsPerMinute ?? 0),
      ])
    ),
  };
}

function buildDay(date: string, agg: DailyAggregates): DaySummary {
  const azm = agg.azm.get(date);
  return {
    date,
    steps: agg.steps.get(date) ?? 0,
    stepsGoal: 10000,
    caloriesOut: Math.round(agg.caloriesOut.get(date) ?? 0),
    activeZoneMinutes: azm?.total ?? 0,
    azmGoal: 30,
    distanceKm: Math.round(((agg.distance.get(date) ?? 0) / 1_000_000) * 10) / 10,
    floors: agg.floors.get(date) ?? 0,
    restingHeartRate: agg.restingHr.get(date) ?? null,
    heartIntraday: [],
    heartZones: azm
      ? [
          { name: "Fat Burn", minutes: azm.fatBurn },
          { name: "Cardio", minutes: azm.cardio },
          { name: "Peak", minutes: azm.peak },
        ]
      : [],
    sleep: null,
    spo2: agg.spo2.get(date) ?? null,
    hrv: agg.hrv.get(date) ?? null,
    breathingRate: agg.breathing.get(date) ?? null,
    weightKg: agg.weight.has(date) ? Math.round((agg.weight.get(date)! / 1000) * 10) / 10 : null,
    caloriesIn: Math.round(agg.caloriesIn.get(date) ?? 0),
  };
}

/** Intraday heart-rate curve (30-min windows) for one civil date. */
export async function fetchHeartIntraday(date: string): Promise<DaySummary["heartIntraday"]> {
  const heart = await intradayRollUp("heart-rate", date, 1800);
  return heart
    .filter((p) => p.heartRate?.beatsPerMinuteAvg)
    // rollUp returns windows newest-first; the chart wants chronological
    .sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime())
    .map((p) => {
      const avg = Math.round(Number(p.heartRate.beatsPerMinuteAvg));
      return {
        time: p.startTime ? tzTime(p.startTime) : "",
        bpm: avg,
        min: Math.round(Number(p.heartRate.beatsPerMinuteMin ?? avg)),
        max: Math.round(Number(p.heartRate.beatsPerMinuteMax ?? avg)),
      };
    });
}

/** Full single-day summary including intraday heart rate and sleep detail. */
export async function fetchDay(date: string): Promise<DaySummary> {
  const [agg, heart, sleep] = await Promise.all([
    fetchAggregates(date, date),
    fetchHeartIntraday(date),
    fetchSleepFor(date),
  ]);
  const day = buildDay(date, agg);
  day.sleep = sleep;
  day.heartIntraday = heart;
  return day;
}

/** All sleep sessions in the range, combined per the civil date they end on. */
async function fetchSleepByDay(start: string, endInclusive: string): Promise<Map<string, SleepSummary>> {
  const sessions = await listDataPoints(
    "sleep",
    `sleep.interval.end_time >= "${localMidnightIso(addDays(start, -1))}" AND sleep.interval.end_time < "${localMidnightIso(addDays(endInclusive, 1))}"`
  );
  const byDay = new Map<string, any[]>();
  for (const p of sessions) {
    const endIso = p.sleep?.interval?.endTime;
    if (!endIso) continue;
    const key = localDateStr(new Date(endIso));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(p);
  }
  const out = new Map<string, SleepSummary>();
  for (const [date, points] of byDay) {
    const combined = combineSleepSessions(points);
    if (combined) out.set(date, combined);
  }
  return out;
}

/** Day summaries (no intraday) with per-day sleep, oldest first. */
export async function fetchDays(start: string, endInclusive: string): Promise<DaySummary[]> {
  const [agg, sleepByDay] = await Promise.all([
    fetchAggregates(start, endInclusive),
    fetchSleepByDay(start, endInclusive),
  ]);
  const out: DaySummary[] = [];
  for (let d = start; d <= endInclusive; d = addDays(d, 1)) {
    const day = buildDay(d, agg);
    day.sleep = sleepByDay.get(d) ?? null;
    out.push(day);
  }
  return out;
}

/** Trend series assembled from day summaries (archived and/or live). */
export function trendsFromDays(
  days: DaySummary[],
  range: { start: string; end: string }
): TrendsPayload {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const series = (get: (d: DaySummary) => number | null | undefined): TrendPoint[] => {
    const pts: TrendPoint[] = [];
    for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
      const d = byDate.get(date);
      const v = d ? get(d) : null;
      pts.push({ date, value: v === undefined || v === null ? null : v });
    }
    return pts;
  };
  // DaySummary stores absent counters as 0; charts want gaps, so 0 -> null
  // for metrics where a true zero means "no data synced that day".
  const orNull = (v: number) => (v > 0 ? v : null);
  return {
    demo: false,
    range,
    steps: series((d) => orNull(d.steps)),
    restingHr: series((d) => d.restingHeartRate),
    sleepMin: series((d) => orNull(d.sleep?.durationMin ?? 0)),
    weightKg: series((d) => d.weightKg),
    caloriesOut: series((d) => orNull(d.caloriesOut)),
    caloriesIn: series((d) => orNull(d.caloriesIn)),
    hrv: series((d) => d.hrv),
    spo2: series((d) => d.spo2),
    azm: series((d) => orNull(d.activeZoneMinutes)),
  };
}

/** Log a meal back to Google Health as an anonymous-food nutrition-log point.
 *  Returns the created dataPoint resource name (provenance key), or null. */
export async function logFoodToGoogleHealth(entry: {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  at: Date;
  mealType?: "breakfast" | "lunch" | "dinner" | "other";
}): Promise<string | null> {
  const googleMealType =
    { breakfast: "BREAKFAST", lunch: "LUNCH", dinner: "DINNER", other: "ANYTIME" }[entry.mealType ?? "other"];
  try {
    const start = entry.at;
    const end = new Date(start.getTime() + 60_000);
    const offset = utcOffsetDuration(start);
    const res = await gFetch(`/users/me/dataTypes/nutrition-log/dataPoints`, {
      method: "POST",
      body: {
        nutritionLog: {
          foodDisplayName: entry.name,
          mealType: googleMealType,
          energy: { kcal: entry.calories, userProvidedUnit: "KILOCALORIE" },
          totalCarbohydrate: { grams: entry.carbsG, userProvidedUnit: "GRAM" },
          totalFat: { grams: entry.fatG, userProvidedUnit: "GRAM" },
          nutrients: [
            { nutrient: "PROTEIN", quantity: { grams: entry.proteinG, userProvidedUnit: "GRAM" } },
          ],
          interval: {
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            startUtcOffset: offset,
            endUtcOffset: offset,
          },
        },
      },
    });
    return createdName(res);
  } catch {
    return null;
  }
}

// -- Workouts (exercise sessions) ---------------------------------

/** Coerces a free-form activity word to a valid ExerciseType enum value. */
export function normalizeExerciseType(raw: string): string {
  const t = (raw || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (EXERCISE_TYPE_SET.has(t)) return t;
  if (/LEG|GYM|LIFT|WEIGHT/.test(t)) return "STRENGTH_TRAINING";
  if (/WALK/.test(t)) return "WALKING";
  if (/RUN|JOG/.test(t)) return "RUNNING";
  if (/CYCL|BIK/.test(t)) return "BIKING";
  if (/SWIM/.test(t)) return "SWIMMING_POOL";
  if (/YOGA/.test(t)) return "YOGA";
  // Enum-shaped token we don't have in the bundled snapshot — likely a type
  // Google added after it. Pass it through rather than collapsing to WORKOUT.
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(t)) return t;
  return "WORKOUT";
}

/** Rewrite an existing exercise session's type + display name on Google via a
 *  read-modify-write patch. Returns true only if Google accepted the write —
 *  sessions owned by another source app are commonly rejected, in which case
 *  the caller keeps a local override instead. */
export async function updateExerciseType(
  name: string,
  exerciseType: string,
  displayName: string
): Promise<boolean> {
  try {
    const point = await gFetch(`/${name}`);
    if (!point?.exercise) return false;
    point.exercise.exerciseType = normalizeExerciseType(exerciseType);
    point.exercise.displayName = displayName;
    const res = await gFetch(`/${name}`, { method: "PATCH", body: point });
    return res != null;
  } catch {
    return false;
  }
}

/** Exercise sessions whose start falls inside [start, endInclusive] civil days. */
export async function fetchWorkouts(
  start: string,
  endInclusive: string,
  maxPages = 5
): Promise<WorkoutSession[]> {
  // exercise (unlike sleep) rejects interval filters — list newest-first
  // pages and window client-side. maxPages bounds how deep we page; the
  // archive backfill raises it to reach a year back.
  const points = await listRecentInWindow(
    "exercise",
    (p) => p.exercise?.interval?.startTime,
    localMidnightIso(start),
    localMidnightIso(addDays(endInclusive, 1)),
    maxPages
  );
  return points
    .map((p: any): WorkoutSession | null => {
      const e = p.exercise;
      if (!e?.interval?.startTime) return null;
      const startIso = e.interval.startTime;
      const endIso = e.interval.endTime ?? startIso;
      const m = e.metricsSummary ?? {};
      const durMin = e.activeDuration
        ? Math.round(parseFloat(e.activeDuration) / 60)
        : Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
      return {
        id: p.name ?? `${startIso}-${e.exerciseType}`,
        source: "google",
        name: e.displayName || (e.exerciseType ?? "Workout").replace(/_/g, " ").toLowerCase(),
        exerciseType: e.exerciseType ?? "WORKOUT",
        date: localDateStr(new Date(startIso)),
        startTime: tzTime(startIso),
        durationMin: durMin,
        calories: m.caloriesKcal != null ? Math.round(Number(m.caloriesKcal)) : null,
        avgHr: m.averageHeartRateBeatsPerMinute != null ? Number(m.averageHeartRateBeatsPerMinute) : null,
        distanceKm:
          m.distanceMillimeters != null ? Math.round(Number(m.distanceMillimeters) / 100000) / 10 : null,
        notes: e.notes,
        syncedToHealth: true,
        googleName: p.name,
      };
    })
    .filter((w): w is WorkoutSession => w !== null)
    .sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));
}

/** dataPoints.create returns a long-running Operation envelope:
 *  { done: true, response: { name, ... } } — unwrap to the resource name. */
function createdName(res: any): string | null {
  if (!res) return null;
  return res.response?.name ?? res.name ?? "";
}

/** Logs a manual workout; returns the created dataPoint name, or null. */
export async function logExerciseToGoogleHealth(entry: {
  name: string;
  exerciseType: string;
  start: Date;
  durationMin: number;
  calories?: number | null;
  notes?: string;
}): Promise<string | null> {
  try {
    const end = new Date(entry.start.getTime() + entry.durationMin * 60000);
    const offset = utcOffsetDuration(entry.start);
    const metricsSummary: any = {};
    if (entry.calories) metricsSummary.caloriesKcal = entry.calories;
    const res = await gFetch(`/users/me/dataTypes/exercise/dataPoints`, {
      method: "POST",
      body: {
        exercise: {
          displayName: entry.name,
          exerciseType: normalizeExerciseType(entry.exerciseType),
          notes: entry.notes || undefined,
          metricsSummary,
          interval: {
            startTime: entry.start.toISOString(),
            endTime: end.toISOString(),
            startUtcOffset: offset,
            endUtcOffset: offset,
          },
        },
      },
    });
    return createdName(res);
  } catch {
    return null;
  }
}

// -- Water (hydration-log) ----------------------------------------

/** Total milliliters logged on a civil date, from the API. */
export async function fetchWaterTotal(date: string): Promise<number | null> {
  try {
    const points = await dailyRollUp("hydration-log", date, addDays(date, 1));
    if (!points.length) return 0;
    return Math.round(Number(points[0]?.hydrationLog?.amountConsumed?.millilitersSum ?? 0));
  } catch {
    return null;
  }
}

/** Per-day water totals (ml) for a date range — used by the archive backfill. */
export async function fetchWaterByDay(start: string, endInclusive: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const points = await dailyRollUp("hydration-log", start, addDays(endInclusive, 1));
  for (const p of points) {
    const date = fromDateObj(p.civilStartTime?.date);
    if (date) out.set(date, Math.round(Number(p.hydrationLog?.amountConsumed?.millilitersSum ?? 0)));
  }
  return out;
}

/** Logs water; returns the created dataPoint name ("" if unnamed), or null. */
export async function logWaterToGoogleHealth(ml: number, at: Date): Promise<string | null> {
  try {
    const end = new Date(at.getTime() + 60000);
    const offset = utcOffsetDuration(at);
    const res = await gFetch(`/users/me/dataTypes/hydration-log/dataPoints`, {
      method: "POST",
      body: {
        hydrationLog: {
          amountConsumed: { milliliters: ml, userProvidedUnit: "MILLILITER" },
          interval: {
            startTime: at.toISOString(),
            endTime: end.toISOString(),
            startUtcOffset: offset,
            endUtcOffset: offset,
          },
        },
      },
    });
    return createdName(res);
  } catch {
    return null;
  }
}

/** Deletes a previously created dataPoint (used by the water "-" button). */
export async function deleteDataPoint(dataType: string, name: string): Promise<boolean> {
  const res = await gFetch(`/users/me/dataTypes/${dataType}/dataPoints:batchDelete`, {
    method: "POST",
    body: { names: [name] },
  });
  return res !== null;
}

// -- Remote food entries (logged in other apps, synced from the API) --

export async function fetchRemoteFood(start: string, endInclusive: string): Promise<RemoteFoodEntry[]> {
  const points = await listRecentInWindow(
    "nutrition-log",
    (p) => p.nutritionLog?.interval?.startTime,
    localMidnightIso(start),
    localMidnightIso(addDays(endInclusive, 1))
  );
  return points
    .map((p: any): RemoteFoodEntry | null => {
      const n = p.nutritionLog;
      if (!n) return null;
      // Macros are optional on nutrition-log points — present when the
      // originating app wrote them (this app always does).
      const grams = (v: any): number | null =>
        v?.grams != null ? Math.round(Number(v.grams)) : null;
      const protein = (n.nutrients ?? []).find((x: any) => x.nutrient === "PROTEIN");
      return {
        name: n.foodDisplayName || "Meal",
        calories: Math.round(Number(n.energy?.kcal ?? 0)),
        at: n.interval?.startTime ?? "",
        mealType: n.mealType,
        proteinG: grams(protein?.quantity),
        carbsG: grams(n.totalCarbohydrate),
        fatG: grams(n.totalFat),
        googleName: p.name,
      };
    })
    .filter((f): f is RemoteFoodEntry => f !== null && Boolean(f.at))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** The instant corresponding to a civil "yyyy-MM-dd" + "HH:MM" in APP_TZ. */
export function civilToDate(date: string, time: string): Date {
  const midnight = new Date(localMidnightIso(date)).getTime();
  const [h, m] = time.split(":").map(Number);
  return new Date(midnight + (h * 60 + m) * 60000);
}

/**
 * Lists data points without a filter (some types reject interval filters)
 * and keeps those whose start instant falls in [startIso, endIso). Pages
 * arrive newest-first; stops once a page is entirely older than the window.
 */
async function listRecentInWindow(
  dataType: string,
  getStart: (p: any) => string | undefined,
  startIso: string,
  endIso: string,
  maxPages = 5
): Promise<any[]> {
  const out: any[] = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(`/users/me/dataTypes/${dataType}/dataPoints?${params}`);
    if (!res) break;
    const points = res.dataPoints ?? [];
    let anyInOrAfterWindow = false;
    for (const p of points) {
      const s = getStart(p);
      if (!s) continue;
      const iso = new Date(s).toISOString();
      if (iso >= startIso && iso < endIso) out.push(p);
      if (iso >= startIso) anyInOrAfterWindow = true;
    }
    pageToken = res.nextPageToken ?? "";
    if (!pageToken || (points.length > 0 && !anyInOrAfterWindow)) break;
  }
  return out;
}

// -- Account: scopes, profile, settings, devices ------------------

/** Scopes actually granted to the current token (via tokeninfo). */
export async function grantedScopes(): Promise<string[]> {
  try {
    const tokens = await freshTokens();
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tokens.access_token)}`
    );
    if (!res.ok) return [];
    const json = await res.json();
    return String(json.scope ?? "").split(" ").filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchAccount(): Promise<{
  profile: any | null;
  settings: any | null;
  devices: any[];
}> {
  const [profile, settings, devices] = await Promise.all([
    gFetch("/users/me/profile"),
    gFetch("/users/me/settings"),
    gFetch("/users/me/pairedDevices"),
  ]);
  return {
    profile,
    settings,
    devices: devices?.pairedDevices ?? devices?.devices ?? [],
  };
}

/** Google account name + photo (needs openid/userinfo.profile; cached). */
export async function fetchUserInfo(): Promise<{ name: string; picture: string } | null> {
  const cached = readJson<{ name: string; picture: string } | null>("userinfo.json", null);
  if (cached) return cached;
  try {
    const tokens = await freshTokens();
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const info = { name: String(json.given_name ?? json.name ?? ""), picture: String(json.picture ?? "") };
    if (info.name || info.picture) writeJson("userinfo.json", info);
    return info;
  } catch {
    return null;
  }
}
