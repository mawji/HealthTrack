/**
 * Unified AI provider abstraction.
 *
 * Providers:
 *   openrouter   – OpenRouter (text via Cerebras, vision via any)
 *   openai-key   – OpenAI API key → api.openai.com (gpt-4o, vision)
 *   openai-oauth – ChatGPT subscription via device code, no API key needed.
 *                  Uses OpenAI's public Codex CLI client ID and their
 *                  chatgpt.com/backend-api/codex/responses endpoint
 *                  (Responses API format, billed to the user's ChatGPT plan).
 *   gemini-key   – Google Gemini API key → generativelanguage.googleapis.com
 *   anthropic-key– Anthropic API key → api.anthropic.com
 *   ollama       – Local Ollama instance (OpenAI-compatible /v1 endpoint)
 *
 * Active provider is persisted in data/ai-provider.json.
 * Falls back to OPENROUTER_API_KEY env var when no stored config exists.
 */

import crypto from "crypto";
import { readJson, writeJson } from "./store";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderType =
  | "openrouter"
  | "openai-key"
  | "openai-oauth"
  | "gemini-key"
  | "anthropic-key"
  | "ollama";

export interface ProviderEntry {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;   // openai-oauth: ChatGPT-Account-Id header value (JWT sub)
  model?: string;
  visionModel?: string;
  baseUrl?: string;     // Ollama base URL
}

export interface ProviderStore {
  active: ProviderType;          // legacy single-provider field; read as the primary
  primary?: ProviderType;        // preferred provider
  secondary?: ProviderType;      // fallback used when the primary call throws
  providers: Partial<Record<ProviderType, ProviderEntry>>;
}

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  openrouter:      "OpenRouter + Cerebras",
  "openai-key":    "ChatGPT (API Key)",
  "openai-oauth":  "ChatGPT (Subscription)",
  "gemini-key":    "Gemini (API Key)",
  "anthropic-key": "Anthropic Claude",
  ollama:          "Ollama (Local)",
};

type Msg = { role: "system" | "user" | "assistant"; content: any };

const STORE_FILE = "ai-provider.json";

const DEFAULTS: Record<ProviderType, { model: string; visionModel: string }> = {
  openrouter: {
    model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b",
    visionModel: process.env.OPENROUTER_VISION_MODEL || "meta-llama/llama-4-scout",
  },
  "openai-key":    { model: "gpt-4o",                    visionModel: "gpt-4o" },
  "openai-oauth":  { model: "gpt-5.5",                   visionModel: "gpt-5.5" },
  "gemini-key":    { model: "gemini-2.0-flash",          visionModel: "gemini-2.0-flash" },
  "anthropic-key": { model: "claude-haiku-4-5-20251001", visionModel: "claude-haiku-4-5-20251001" },
  ollama:          { model: "llama3.2",                  visionModel: "llava" },
};

// ── Config management ─────────────────────────────────────────────────────────

export function getStore(): ProviderStore | null {
  return readJson<ProviderStore | null>(STORE_FILE, null);
}

function saveStore(store: ProviderStore) {
  writeJson(STORE_FILE, store);
}

export function setActive(provider: ProviderType) {
  setRole("primary", provider);
}

/** Assign a provider to the primary or secondary (fallback) slot. */
export function setRole(role: "primary" | "secondary", provider: ProviderType | null) {
  const store = getStore() ?? { active: provider ?? "openrouter", providers: {} };
  if (role === "primary") {
    store.primary = provider ?? undefined;
    if (provider) store.active = provider; // keep legacy field in sync
    // Primary can't also be the fallback.
    if (provider && store.secondary === provider) store.secondary = undefined;
  } else {
    store.secondary = provider && provider !== store.primary ? provider : undefined;
  }
  saveStore(store);
}

export function getRoles(): { primary: ProviderType | null; secondary: ProviderType | null } {
  const store = getStore();
  if (!store) {
    return { primary: process.env.OPENROUTER_API_KEY ? "openrouter" : null, secondary: null };
  }
  const primary = store.primary ?? store.active ?? null;
  const secondary = store.secondary && store.secondary !== primary ? store.secondary : null;
  return { primary, secondary };
}

