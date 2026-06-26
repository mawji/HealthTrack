// The proactive engine: gather context → run deterministic rules → apply
// guardrails (opt-in, today-only, quiet hours, daily cap, min gap, per-category
// cooldown) → rank → optionally deliver ONE nudge. AI never decides whether to
// interrupt; this file is the sole gatekeeper.

import { getPreferences } from "@/lib/proactive/preferences";
import { buildProactiveContext } from "@/lib/proactive/context";
import { RULES } from "@/lib/proactive/rules";
import { GuidanceCandidate, GuidancePriority, ProactivePreferences } from "@/lib/proactive/types";
import {
  deliveriesOn,
  lastDeliveryAt,
  lastDeliveryForKey,
  recordDelivery,
} from "@/lib/proactive/log";
import { deliverToTelegram } from "@/lib/proactive/channels/telegram";

const PRIORITY_RANK: Record<GuidancePriority, number> = { high: 0, medium: 1, low: 2 };

export interface EvaluateResult {
  enabled: boolean;
  /** Why nothing was sent (when applicable) — surfaced for the dry-run/UI. */
  suppressedReason: string | null;
  /** All candidates that passed rule + window + cooldown filters, ranked. */
  candidates: GuidanceCandidate[];
  /** The candidate chosen for delivery (top-ranked), if any. */
  chosen: GuidanceCandidate | null;
  /** True only when send was requested AND a nudge was actually delivered. */
  sent: boolean;
}

/** Is `nowMin` inside the quiet window? Handles windows that wrap midnight. */
function inQuietHours(nowMin: number, prefs: ProactivePreferences): boolean {
  const { quietStartMin: s, quietEndMin: e } = prefs;
  return s <= e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

/**
 * Evaluate the rules. With `send: false` (default) this is a pure dry-run that
 * never delivers — used by the Settings test button and the /evaluate GET.
 */
export async function evaluate(opts: { send?: boolean } = {}): Promise<EvaluateResult> {
  const prefs = getPreferences();
  const base: EvaluateResult = {
    enabled: prefs.enabled,
    suppressedReason: null,
    candidates: [],
    chosen: null,
    sent: false,
  };
  if (!prefs.enabled) return { ...base, suppressedReason: "disabled" };

  const ctx = await buildProactiveContext(prefs);
  if (!ctx.isToday) return { ...base, suppressedReason: "no live data for today" };

  // Run enabled rules whose time window contains now and that aren't on cooldown.
  const now = Date.now();
  const candidates: GuidanceCandidate[] = [];
  for (const rule of RULES) {
    if (!prefs.categories[rule.category]) continue;
    if (ctx.nowMin < rule.earliestLocalMin || ctx.nowMin > rule.latestLocalMin) continue;
    // Rules key their cooldown by category (matches the candidate's cooldownKey).
    const last = lastDeliveryForKey(rule.category);
    if (last && now - Date.parse(last.at) < rule.cooldownHours * 3_600_000) continue;
    const c = rule.evaluate(ctx);
    if (c) candidates.push(c);
  }

  candidates.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const result: EvaluateResult = { ...base, candidates };

  if (!candidates.length) return { ...result, suppressedReason: "no rule fired" };

  // Global guardrails that gate ACTUAL delivery (a dry-run still lists candidates).
  if (inQuietHours(ctx.nowMin, prefs)) return { ...result, suppressedReason: "quiet hours" };
  if (deliveriesOn(ctx.date).length >= prefs.maxPerDay) {
    return { ...result, suppressedReason: "daily cap reached" };
  }
  const lastAt = lastDeliveryAt();
  if (lastAt && now - lastAt < prefs.minGapHours * 3_600_000) {
    return { ...result, suppressedReason: "min gap not elapsed" };
  }

  const chosen = candidates[0]; // max 1 nudge per evaluation
  result.chosen = chosen;

  if (!opts.send) return result;

  const delivered = await deliverToTelegram(chosen).catch(() => false);
  if (delivered) {
    recordDelivery(chosen, ctx.date);
    result.sent = true;
  } else {
    result.suppressedReason = "telegram unavailable (configure + pair the bot)";
  }
  return result;
}
