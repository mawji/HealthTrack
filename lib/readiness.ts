// App-derived recovery / readiness score.
//
// Google Health's API exposes no readiness data type (it is app-only and
// proprietary), so we derive our own from the same physiological signals the
// research converges on — HRV, resting heart rate, and last night's sleep —
// scored relative to the user's OWN rolling baseline rather than absolute
// values. Method follows the WHOOP / Oura / HRV4Training (Altini) consensus:
//   - HRV is the primary signal (weighted heaviest); rMSSD is right-skewed so
//     we work in ln(rMSSD).
//   - "Normal" is a band of baseline mean ± 0.75 SD; within/above = recovered,
//     below = suppressed.
//   - RHR and sleep are secondary (their information overlaps HRV per WHOOP).
// This is deterministic and explainable; the AI only phrases the result.
//
// See plans/daily-trends-ai-suggestions.md and the readiness-score-methodology
// memory.

import { DaySummary, ReadinessBand, ReadinessScore } from "./types";

const COLORS: Record<ReadinessBand, string> = {
  low: "var(--heart)",
  fair: "var(--food)",
  good: "var(--activity)",
  high: "var(--activity)",
};

interface Stat {
  mean: number;
  sd: number;
  n: number;
}

function stats(vals: number[]): Stat {
  const n = vals.length;
  if (n === 0) return { mean: 0, sd: 0, n: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, sd: 0, n };
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance), n };
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Standardized deviation; 0 SD baseline (single sample) yields a neutral 0. */
function zscore(value: number, s: Stat): number {
  if (s.sd <= 0) return 0;
  return (value - s.mean) / s.sd;
}

/**
 * Map a z-score to a 0-100 sub-score where being AT baseline is already "good"
 * (~70), not the middle. `dir` = +1 when higher-is-better (HRV), -1 when
 * lower-is-better (RHR). A 1.5 SD move spans the full 30-point swing from
 * baseline, so a meaningful suppression lands in fair/low territory.
 */
function subScore(z: number, dir: 1 | -1): number {
  return clamp(70 + dir * 30 * (z / 1.5));
}

function durationSub(durationMin: number): number {
  // 8h → 100, 7h (target) → 85, 6h → 65, 5h → 45, linear, clamped.
  return clamp(85 + ((durationMin - 420) / 60) * 20);
}

function bandFor(score: number): ReadinessBand {
  if (score < 34) return "low";
  if (score < 67) return "fair";
  if (score < 85) return "good";
  return "high";
}

/** ln(rMSSD) baseline back-transformed to a ms normal range (mean ± 0.75 SD). */
function hrvNormalRange(lnStat: Stat): [number, number] {
  return [Math.exp(lnStat.mean - 0.75 * lnStat.sd), Math.exp(lnStat.mean + 0.75 * lnStat.sd)];
}

/**
 * Compute the readiness score for `today` against the preceding `history`
 * window. `history` should be prior days only (today excluded) so today's
 * value doesn't pollute its own baseline. Returns null when no component can
 * be computed at all (no HRV/RHR today).
 */
export function computeReadiness(today: DaySummary, history: DaySummary[]): ReadinessScore | null {
  const parts: { score: number; weight: number }[] = [];
  const reasons: string[] = [];
  let metric = "";

  // HRV (primary). ln-transform; baseline mean ± 0.75 SD normal band.
  const hrvHist = history.map((d) => d.hrv).filter((v): v is number => v != null && v > 0);
  const lnStat = stats(hrvHist.map((v) => Math.log(v)));
  if (today.hrv != null && today.hrv > 0 && lnStat.n >= 3) {
    const z = zscore(Math.log(today.hrv), lnStat);
    parts.push({ score: subScore(z, 1), weight: 0.5 });
    const [lo, hi] = hrvNormalRange(lnStat);
    const norm = `${Math.round(lo)}–${Math.round(hi)}ms`;
    if (z < -0.75) {
      reasons.push(`HRV ${today.hrv}ms is below your normal ${norm}`);
      metric = metric || `HRV ${today.hrv}ms below ${norm} normal`;
    } else if (z > 0.75) {
      reasons.push(`HRV ${today.hrv}ms is above your normal ${norm}`);
      metric = metric || `HRV ${today.hrv}ms above ${norm} normal`;
    }
  }

  // RHR (secondary; lower is better).
  const rhrHist = history.map((d) => d.restingHeartRate).filter((v): v is number => v != null && v > 0);
  const rhrStat = stats(rhrHist);
  if (today.restingHeartRate != null && rhrStat.n >= 3) {
    const z = zscore(today.restingHeartRate, rhrStat);
    parts.push({ score: subScore(z, -1), weight: 0.25 });
    if (z > 0.75) {
      const up = Math.round(today.restingHeartRate - rhrStat.mean);
      reasons.push(`resting HR is ${up}bpm above your ${Math.round(rhrStat.mean)}bpm average`);
    }
  }

  // Sleep (secondary): last night duration + efficiency.
  if (today.sleep) {
    const dur = durationSub(today.sleep.durationMin);
    const eff = clamp(today.sleep.efficiency);
    parts.push({ score: 0.7 * dur + 0.3 * eff, weight: 0.25 });
    const hrs = (today.sleep.durationMin / 60).toFixed(1);
    if (today.sleep.durationMin < 390) reasons.push(`only ${hrs}h sleep last night`);
    else if (today.sleep.efficiency < 85) reasons.push(`sleep efficiency ${today.sleep.efficiency}% (target >85%)`);
  }

  if (parts.length === 0) return null;

  const wSum = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / wSum);
  const band = bandFor(score);

  if (!metric) {
    metric = reasons[0]
      ? reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1)
      : `Readiness ${score}/100`;
  }

  return {
    score,
    band,
    color: COLORS[band],
    metric,
    reasons,
    confident: lnStat.n >= 14,
  };
}