export function saveProvider(provider: ProviderType, entry: ProviderEntry, activate = true) {
  const store = getStore() ?? { active: provider, providers: {} };
  store.providers[provider] = { ...(store.providers[provider] ?? {}), ...entry };
  if (activate) {
    store.active = provider;
    // First provider configured becomes primary automatically; don't steal the
    // slot from an existing primary (roles are assigned explicitly thereafter).
    if (!store.primary) store.primary = provider;
  }
  saveStore(store);
}

export function removeProvider(provider: ProviderType) {
  const store = getStore();
  if (!store) return;
  delete store.providers[provider];
  if (store.secondary === provider) store.secondary = undefined;
  if (store.primary === provider) store.primary = undefined;
  if (store.active === provider) {
    store.active = (store.primary ?? (Object.keys(store.providers)[0] as ProviderType)) ?? "openrouter";
  }
  if (!store.primary) store.primary = store.active;
  saveStore(store);
}

/** Resolve a configured provider's entry, treating env-keyed OpenRouter as configured. */
function entryFor(store: ProviderStore, p: ProviderType): ProviderEntry | null {
  const e = store.providers[p];
  if (e) return e;
  if (p === "openrouter" && process.env.OPENROUTER_API_KEY) return {};
  return null;
}

/** Ordered, deduped, configured-only list of providers to try: [primary, secondary]. */
function resolveOrder(): { type: ProviderType; entry: ProviderEntry }[] {
  const store = getStore();
  if (!store) return [];
  const { primary, secondary } = getRoles();
  const out: { type: ProviderType; entry: ProviderEntry }[] = [];
  for (const p of [primary, secondary]) {
    if (!p || out.some((o) => o.type === p)) continue;
    const entry = entryFor(store, p);
    if (entry) out.push({ type: p, entry });
  }
  return out;
}

function getActive(): { type: ProviderType; entry: ProviderEntry } | null {
  return resolveOrder()[0] ?? null;
}

// ── Public interface ──────────────────────────────────────────────────────────

export function hasAiKey(): boolean {
  const active = getActive();
  if (active) {
    const { type, entry } = active;
    switch (type) {
      case "ollama":        return true;
      case "openrouter":    return Boolean(entry.apiKey || process.env.OPENROUTER_API_KEY);
      case "openai-key":
      case "gemini-key":
      case "anthropic-key": return Boolean(entry.apiKey);
      case "openai-oauth":  return Boolean(entry.accessToken);
    }
  }
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** Result of a fallback-aware call: what was produced and which slot served it. */
export interface FallbackMeta {
  usedSecondary: boolean;     // true when the primary threw and the secondary served
  servedLabel: string;        // human label of the provider that produced the result
}

// ── Single-provider dispatch (no fallback) ────────────────────────────────────

async function callProvider(
  type: ProviderType, entry: ProviderEntry, messages: Msg[],
  opts: { vision?: boolean; json?: boolean }
): Promise<string> {
  const def = DEFAULTS[type];
  const model = opts.vision ? (entry.visionModel || def.visionModel) : (entry.model || def.model);

  switch (type) {
    case "openrouter": {
      const key = entry.apiKey || process.env.OPENROUTER_API_KEY || "";
      return callOpenAiCompat(
        "https://openrouter.ai/api/v1", key, model, messages,
        { ...opts, extra: orProviderExtras(opts.vision) }
      );
    }
    case "openai-key":
      return callOpenAiCompat("https://api.openai.com/v1", entry.apiKey!, model, messages, opts);
    case "openai-oauth": {
      const e = await maybeRefreshOpenAi(entry);
      return callChatGptCodex(e, model, messages);
    }
    case "gemini-key":
      return callGemini(entry, model, messages, opts);
    case "anthropic-key":
      return callAnthropic(entry.apiKey!, model, messages, opts);
    case "ollama": {
      const base = (entry.baseUrl || "http://localhost:11434").replace(/\/$/, "");
      return callOpenAiCompat(`${base}/v1`, "", model, messages, opts);
    }
  }
}

async function streamProvider(
  type: ProviderType, entry: ProviderEntry, messages: Msg[]
): Promise<ReadableStream<Uint8Array>> {
  const def = DEFAULTS[type];
  const model = entry.model || def.model;

  switch (type) {
    case "openrouter": {
      const key = entry.apiKey || process.env.OPENROUTER_API_KEY || "";
      return streamOpenAiCompat(
        "https://openrouter.ai/api/v1", key, model, messages, orProviderExtras(false)
      );
    }
    case "openai-key":
      return streamOpenAiCompat("https://api.openai.com/v1", entry.apiKey!, model, messages);
    case "openai-oauth": {
      const e = await maybeRefreshOpenAi(entry);
      return streamChatGptCodex(e, model, messages);
    }
    case "gemini-key":
      return streamGemini(entry, model, messages);
    case "anthropic-key":
      return streamAnthropic(entry.apiKey!, model, messages);
    case "ollama": {
      const base = (entry.baseUrl || "http://localhost:11434").replace(/\/$/, "");
      return streamOpenAiCompat(`${base}/v1`, "", model, messages);
    }
  }
}

// ── Fallback-aware public interface ───────────────────────────────────────────

/**
 * Complete, walking [primary, secondary]: on ANY throw from the primary, retry
 * on the secondary. Returns the text plus which slot served it.
 */
export async function completeWithFallback(
  messages: Msg[], opts: { vision?: boolean; json?: boolean } = {}
): Promise<{ text: string } & FallbackMeta> {
  const order = resolveOrder();
  if (order.length === 0) {
    return { text: await legacyOrComplete(messages, opts), usedSecondary: false, servedLabel: PROVIDER_LABELS.openrouter };
  }
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    try {
      const text = await callProvider(order[i].type, order[i].entry, messages, opts);
      return { text, usedSecondary: i > 0, servedLabel: PROVIDER_LABELS[order[i].type] };
    } catch (e) {
      lastErr = e;
      if (i < order.length - 1) console.warn(`AI primary (${order[i].type}) failed, falling back:`, e);
    }
  }
  throw lastErr;
}

