# Readiness scoring — design decisions

This documents **how HealthTrack's app-derived readiness score is computed and why**, including
which choices are evidence-backed and which are heuristic. It is intentionally detailed because the
scoring is iterative — we will keep refining it. **Read this before changing the constants in
[`lib/readiness.ts`](../lib/readiness.ts).**

Related: the [readiness-score-methodology](../../) memory (WHOOP/Oura/Altini basis) and
[`plans/daily-trends-ai-suggestions.md`](../plans/daily-trends-ai-suggestions.md).

## Why we derive our own score

Google Health's "readiness" is **not exposed by the v4 API** (verified against the data-type spec).
It is app-only and proprietary. So we derive our own signal from the same inputs the research
converges on — **HRV, resting heart rate (RHR), and last night's sleep** — scored **relative to the
user's own rolling baseline**, not absolute values. It is deterministic; the AI only phrases it. We
label it "app-derived" and never claim it is Google's number.

## Core philosophy (this is the part that is well-supported)

From the Altini / HRV4Training literature: **readiness is HRV _stability relative to your own
normal_, not "higher is better."** Being within (or at the top of) your personal normal band is the
good state; dropping below it signals suppression. rMSSD is right-skewed, so we work in `ln(rMSSD)`,
and "normal" is a band of **baseline mean ± 0.75 SD** (HRV4Training "normal values" convention).
RHR and sleep are secondary signals whose information partly overlaps HRV (WHOOP).

## The pipeline

1. Standardize each signal against its rolling baseline (`z`-score; HRV in log space).
2. Map each to a 0–100 sub-score.
3. Weight: **HRV 0.5, RHR 0.25, sleep 0.25** (mirrors WHOOP's "HRV carries most predictive value").
4. Aggregate (see refinement #3).
5. Band: `<34` low (red), `34–66` fair (amber), `67–84` good, `85+` high (green) — WHOOP's band
   structure.

## The four refinements

Each is graded by evidence strength. **The _directions_ are grounded; the exact _magnitudes_ are
heuristic** — no one (Google included) publishes a physiology→0-100 mapping, so some tuning is
unavoidable. The risk to guard against is calibrating constants to match Google's number; we do not.

### #1 — HRV stability plateau (well-supported in principle)

`hrvSub(z)`: at/above the normal band, the score **plateaus ~80–85** — a spike above baseline earns
**no extra credit**; below the band it drops, steeply once outside it.

- **Why:** Altini's core point — good HRV is *stable*, not *higher*; abnormally high HRV is a known
  phenomenon (parasympathetic saturation), not extra readiness.
- **Knobs (heuristic):** plateau ceiling 85, within-band slope `×8`, below-band slope `×45`.

### #2 — HRV–RHR decoupling guard (concept supported; magnitude heuristic)

If HRV is above-normal (`z>0.75`) **and** RHR is simultaneously above-normal (`z>0.75`), the HRV
sub-score is capped (`min(s, 55)`) and the reason is reframed as "strain, not recovery."

- **Why:** HRV and RHR are normally *inversely* coupled; a high-HRV reading that coincides with an
  elevated RHR (often on a short night) is typically not genuine recovery (parasympathetic
  saturation / measurement artifact). Documented mainly in endurance athletes (Plews, Buchheit,
  Stanley), so treat as a conservative sanity guard, not a precise law.
- **Knobs (heuristic):** trigger threshold `z>0.75` on both; cap value `55`.

### #3 — Weakest-link aggregation (engineering judgment — the most overfit-prone)

Final score = `0.6 × weightedMean + 0.4 × worstSubScore`. One severely under-recovered system
(e.g. RHR z≈+3.9, or a <5h night) **caps** overall readiness instead of being averaged away.

- **Why:** logical/physiological — you cannot be "ready" on 4.8h sleep regardless of HRV. **There is
  no published evidence for a specific aggregation function**, so this is the least grounded of the
  four. Flagged explicitly as a candidate for revision.
- **Knobs (heuristic):** blend split `0.6 / 0.4`.

### #4 — Acute short-sleep penalty (well-supported in direction)

`sleepSub`: duration-led (0.8) + efficiency (0.2), with a multiplicative penalty below a 5h floor
(up to −60%), so a high efficiency cannot mask a short night.

- **Why:** strong sleep-deprivation literature — acute <5–6h measurably impairs next-day function;
  need ~7–9h (NSF). Direction is solid; the threshold/curve are rounded choices.
- **Knobs (heuristic):** floor 300 min (5h), penalty slope `0.25/h`, floor multiplier `0.4`.

## Anti-overfitting stance (important)

- **Do not calibrate constants to match Google's score.** Google's number is itself a proprietary
  black box, not ground truth; "feels more realistic" ≠ correct.
- **Validate on _ordering and direction_, not absolute value:** across a user's history, does the
  worst-recovered day rank lowest? Does a genuinely recovered day (HRV up + RHR down + good sleep)
  score high? That is the test — not "does it say 25."

## Validation snapshot (2026-06-17, 7-day window)

Demonstrates correct ordering; today is the minimum and is strain-flagged:

```
06-11: 86 high   06-12: 46 fair   06-13: 81 good   06-14: 72 good
06-15: 74 good   06-16: 61 fair   06-17: 37 fair (decoupling guard fired — week minimum)
```

For reference, Google rated 06-17 as ~25 (low). Ours lands at 37 (fair, week minimum) — the
*direction* matches without fitting to the number.

## Known rough edges / future refinement

- Short-sleep nights (~5.5h) can still score "good" when HRV/RHR are strong (e.g. 06-14 → 72) —
  sleep weighting may need to bite a little harder.
- A mild single-signal dip can over-drag via the weakest-link blend (e.g. 06-12 HRV slightly low →
  46) — revisit the `0.6/0.4` split.
- Baseline cold-start: HRV scoring needs ≥3 days; `confident=false` below ~14 days. Bands may be
  jumpy early.
- Everything above is a tuning surface, deliberately. Keep changes evidence-led and re-validate on
  ordering across multiple days before committing.
