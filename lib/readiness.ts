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
// The scoring has four deliberate refinements (HRV stability plateau, HRV–RHR
// decoupling guard, weakest-link aggregation, acute short-sleep penalty). Their
// evidence basis and the tunable knobs are documented in detail in
// docs/readiness-scoring.md — read that before changing the constants here.
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

/**
 * HRV sub-score with a PLATEAU above the personal normal band (refinement #1).
 * Readiness is HRV *stability*, not "higher is better" (Altini/HRV4Training):
 * at/above the normal band is good, but a spike above earns NO extra credit;
 * dropping below the band is penalized, steeply once outside it. `z` is
 * ln(rMSSD) standardized to the rolling baseline. See docs/readiness-scoring.md.
 */
function hrvSub(z: number): number {
  if (z >= 0) return clamp(80 + Math.min(z, 1) * 5); // at/above baseline → 80–85 plateau
  if (z >= -0.75) return clamp(80 + z * 8); // within the normal band → gentle 80→74
  return clamp(74 + (z + 0.75) * 45); // below the normal band → steep penalty
}

/**
 * Sleep sub-score: duration-led (0.8) + efficiency (0.2), with an acute
 * short-sleep penalty below 5h (refinement #4). Sleep-deprivation research
 * treats <5–6h as a strong next-day impairment, so a high efficiency must not
 * mask a short night. See docs/readiness-scoring.md.
 */
function sleepSub(durationMin: number, efficiency: number): number {
  let s = 0.8 * durationSub(durationMin) + 0.2 * clamp(efficiency);
  if (durationMin < 300) {
    const deficitH = (300 - durationMin) / 60; // hours under the 5h floor
    s *= Math.max(0.4, 1 - deficitH * 0.25); // up to −60% for very short nights
  }
  return clamp(s);
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

  // Standardize each signal against its own rolling baseline first.
  const hrvHist = history.map((d) => d.hrv).filter((v): v is number => v != null && v > 0);
  const lnStat = stats(hrvHist.map((v) => Math.log(v)));
  const zHrv =
    today.hrv != null && today.hrv > 0 && lnStat.n >= 3 ? zscore(Math.log(today.hrv), lnStat) : null;

  const rhrHist = history.map((d) => d.restingHeartRate).filter((v): v is number => v != null && v > 0);
  const rhrStat = stats(rhrHist);
  const zRhr =
    today.restingHeartRate != null && rhrStat.n >= 3
      ? zscore(today.restingHeartRate, rhrStat)
      : null;

  // HRV (primary, weight 0.5). Stability-plateau scoring (refinement #1).
  if (zHrv != null) {
    let s = hrvSub(zHrv);
    const [lo, hi] = hrvNormalRange(lnStat);
    const norm = `${Math.round(lo)}–${Math.round(hi)}ms`;
    // Decoupling guard (refinement #2): a high-HRV spike that coincides with an
    // ELEVATED resting HR is not genuine recovery (parasympathetic saturation /
    // short-night artifact), so it must not score as "recovered".
    const decoupled = zHrv > 0.75 && zRhr != null && zRhr > 0.75;
    if (decoupled) {
      s = Math.min(s, 55);
      reasons.push(`HRV ${today.hrv}ms is elevated but resting HR is up too — reads as strain, not recovery`);
      metric = metric || "Elevated HRV alongside a raised resting HR — likely strain, not recovery";
    } else if (zHrv < -0.75) {
      reasons.push(`HRV ${today.hrv}ms is below your normal ${norm}`);
      metric = metric || `HRV ${today.hrv}ms below ${norm} normal`;
    } else if (zHrv > 0.75) {
      reasons.push(`HRV ${today.hrv}ms is above your normal ${norm}`);
    }
    parts.push({ score: s, weight: 0.5 });
  }

  // RHR (secondary, weight 0.25; lower is better).
  if (zRhr != null) {
    parts.push({ score: subScore(zRhr, -1), weight: 0.25 });
    if (zRhr > 0.75) {
      const up = Math.round(today.restingHeartRate! - rhrStat.mean);
      reasons.push(`resting HR is ${up}bpm above your ${Math.round(rhrStat.mean)}bpm average`);
      metric = metric || `Resting HR ${up}bpm above your ${Math.round(rhrStat.mean)}bpm average`;
    }
  }

  // Sleep (secondary, weight 0.25): duration-led with acute short-sleep penalty.
  if (today.sleep) {
    parts.push({ score: sleepSub(today.sleep.durationMin, today.sleep.efficiency), weight: 0.25 });
    const hrs = (today.sleep.durationMin / 60).toFixed(1);
    if (today.sleep.durationMin < 360) {
      reasons.push(`only ${hrs}h sleep last night`);
      metric = metric || `Only ${hrs}h sleep last night`;
    } else if (today.sleep.efficiency < 85) {
      reasons.push(`sleep efficiency ${today.sleep.efficiency}% (target >85%)`);
    }
  }

  if (parts.length === 0) return null;

  // Aggregation (refinement #3): blend the weighted mean toward the WORST
  // component, so one severely under-recovered system caps overall readiness
  // rather than being averaged away by a strong one.
  const wSum = parts.reduce((a, p) => a + p.weight, 0);
  const weightedMean = parts.reduce((a, p) => a + p.score * p.weight, 0) / wSum;
  const worst = Math.min(...parts.map((p) => p.score));
  const score = Math.round(0.6 * weightedMean + 0.4 * worst);
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
