// Settings for the background-intelligence system — deliberately separate from
// the coach's primary/secondary chat models. Phase 1 only needs the on/off gate
// for scheduled runs and the quiet-hour to run at; the per-tier model method +
// model pickers (Ollama / ChatGPT OAuth / existing provider) land in Phase 2.
// See plans/coach-background-intelligence.md.

import { readJson, writeJson } from "@/lib/store";
import { ProviderType } from "@/lib/ai-provider";

const FILE = "coach-intelligence.json";

/** A background tier points at a provider method + a specific model. `method`
 *  reuses the existing AI-provider types (ollama, openai-oauth, openrouter, …)
 *  so the picker is "method + model" over the user's already-configured
 *  providers — distinct from the coach's primary/secondary models. */
export interface TierConfig {
  method: ProviderType;
  model: string;
}

/** How readily the reflection forms memories — tunes the prompt + the add cap. */
export type Aggressiveness = "conservative" | "balanced" | "eager";
const AGGRESSIVENESS: Aggressiveness[] = ["conservative", "balanced", "eager"];

export interface CoachIntelligenceSettings {
  /** Master gate for SCHEDULED background runs. Manual "run now" always works.
   *  Default off — the user opts in. */
  enabled: boolean;
  /** Local hour (0-23, APP_TZ) the nightly reflection runs at. */
  scheduleHour: number;
  /** Cheap/local first-stab model (Phase 3 consumer). Null = no model tier yet. */
  tier1: TierConfig | null;
  /** Refiner model (Phase 3 consumer). Null = reuse tier1 / skip refine. */
  tier2: TierConfig | null;
  /** How freely the model records memories. Default balanced. */
  aggressiveness: Aggressiveness;
}

const DEFAULTS: CoachIntelligenceSettings = {
  enabled: false,
  scheduleHour: 3,
  tier1: null,
  tier2: null,
  aggressiveness: "balanced",
};

const PROVIDER_TYPES: ProviderType[] = [
  "openrouter", "openai-key", "openai-oauth", "gemini-key", "anthropic-key", "ollama",
];

function coerceTier(v: unknown): TierConfig | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const method = PROVIDER_TYPES.includes(r.method as ProviderType) ? (r.method as ProviderType) : null;
  const model = typeof r.model === "string" ? r.model.trim().slice(0, 120) : "";
  if (!method || !model) return null;
  return { method, model };
}

export function getIntelligenceSettings(): CoachIntelligenceSettings {
  const raw = readJson<Partial<CoachIntelligenceSettings>>(FILE, {});
  const hour = Number(raw.scheduleHour);
  return {
    enabled: raw.enabled === true,
    scheduleHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULTS.scheduleHour,
    tier1: coerceTier(raw.tier1),
    tier2: coerceTier(raw.tier2),
    aggressiveness: AGGRESSIVENESS.includes(raw.aggressiveness as Aggressiveness) ? (raw.aggressiveness as Aggressiveness) : DEFAULTS.aggressiveness,
  };
}

export function saveIntelligenceSettings(patch: Partial<CoachIntelligenceSettings>): CoachIntelligenceSettings {
  const cur = getIntelligenceSettings();
  const next: CoachIntelligenceSettings = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    scheduleHour:
      Number.isInteger(patch.scheduleHour) && (patch.scheduleHour as number) >= 0 && (patch.scheduleHour as number) <= 23
        ? (patch.scheduleHour as number)
        : cur.scheduleHour,
    tier1: "tier1" in patch ? coerceTier(patch.tier1) : cur.tier1,
    tier2: "tier2" in patch ? coerceTier(patch.tier2) : cur.tier2,
    aggressiveness: AGGRESSIVENESS.includes(patch.aggressiveness as Aggressiveness) ? (patch.aggressiveness as Aggressiveness) : cur.aggressiveness,
  };
  writeJson(FILE, next);
  return next;
}
