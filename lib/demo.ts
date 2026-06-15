import { DaySummary, SleepSegment, SleepSummary, TrendsPayload, TrendPoint, WorkoutSession } from "./types";

// Deterministic pseudo-random so demo data is stable across reloads.
function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayNumber(date: string) {
  return Math.floor(new Date(date + "T00:00:00Z").getTime() / 86400000);
}

export function demoDay(date: string): DaySummary {
  const n = dayNumber(date);
  const rnd = seeded(n * 7919 + 13);
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const weekend = weekday === 0 || weekday === 6;

  const steps = Math.round((weekend ? 6200 : 8900) + rnd() * 4800);
  const restingHr = Math.round(58 + rnd() * 6);
  const sleepDur = Math.round(380 + rnd() * 90); // 6.3–7.8h

  // Stage timeline first; stage totals are derived from it so the
  // hypnogram and the summary numbers always agree.
  const segments: SleepSegment[] = [];
  let t = 0;
  segments.push({ stage: "light", startMin: 0, durMin: Math.round(10 + rnd() * 10) });
  t = segments[0].durMin;
  while (t < sleepDur) {
    const progress = t / sleepDur;
    const r = rnd();
    let stage: SleepSegment["stage"];
    if (r < 0.3 * (1 - progress)) stage = "deep"; // deep front-loaded
    else if (r < 0.3 * (1 - progress) + 0.12 + 0.25 * progress) stage = "rem"; // REM back-loaded
    else if (r > 0.93) stage = "wake";
    else stage = "light";
    const dur =
      stage === "wake"
        ? Math.round(2 + rnd() * 6)
        : stage === "deep"
          ? Math.round(15 + rnd() * 25)
          : stage === "rem"
            ? Math.round(10 + rnd() * 25)
            : Math.round(15 + rnd() * 30);
    const durMin = Math.min(dur, sleepDur - t);
    segments.push({ stage, startMin: t, durMin });
    t += durMin;
  }
  const sum = (s: SleepSegment["stage"]) =>
    segments.filter((x) => x.stage === s).reduce((a, x) => a + x.durMin, 0);
  const deep = sum("deep");
  const rem = sum("rem");
  const wake = sum("wake");
  const light = sleepDur - deep - rem - wake;

  const sleep: SleepSummary = {
    durationMin: sleepDur - wake,
    efficiency: Math.round(((sleepDur - wake) / sleepDur) * 100),
    startTime: "23:12",
    endTime: "06:48",
    stages: { deep, light, rem, wake },
    segments,
  };

  // Intraday heart rate: a plausible daily curve sampled every 30 min,
  // with a min–max range per interval (matches Google Health rollups).
  const heartIntraday: { time: string; bpm: number; min: number; max: number }[] = [];
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  const isToday = date === dateKey(new Date());
  for (let h = 0; h < 24; h += 0.5) {
    if (isToday && h > nowH) break;
    let bpm = restingHr + 4;
    let spread = 4 + rnd() * 3;
    if (h >= 7 && h < 9) {
      bpm += 18 + rnd() * 10; // morning walk
      spread = 9 + rnd() * 5;
    } else if (h >= 12 && h < 13) {
      bpm += 10 + rnd() * 6;
    } else if (h >= 18 && h < 19.5) {
      bpm += 45 + rnd() * 25; // workout
      spread = 16 + rnd() * 10;
    } else if (h >= 22 || h < 6) {
      bpm -= 6 + rnd() * 4;
      spread = 2.5 + rnd() * 2;
    } else {
      bpm += rnd() * 12;
    }
    const hh = String(Math.floor(h)).padStart(2, "0");
    const mm = h % 1 ? "30" : "00";
    heartIntraday.push({
      time: `${hh}:${mm}`,
      bpm: Math.round(bpm),
      min: Math.round(bpm - spread),
      max: Math.round(bpm + spread),
    });
  }

  const azm = Math.round(25 + rnd() * 50);
  return {
    date,
    steps,
    stepsGoal: 10000,
    caloriesOut: Math.round(2100 + steps * 0.04 + rnd() * 150),
    activeZoneMinutes: azm,
    azmGoal: 30,
    distanceKm: Math.round(steps * 0.00072 * 10) / 10,
    floors: Math.round(4 + rnd() * 10),
    restingHeartRate: restingHr,
    heartIntraday,
    heartZones: [
      { name: "Out of Range", minutes: Math.round(1200 + rnd() * 100) },
      { name: "Fat Burn", minutes: Math.round(40 + rnd() * 40) },
      { name: "Cardio", minutes: Math.round(12 + rnd() * 18) },
      { name: "Peak", minutes: Math.round(rnd() * 8) },
    ],
    sleep,
    spo2: Math.round((95.5 + rnd() * 2.5) * 10) / 10,
    hrv: Math.round(38 + rnd() * 22),
    breathingRate: Math.round((14 + rnd() * 2.6) * 10) / 10,
    weightKg: Math.round((76.4 - n * 0.004 + rnd() * 0.6) * 10) / 10,
    caloriesIn: Math.round(1750 + rnd() * 500),
  };
}

