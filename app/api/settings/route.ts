import { NextResponse } from "next/server";
import { hasCredentials, isConnected, disconnect, grantedScopes, fetchAccount } from "@/lib/googlehealth";
import { hasAiKey, getStore } from "@/lib/ai-provider";
import { APP_TZ } from "@/lib/store";

const SCOPE_LABELS: { scope: string; label: string }[] = [
  { scope: "googlehealth.activity_and_fitness.readonly", label: "Read activity & fitness" },
  { scope: "googlehealth.health_metrics_and_measurements.readonly", label: "Read vitals (HR, SpO₂, HRV…)" },
  { scope: "googlehealth.sleep.readonly", label: "Read sleep" },
  { scope: "googlehealth.nutrition.readonly", label: "Read nutrition & water" },
  { scope: "googlehealth.nutrition.writeonly", label: "Write food & water logs" },
  { scope: "googlehealth.activity_and_fitness.writeonly", label: "Write workouts" },
  { scope: "googlehealth.profile.readonly", label: "Read profile" },
  { scope: "googlehealth.settings.readonly", label: "Read units & timezone" },
];

const PROVIDER_NAMES: Record<string, string> = {
  openrouter:    "OpenRouter + Cerebras",
  "openai-key":    "ChatGPT (API Key)",
  "openai-oauth":  "ChatGPT (Subscription)",
  "gemini-key":    "Gemini (API Key)",
  "anthropic-key": "Anthropic Claude",
  ollama:        "Ollama (Local)",
};

const DEFAULT_MODELS: Record<string, { model: string; visionModel: string }> = {
  openrouter:    { model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b", visionModel: process.env.OPENROUTER_VISION_MODEL || "meta-llama/llama-4-scout" },
  "openai-key":    { model: "gpt-4o",                    visionModel: "gpt-4o" },
  "openai-oauth":  { model: "o4-mini",                   visionModel: "o4-mini" },
  "gemini-key":    { model: "gemini-2.0-flash",          visionModel: "gemini-2.0-flash" },
  "anthropic-key": { model: "claude-haiku-4-5-20251001", visionModel: "claude-haiku-4-5-20251001" },
  ollama:        { model: "llama3.2",                    visionModel: "llava" },
};

export async function GET() {
  const connected = isConnected();
  let scopes: string[] = [];
  let account: { profile: any; settings: any; devices: any[] } = { profile: null, settings: null, devices: [] };

  if (connected) {
    // Both are independent live Google calls — run them concurrently so their
    // latencies overlap instead of adding up.
    const [scopesRes, accountRes] = await Promise.allSettled([grantedScopes(), fetchAccount()]);
    if (scopesRes.status === "fulfilled") scopes = scopesRes.value;
    if (accountRes.status === "fulfilled") account = accountRes.value;
  }

  const permissions = SCOPE_LABELS.map((s) => ({
    label: s.label,
    granted: scopes.some((g) => g.endsWith(s.scope)),
  }));

  const store = getStore();
  let activeProvider = "none";
  let aiModel = "—";
  let visionModel = "—";

  if (store?.active && store.providers[store.active]) {
    activeProvider = store.active;
    const entry = store.providers[store.active]!;
    const def = DEFAULT_MODELS[store.active] ?? { model: "—", visionModel: "—" };
    aiModel = entry.model || def.model;
    visionModel = entry.visionModel || def.visionModel;
  } else if (process.env.OPENROUTER_API_KEY) {
    activeProvider = "openrouter";
    aiModel = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b";
    visionModel = process.env.OPENROUTER_VISION_MODEL || "meta-llama/llama-4-scout";
  }

  return NextResponse.json({
    configured: hasCredentials(),
    connected,
    permissions,
    needsReconnect: connected && permissions.some((p) => !p.granted),
    profile: account.profile,
    settings: account.settings,
    devices: account.devices,
    aiConfigured: hasAiKey(),
    aiProviderName: PROVIDER_NAMES[activeProvider] ?? activeProvider,
    aiModel,
    visionModel,
    timezone: APP_TZ,
  });
}

export async function DELETE() {
  disconnect();
  return NextResponse.json({ ok: true });
}