/**
 * Open a completion stream, walking [primary, secondary]. Because the stream is
 * awaited before the first byte, connection-time failures (auth/429/5xx/network)
 * throw here and switch cleanly to the secondary (pre-stream fallback).
 */
export async function streamWithFallback(
  messages: Msg[]
): Promise<{ stream: ReadableStream<Uint8Array> } & FallbackMeta> {
  const order = resolveOrder();
  if (order.length === 0) {
    return { stream: await legacyOrStream(messages), usedSecondary: false, servedLabel: PROVIDER_LABELS.openrouter };
  }
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    try {
      const stream = await streamProvider(order[i].type, order[i].entry, messages);
      return { stream, usedSecondary: i > 0, servedLabel: PROVIDER_LABELS[order[i].type] };
    } catch (e) {
      lastErr = e;
      if (i < order.length - 1) console.warn(`AI primary (${order[i].type}) stream failed, falling back:`, e);
    }
  }
  throw lastErr;
}

// Back-compat thin wrappers — existing callers keep working and get fallback for free.
export async function complete(
  messages: Msg[], opts: { vision?: boolean; json?: boolean } = {}
): Promise<string> {
  return (await completeWithFallback(messages, opts)).text;
}

export async function streamCompletion(messages: Msg[]): Promise<ReadableStream<Uint8Array>> {
  return (await streamWithFallback(messages)).stream;
}

export function parseJsonReply<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in model reply");
  let raw = match[0];
  raw = raw.replace(/"([^"\\]|\\.)*"/g, (t) =>
    t.replace(/\n/g, "\\n").replace(/\r/g, "\\r")
  );
  return JSON.parse(raw) as T;
}

// ── Background-intelligence helpers (Phase 2) ─────────────────────────────────
//
// The background reflection picks its own provider+model PER TIER, independent of
// the coach's primary/secondary roles. These reuse the same provider entries
// (api keys / baseUrl / oauth tokens) already configured in data/ai-provider.json
// — only the model is overridden. See plans/coach-background-intelligence.md.

/** Methods the user can point a background tier at, with whether each is
 *  configured. Ollama is always selectable (local, no credentials needed). */
export function providerMethods(): { type: ProviderType; label: string; configured: boolean }[] {
  const store = getStore();
  return (Object.keys(PROVIDER_LABELS) as ProviderType[]).map((type) => ({
    type,
    label: PROVIDER_LABELS[type],
    configured: type === "ollama" ? true : !!(store && entryFor(store, type)),
  }));
}

