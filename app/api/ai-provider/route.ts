import { NextRequest, NextResponse } from "next/server";
import {
  ProviderType,
  getStore,
  saveProvider,
  removeProvider,
  setActive,
  setRole,
  getRoles,
  PROVIDER_LABELS,
} from "@/lib/ai-provider";

const DEFAULT_MODELS: Record<ProviderType, { model: string; visionModel: string }> = {
  openrouter:    { model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b", visionModel: process.env.OPENROUTER_VISION_MODEL || "meta-llama/llama-4-scout" },
  "openai-key":    { model: "gpt-4o",                    visionModel: "gpt-4o" },
  "openai-oauth":  { model: "gpt-5.5",                   visionModel: "gpt-5.5" },
  "gemini-key":    { model: "gemini-2.0-flash",          visionModel: "gemini-2.0-flash" },
  "anthropic-key": { model: "claude-haiku-4-5-20251001", visionModel: "claude-haiku-4-5-20251001" },
  ollama:        { model: "llama3.2",                    visionModel: "llava" },
};

const ALL: ProviderType[] = [
  "openrouter", "openai-key", "openai-oauth", "gemini-key", "anthropic-key", "ollama",
];

export async function GET() {
  const store = getStore();
  const envOrConfigured = Boolean(process.env.OPENROUTER_API_KEY);

  const providers = Object.fromEntries(
    ALL.map((p) => {
      const entry = store?.providers[p];
      const def = DEFAULT_MODELS[p];

      let configured = false;
      if      (p === "openrouter")   configured = Boolean(entry?.apiKey) || envOrConfigured;
      else if (p === "ollama")       configured = Boolean(entry?.baseUrl || (entry && Object.keys(entry).length > 0));
      else if (p === "openai-oauth") configured = Boolean(entry?.accessToken);
      else                           configured = Boolean(entry?.apiKey);

      return [p, {
        label: PROVIDER_LABELS[p],
        configured,
        model:       entry?.model        || def.model,
        visionModel: entry?.visionModel  || def.visionModel,
        ...(p === "ollama"     ? { baseUrl: entry?.baseUrl || "http://localhost:11434" } : {}),
        ...(p === "openrouter" && envOrConfigured && !entry?.apiKey ? { fromEnv: true } : {}),
      }];
    })
  );

  const { primary, secondary } = getRoles();
  // `active` mirrors the primary for back-compat with any older callers.
  const active: string = primary ?? (envOrConfigured ? "openrouter" : "none");

  return NextResponse.json({ active, primary: primary ?? null, secondary: secondary ?? null, providers });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, provider, apiKey, baseUrl, model, visionModel } = body as {
    action?: string;
    provider?: ProviderType;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    visionModel?: string;
  };

  if (action === "activate" && provider) {
    const store = getStore();
    if (!store?.providers[provider] && provider !== "openrouter") {
      return NextResponse.json({ error: "Provider not configured" }, { status: 400 });
    }
    setActive(provider);
    return NextResponse.json({ ok: true });
  }

  if (action === "setRole") {
    const role = (body as { role?: string }).role;
    if (role !== "primary" && role !== "secondary") {
      return NextResponse.json({ error: "role must be 'primary' or 'secondary'" }, { status: 400 });
    }
    // provider may be null/omitted to clear the secondary slot.
    if (provider) {
      const store = getStore();
      const configured = Boolean(store?.providers[provider]) || (provider === "openrouter" && Boolean(process.env.OPENROUTER_API_KEY));
      if (!configured) {
        return NextResponse.json({ error: "Provider not configured" }, { status: 400 });
      }
    } else if (role === "primary") {
      return NextResponse.json({ error: "primary requires a provider" }, { status: 400 });
    }
    setRole(role, provider ?? null);
    return NextResponse.json({ ok: true });
  }

  if (action === "save" && provider) {
    const entry: Record<string, any> = {};
    if (apiKey)      entry.apiKey = apiKey.trim();
    if (baseUrl)     entry.baseUrl = baseUrl.trim();
    if (model)       entry.model = model.trim();
    if (visionModel) entry.visionModel = visionModel.trim();

    if (!Object.keys(entry).length) {
      return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }
    saveProvider(provider, entry, true);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") as ProviderType | null;
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });
  removeProvider(provider);
  return NextResponse.json({ ok: true });
}