export function demoRange(days: number): DaySummary[] {
  const out: DaySummary[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(demoDay(dateKey(d)));
  }
  return out;
}

export function demoTrends(days: number): TrendsPayload {
  const range = demoRange(days);
  const pick = (f: (d: DaySummary) => number | null): TrendPoint[] =>
    range.map((d) => ({ date: d.date, value: f(d) }));
  return {
    demo: true,
    range: { start: range[0].date, end: range[range.length - 1].date },
    steps: pick((d) => d.steps),
    restingHr: pick((d) => d.restingHeartRate),
    sleepMin: pick((d) => d.sleep?.durationMin ?? null),
    weightKg: pick((d) => d.weightKg),
    caloriesOut: pick((d) => d.caloriesOut),
    caloriesIn: pick((d) => d.caloriesIn),
    hrv: pick((d) => d.hrv),
    spo2: pick((d) => d.spo2),
    azm: pick((d) => d.activeZoneMinutes),
  };
}

/** Plausible workout history: weights Tue/Thu, run Sat, walks most days. */
export function demoWorkouts(days: number): WorkoutSession[] {
  const out: WorkoutSession[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const rnd = seeded(dayNumber(date) * 131 + 7);
    const weekday = new Date(date + "T00:00:00Z").getUTCDay();
    if (weekday === 2 || weekday === 4) {
      out.push({
        id: `demo-w-${date}`,
        source: "google",
        name: "Weights",
        exerciseType: "STRENGTH_TRAINING",
        date,
        startTime: "18:10",
        durationMin: Math.round(40 + rnd() * 25),
        calories: Math.round(220 + rnd() * 120),
        avgHr: Math.round(102 + rnd() * 16),
        distanceKm: null,
        syncedToHealth: true,
      });
    }
    if (weekday === 6) {
      out.push({
        id: `demo-r-${date}`,
        source: "google",
        name: "Morning run",
        exerciseType: "RUNNING",
        date,
        startTime: "07:25",
        durationMin: Math.round(28 + rnd() * 14),
        calories: Math.round(280 + rnd() * 110),
        avgHr: Math.round(142 + rnd() * 14),
        distanceKm: Math.round((4 + rnd() * 3) * 10) / 10,
        syncedToHealth: true,
      });
    }
    if (rnd() > 0.45) {
      out.push({
        id: `demo-walk-${date}`,
        source: "google",
        name: "Walk",
        exerciseType: "WALKING",
        date,
        startTime: "20:05",
        durationMin: Math.round(22 + rnd() * 25),
        calories: Math.round(90 + rnd() * 80),
        avgHr: Math.round(88 + rnd() * 12),
        distanceKm: Math.round((1.8 + rnd() * 2) * 10) / 10,
        syncedToHealth: true,
      });
    }
  }
  return out.sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));
}