/** List models installed on the local Ollama instance (its /api/tags). */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const store = getStore();
  const base = (baseUrl || store?.providers.ollama?.baseUrl || "http://localhost:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama not reachable at ${base} (${res.status})`);
  const j = await res.json();
  return (j.models ?? []).map((m: any) => m?.name).filter((n: any): n is string => typeof n === "string");
}

/** The default model id for a method (shown as a fallback option in the picker). */
export function defaultModelFor(method: ProviderType): string {
  const store = getStore();
  return store?.providers[method]?.model || DEFAULTS[method].model;
}

/**
 * Complete using a specific method + model, bypassing the primary/secondary
 * roles. Resolves the provider's stored entry (keys/baseUrl/tokens) and overrides
 * only the model. Throws if the chosen method isn't configured.
 */
export async function completeWithProvider(
  method: ProviderType,
  model: string,
  messages: Msg[],
  opts: { vision?: boolean; json?: boolean } = {}
): Promise<string> {
  const store = getStore();
  let entry = store ? entryFor(store, method) : null;
  if (!entry) {
    if (method === "ollama") entry = {}; // default localhost base URL
    else throw new Error(`${PROVIDER_LABELS[method]} is not configured`);
  }
  const withModel: ProviderEntry = { ...entry, model: model || entry.model, visionModel: model || entry.visionModel };
  return callProvider(method, withModel, messages, opts);
}

// ── OpenAI ChatGPT — device code flow ─────────────────────────────────────────
//
// No client secret required. Uses OpenAI's public Codex CLI client ID.
// Sources: github.com/7shi/codex-oauth, github.com/tumf/opencode-openai-device-auth,
//          github.com/zed-industries/zed/pull/56811

const OAI_CLIENT_ID    = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAI_DEVICE_URL   = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const OAI_POLL_URL     = "https://auth.openai.com/api/accounts/deviceauth/token";
const OAI_TOKEN_URL    = "https://auth.openai.com/oauth/token";
const OAI_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
const OAI_VERIFY_URL   = "https://auth.openai.com/codex/device";
const OAI_CODEX_API    = "https://chatgpt.com/backend-api/codex/responses";

