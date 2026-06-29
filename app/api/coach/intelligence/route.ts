// Background-intelligence settings API (Phase 2): the on/off + schedule + per-tier
// method/model config, the method/model options for the pickers, and a per-tier
// connectivity test. Local single-user app, no secret gate. The tiers are
// consumed by the reflection job in Phase 3. See plans/coach-background-intelligence.md.

import { NextRequest, NextResponse } from "next/server";
import { getIntelligenceSettings, saveIntelligenceSettings, TierConfig } from "@/lib/coach/intelligence-settings";
import { providerMethods, listOllamaModels, defaultModelFor, completeWithProvider, ProviderType } from "@/lib/ai-provider";
import { getReflectionLog } from "@/lib/coach/reflection-log";

// ChatGPT-subscription models (Codex responses backend) — same list the AI tab uses.
const OPENAI_OAUTH_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

/** Model options to offer per method. Ollama is listed live; others fall back to
 *  the provider's configured/default model (the picker also allows free text). */
async function modelOptions(): Promise<{ models: Record<string, string[]>; ollamaError: string | null }> {
  const models: Record<string, string[]> = {};
  let ollamaError: string | null = null;
  for (const m of providerMethods()) {
    if (m.type === "ollama") continue;
    if (m.type === "openai-oauth") { models[m.type] = OPENAI_OAUTH_MODELS; continue; }
    const d = defaultModelFor(m.type);
    models[m.type] = d ? [d] : [];
  }
  try {
    models.ollama = await listOllamaModels();
  } catch (e: any) {
    models.ollama = [];
    ollamaError = String(e?.message ?? e);
  }
  return { models, ollamaError };
}

export async function GET() {
  const { models, ollamaError } = await modelOptions();
  return NextResponse.json({
    settings: getIntelligenceSettings(),
    methods: providerMethods(),
    models,
    ollamaError,
    log: getReflectionLog(10),
  });
}

export async function POST(req: NextRequest) {
  const action = new URL(req.url).searchParams.get("action");
  const body = await req.json().catch(() => ({}));

  // Per-tier connectivity test: a tiny round-trip through the chosen provider+model.
  if (action === "test") {
    const tier = body?.tier as TierConfig | undefined;
    if (!tier?.method || !tier?.model) return NextResponse.json({ ok: false, error: "method and model are required" }, { status: 400 });
    try {
      const text = await completeWithProvider(tier.method as ProviderType, tier.model, [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: "ping" },
      ]);
      return NextResponse.json({ ok: true, sample: (text || "").trim().slice(0, 80) });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({ settings: saveIntelligenceSettings(body) });
}