export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Step 1: request a device code from OpenAI. */
export async function startOpenAiDeviceCode(): Promise<DeviceCodeResult> {
  const res = await fetch(OAI_DEVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: OAI_CLIENT_ID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Device code request failed (${res.status}): ${body}`);
  }
  const d = await res.json();
  // OpenAI's deviceauth contract is NOT RFC 8628: the device identifier comes
  // back as `device_auth_id`, and the user code field name varies.
  return {
    deviceCode:      d.device_auth_id,
    userCode:        d.user_code ?? d.usercode,
    verificationUri: d.verification_uri || OAI_VERIFY_URL,
    expiresIn:       d.expires_in ?? 900,
    interval:        d.interval   ?? 5,
  };
}

export type DevicePollResult =
  | { status: "authorized" }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "error"; error: string };

/**
 * Step 2: poll until the user authorizes on the browser page.
 *
 * The deviceauth/token endpoint replies 403/404 while pending and 200 with an
 * `authorization_code` once approved — it never returns the access token here.
 * On approval we run the PKCE-style code exchange (Step 3) to get the tokens.
 */
export async function pollOpenAiDeviceCode(
  deviceCode: string,
  userCode: string,
): Promise<DevicePollResult> {
  const res = await fetch(OAI_POLL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceCode, user_code: userCode }),
  });

  // Still waiting on the user to approve in the browser.
  if (res.status === 403 || res.status === 404) return { status: "pending" };
  if (res.status === 429)                        return { status: "slow_down" };
  if (!res.ok) {
    return { status: "error", error: `Poll failed (${res.status}): ${await res.text()}` };
  }

  const d = await res.json();
  if (!d.authorization_code) return { status: "pending" };

  // Step 3: exchange the authorization code for real tokens.
  const t = await exchangeOpenAiCode(d.authorization_code, d.code_verifier);
  if (!t.access_token) {
    return { status: "error", error: "Token exchange returned no access_token" };
  }

  const accountId = jwtSub(t.access_token);
  saveProvider("openai-oauth", {
    accessToken:  t.access_token,
    refreshToken: t.refresh_token,
    expiresAt:    t.expires_in ? Date.now() + (t.expires_in - 60) * 1000 : undefined,
    accountId,
    model:        "gpt-5.5",
    visionModel:  "gpt-5.5",
  });
  return { status: "authorized" };
}

/** Step 3: trade the approved authorization_code for access/refresh tokens. */
async function exchangeOpenAiCode(code: string, codeVerifier: string): Promise<any> {
  const res = await fetch(OAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     OAI_CLIENT_ID,
      code,
      code_verifier: codeVerifier ?? "",
      redirect_uri:  OAI_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

function jwtSub(token: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    return payload.sub as string | undefined;
  } catch {
    return undefined;
  }
}

async function maybeRefreshOpenAi(entry: ProviderEntry): Promise<ProviderEntry> {
  if (!entry.expiresAt || entry.expiresAt > Date.now()) return entry;
  if (!entry.refreshToken) return entry;
  try {
    const res = await fetch(OAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     OAI_CLIENT_ID,
        grant_type:    "refresh_token",
        refresh_token: entry.refreshToken,
      }),
    });
    if (!res.ok) return entry;
    const t = await res.json();
    const updated: ProviderEntry = {
      ...entry,
      accessToken: t.access_token,
      expiresAt: t.expires_in ? Date.now() + (t.expires_in - 60) * 1000 : entry.expiresAt,
    };
    saveProvider("openai-oauth", updated, false);
    return updated;
  } catch {
    return entry;
  }
}

// ── ChatGPT Codex backend (Responses API) ─────────────────────────────────────

function toResponsesBody(model: string, messages: Msg[], stream: boolean): any {
  const sys  = messages.find((m) => m.role === "system");
  const chat = messages.filter((m) => m.role !== "system");
  const body: any = {
    model,
    store: false,
    stream,
    input: chat.map((m) => ({
      role: m.role as "user" | "assistant",
      content: Array.isArray(m.content)
        ? m.content.map((c: any) => {
            if (c.type === "text") return { type: "input_text", text: c.text };
            // Responses API takes the data URL directly as image_url (string),
            // not an Anthropic-style { source: { type:"base64", ... } } object.
            if (c.type === "image_url") return { type: "input_image", image_url: c.image_url.url };
            return { type: "input_text", text: JSON.stringify(c) };
          })
        : String(m.content),
    })),
  };
  // The Codex responses backend rejects requests without `instructions`
  // ("Instructions are required"), so always send a non-empty value.
  body.instructions = sys ? String(sys.content) : "You are a helpful assistant.";
  return body;
}

function codexHeaders(entry: ProviderEntry): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${entry.accessToken}`,
    "OpenAI-Beta":   "responses=experimental",
    "Originator":    "healthtrack",
  };
  if (entry.accountId) h["ChatGPT-Account-Id"] = entry.accountId;
  return h;
}

async function callChatGptCodex(entry: ProviderEntry, model: string, messages: Msg[]): Promise<string> {
  // The Codex backend rejects non-streaming requests ("Stream must be set to
  // true"), so even for a one-shot completion we stream and accumulate deltas.
  const body = toResponsesBody(model, messages, true);
  let res = await fetch(OAI_CODEX_API, { method: "POST", headers: codexHeaders(entry), body: JSON.stringify(body) });
  if (res.status === 429 || res.status >= 500) {
    await sleep(1200);
    res = await fetch(OAI_CODEX_API, { method: "POST", headers: codexHeaders(entry), body: JSON.stringify(body) });
  }
  if (!res.ok || !res.body) throw new Error(`ChatGPT OAuth error: ${await res.text()}`);

  // Drain the SSE stream, concatenating response.output_text.delta events.
  const dec = new TextDecoder();
  let buf = "", out = "";
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try {
        const j = JSON.parse(t.slice(5).trim());
        if (j.type === "response.output_text.delta") out += j.delta ?? "";
      } catch { /* keepalive / non-JSON line */ }
    }
  }
  return out;
}

async function streamChatGptCodex(entry: ProviderEntry, model: string, messages: Msg[]): Promise<ReadableStream<Uint8Array>> {
  const body = toResponsesBody(model, messages, true);
  const res = await fetch(OAI_CODEX_API, { method: "POST", headers: codexHeaders(entry), body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`ChatGPT OAuth stream error: ${res.status} ${await res.text()}`);
  return sseToTextStream(res.body, (data) => {
    try {
      const j = JSON.parse(data);
      // Responses API streaming event: response.output_text.delta
      if (j.type === "response.output_text.delta") return j.delta ?? null;
      return null;
    } catch { return null; }
  });
}

// ── OpenRouter-specific extras ────────────────────────────────────────────────

function orProviderExtras(vision?: boolean): Record<string, any> {
  const p = process.env.OPENROUTER_PROVIDER?.trim().toLowerCase();
  if (p && !vision) {
    return { provider: { order: [p], allow_fallbacks: true }, reasoning: { effort: "low" } };
  }
  return {};
}

// ── OpenAI-compatible (OpenRouter, OpenAI key, Ollama) ────────────────────────

function openAiHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  h["HTTP-Referer"] = process.env.APP_BASE_URL || "http://localhost:3210";
  h["X-Title"] = "HealthTrack";
  return h;
}

async function callOpenAiCompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Msg[],
  opts: { json?: boolean; extra?: Record<string, any> } = {}
): Promise<string> {
  const body: any = { model, messages, ...(opts.extra ?? {}) };
  if (opts.json) body.response_format = { type: "json_object" };
  const url = `${baseUrl}/chat/completions`;
  let res = await fetch(url, { method: "POST", headers: openAiHeaders(apiKey), body: JSON.stringify(body) });
  if (res.status === 429 || res.status >= 500) {
    await sleep(1200);
    res = await fetch(url, { method: "POST", headers: openAiHeaders(apiKey), body: JSON.stringify(body) });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`AI error: ${JSON.stringify(json)}`);
  return json.choices?.[0]?.message?.content ?? "";
}

async function streamOpenAiCompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Msg[],
  extra: Record<string, any> = {}
): Promise<ReadableStream<Uint8Array>> {
  const body = { model, messages, stream: true, ...extra };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: openAiHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`AI stream error: ${res.status} ${await res.text()}`);
  return sseToTextStream(res.body, (data) => {
    if (data === "[DONE]") return null;
    try { return JSON.parse(data).choices?.[0]?.delta?.content ?? null; } catch { return null; }
  });
}

// ── Gemini ────────────────────────────────────────────────────────────────────

function geminiEndpoint(model: string, apiKey: string, stream: boolean) {
  const action = stream ? "streamGenerateContent" : "generateContent";
  const qs = stream ? `?key=${apiKey}&alt=sse` : `?key=${apiKey}`;
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}${qs}`;
}

function toGeminiBody(messages: Msg[], opts: { json?: boolean } = {}) {
  const sys  = messages.find((m) => m.role === "system");
  const chat = messages.filter((m) => m.role !== "system");
  return {
    ...(sys ? { systemInstruction: { parts: [{ text: String(sys.content) }] } } : {}),
    contents: chat.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: Array.isArray(m.content)
        ? m.content.map((c: any) => {
            if (c.type === "text") return { text: c.text };
            if (c.type === "image_url") {
              const { mime, b64 } = splitDataUrl(c.image_url.url);
              return { inlineData: { mimeType: mime, data: b64 } };
            }
            return { text: JSON.stringify(c) };
          })
        : [{ text: String(m.content) }],
    })),
    ...(opts.json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
  };
}

async function callGemini(
  entry: ProviderEntry, model: string, messages: Msg[], opts: { json?: boolean } = {}
): Promise<string> {
  const url = geminiEndpoint(model, entry.apiKey!, false);
  let res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toGeminiBody(messages, opts)) });
  if (res.status === 429 || res.status >= 500) {
    await sleep(1200);
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toGeminiBody(messages, opts)) });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`Gemini error: ${JSON.stringify(json)}`);
  return (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
}

async function streamGemini(
  entry: ProviderEntry, model: string, messages: Msg[]
): Promise<ReadableStream<Uint8Array>> {
  const url = geminiEndpoint(model, entry.apiKey!, true);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toGeminiBody(messages)) });
  if (!res.ok || !res.body) throw new Error(`Gemini stream error: ${res.status} ${await res.text()}`);
  return sseToTextStream(res.body, (data) => {
    try {
      const json = JSON.parse(data);
      return (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("") || null;
    } catch { return null; }
  });
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

function anthropicHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

function toAnthropicBody(model: string, messages: Msg[], stream: boolean) {
  const sys  = messages.find((m) => m.role === "system");
  const chat = messages.filter((m) => m.role !== "system");
  return {
    model,
    max_tokens: 4096,
    stream,
    ...(sys ? { system: String(sys.content) } : {}),
    messages: chat.map((m) => ({
      role: m.role as "user" | "assistant",
      content: Array.isArray(m.content)
        ? m.content.map((c: any) => {
            if (c.type === "text") return { type: "text", text: c.text };
            if (c.type === "image_url") {
              const { mime, b64 } = splitDataUrl(c.image_url.url);
              return { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
            }
            return { type: "text", text: JSON.stringify(c) };
          })
        : String(m.content),
    })),
  };
}

async function callAnthropic(
  apiKey: string, model: string, messages: Msg[], _opts: { json?: boolean } = {}
): Promise<string> {
  const body = toAnthropicBody(model, messages, false);
  let res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: anthropicHeaders(apiKey), body: JSON.stringify(body) });
  if (res.status === 429 || res.status >= 500) {
    await sleep(1200);
    res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: anthropicHeaders(apiKey), body: JSON.stringify(body) });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`Anthropic error: ${JSON.stringify(json)}`);
  return (json.content ?? []).map((c: any) => c.text ?? "").join("");
}

async function streamAnthropic(
  apiKey: string, model: string, messages: Msg[]
): Promise<ReadableStream<Uint8Array>> {
  const body = toAnthropicBody(model, messages, true);
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: anthropicHeaders(apiKey), body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`Anthropic stream error: ${res.status} ${await res.text()}`);
  return sseToTextStream(res.body, (data) => {
    try {
      const j = JSON.parse(data);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") return j.delta.text ?? null;
      return null;
    } catch { return null; }
  });
}

// ── SSE → text stream ─────────────────────────────────────────────────────────

function sseToTextStream(
  body: ReadableStream<Uint8Array>,
  extract: (data: string) => string | null
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); break; }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        let sent = false;
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          const text = extract(payload);
          if (text) { controller.enqueue(enc.encode(text)); sent = true; }
        }
        if (sent) break;
      }
    },
    cancel() { reader.cancel(); },
  });
}

// ── Legacy OpenRouter env-var fallback ────────────────────────────────────────

function legacyOrHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "HTTP-Referer": process.env.APP_BASE_URL || "http://localhost:3210",
    "X-Title": "HealthTrack",
  };
}

async function legacyOrComplete(
  messages: Msg[],
  opts: { vision?: boolean; json?: boolean } = {}
): Promise<string> {
  const model = opts.vision
    ? process.env.OPENROUTER_VISION_MODEL || "meta-llama/llama-4-scout"
    : process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b";
  const body: any = { model, messages, ...orProviderExtras(opts.vision) };
  if (opts.json) body.response_format = { type: "json_object" };
  const url = "https://openrouter.ai/api/v1/chat/completions";
  let res = await fetch(url, { method: "POST", headers: legacyOrHeaders(), body: JSON.stringify(body) });
  if (res.status === 429 || res.status >= 500) {
    await sleep(1200);
    res = await fetch(url, { method: "POST", headers: legacyOrHeaders(), body: JSON.stringify(body) });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenRouter error: ${JSON.stringify(json)}`);
  return json.choices?.[0]?.message?.content ?? "";
}

async function legacyOrStream(messages: Msg[]): Promise<ReadableStream<Uint8Array>> {
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b";
  const body = { model, messages, stream: true, ...orProviderExtras(false) };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: legacyOrHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`OpenRouter stream error: ${res.status} ${await res.text()}`);
  return sseToTextStream(res.body, (data) => {
    if (data === "[DONE]") return null;
    try { return JSON.parse(data).choices?.[0]?.delta?.content ?? null; } catch { return null; }
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function splitDataUrl(dataUrl: string): { mime: string; b64: string } {
  const [header, b64] = dataUrl.split(",");
  const mime = header.split(":")[1].split(";")[0];
  return { mime, b64 };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
