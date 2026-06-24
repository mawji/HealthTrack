"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { IconChip, HeartIcon, ScaleIcon, LungsIcon } from "@/components/icons";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettingsPayload {
  configured: boolean;
  connected: boolean;
  permissions: { label: string; granted: boolean }[];
  needsReconnect: boolean;
  profile: any;
  settings: any;
  devices: any[];
  aiConfigured: boolean;
  aiProviderName: string;
  aiModel: string;
  visionModel: string;
  timezone: string;
}

interface ProviderInfo {
  label: string;
  configured: boolean;
  model: string;
  visionModel: string;
  baseUrl?: string;
  fromEnv?: boolean;
}

interface AiPayload {
  active: string;
  primary: string | null;
  secondary: string | null;
  providers: Record<string, ProviderInfo>;
}

interface ArchiveStatus {
  connected: boolean;
  coverage: { days: number; oldest: string | null; newest: string | null };
  backfill: { target: string; cursor: string; pct: number | null } | null;
}

type ProviderType =
  | "openrouter" | "openai-key" | "openai-oauth"
  | "gemini-key" | "anthropic-key" | "ollama";

interface DeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
}

// Models available on a ChatGPT subscription via the Codex responses backend.
// All three handle text + vision, so one selection drives both.
const OPENAI_OAUTH_MODELS: { id: string; label: string }[] = [
  { id: "gpt-5.5",      label: "GPT-5.5 — recommended" },
  { id: "gpt-5.4",      label: "GPT-5.4 — most capable" },
  { id: "gpt-5.4-mini", label: "GPT-5.4-mini — fast & low-cost" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const unit = (v?: string) =>
  v && !v.endsWith("_UNSPECIFIED")
    ? v.split("_").slice(2).join(" ").toLowerCase() || v.split("_").pop()?.toLowerCase()
    : null;

const KEY_PROVIDERS: ProviderType[] = ["openrouter", "openai-key", "gemini-key", "anthropic-key"];

function providerKeyLabel(p: ProviderType) {
  if (p === "openrouter")    return "OpenRouter API Key";
  if (p === "openai-key")    return "OpenAI API Key";
  if (p === "gemini-key")    return "Gemini API Key (Google AI Studio)";
  if (p === "anthropic-key") return "Anthropic API Key";
  return "API Key";
}

function providerKeyPlaceholder(p: ProviderType) {
  if (p === "openrouter")    return "sk-or-v1-…";
  if (p === "openai-key")    return "sk-proj-…";
  if (p === "gemini-key")    return "AIza…";
  if (p === "anthropic-key") return "sk-ant-…";
  return "";
}

function providerHint(p: ProviderType): string {
  switch (p) {
    case "openrouter":    return "openrouter.ai/keys — text via Cerebras, vision via any provider";
    case "openai-key":    return "platform.openai.com/api-keys — gpt-4o supports text + vision";
    case "openai-oauth":  return "Sign in with your ChatGPT Plus/Pro subscription. No API key needed.";
    case "gemini-key":    return "aistudio.google.com/apikey — gemini-2.0-flash supports text + vision";
    case "anthropic-key": return "console.anthropic.com — claude-haiku supports text + vision";
    case "ollama":        return "Local Ollama instance. Install from ollama.ai and pull a model.";
    default:              return "";
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface ArchiveStatus {
  connected: boolean;
  coverage: { days: number; oldest: string | null; newest: string | null };
  backfill: { target: string; cursor: string; pct: number | null } | null;
}

export default function Settings() {
  const [data, setData]           = useState<SettingsPayload | null>(null);
  const [busy, setBusy]           = useState(false);
  const [archive, setArchive]     = useState<ArchiveStatus | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillPct, setBackfillPct] = useState<number | null>(null);
  const [backfillErr, setBackfillErr] = useState<string | null>(null);

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState("5");

  useEffect(() => {
    const saved = localStorage.getItem("ht-auto-refresh");
    if (saved) {
      setAutoRefresh(saved);
    }
  }, []);

  const handleAutoRefreshChange = (value: string) => {
    setAutoRefresh(value);
    localStorage.setItem("ht-auto-refresh", value);
  };

  // AI provider state
  const [ai, setAi]                 = useState<AiPayload | null>(null);
  const [aiExpanded, setAiExpanded] = useState<ProviderType | null>(null);
  const [aiKey, setAiKey]           = useState("");
  const [aiUrl, setAiUrl]           = useState("http://localhost:11434");
  const [aiModel, setAiModel]       = useState("");
  const [aiVModel, setAiVModel]     = useState("");
  const [aiSaving, setAiSaving]     = useState(false);
  const [aiErr, setAiErr]           = useState<string | null>(null);

  // ChatGPT device code flow state
  const [deviceFlow, setDeviceFlow]   = useState<DeviceFlow | null>(null);
  const [deviceStarting, setDeviceStarting] = useState(false);
  const [deviceErr, setDeviceErr]     = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load        = useCallback(() => fetch("/api/settings").then((r) => r.json()).then(setData).catch(() => {}), []);
  const loadArchive = useCallback(() => fetch("/api/archive").then((r) => r.json()).then(setArchive).catch(() => {}), []);
  const loadAi      = useCallback(() => fetch("/api/ai-provider").then((r) => r.json()).then(setAi).catch(() => {}), []);

  useEffect(() => { load(); loadArchive(); loadAi(); }, [load, loadArchive, loadAi]);

  // Poll for ChatGPT device code authorization
  useEffect(() => {
    if (!deviceFlow) return;
    const interval = Math.max(deviceFlow.interval, 5) * 1000;
    pollTimer.current = setInterval(async () => {
      if (Date.now() > deviceFlow.expiresAt) {
        clearInterval(pollTimer.current!);
        setDeviceFlow(null);
        setDeviceErr("Code expired. Please try again.");
        return;
      }
      try {
        const res  = await fetch("/api/ai-provider/oauth/openai/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: deviceFlow.deviceCode, userCode: deviceFlow.userCode }),
        });
        const json = await res.json();
        if (json.status === "authorized") {
          clearInterval(pollTimer.current!);
          setDeviceFlow(null);
          loadAi(); load();
        } else if (json.status === "error") {
          clearInterval(pollTimer.current!);
          setDeviceFlow(null);
          setDeviceErr(`Authorization failed: ${json.error}`);
        }
        // "pending" and "slow_down" → keep polling
      } catch { /* network blip — keep polling */ }
    }, interval);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [deviceFlow, loadAi, load]);

  async function startDeviceCode() {
    setDeviceStarting(true);
    setDeviceErr(null);
    try {
      const res  = await fetch("/api/ai-provider/oauth/openai", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to start");
      setDeviceFlow({
        deviceCode:      json.deviceCode,
        userCode:        json.userCode,
        verificationUri: json.verificationUri,
        interval:        json.interval ?? 5,
        expiresAt:       Date.now() + (json.expiresIn ?? 300) * 1000,
      });
    } catch (e: any) {
      setDeviceErr(e.message ?? "Failed to start device code flow");
    } finally {
      setDeviceStarting(false);
    }
  }

  function cancelDeviceFlow() {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setDeviceFlow(null);
    setDeviceErr(null);
  }

  async function runBackfill() {
    setBackfilling(true);
    setBackfillErr(null);
    try {
      // Each POST archives one ~30-day batch; loop until the year is done.
      for (let i = 0; i < 30; i++) {
        const res = await fetch("/api/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill" }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const j = await res.json();
        setBackfillPct(j.backfill?.pct ?? null);
        setArchive(j);
        if (j.done) break;
      }
    } catch (e: any) {
      setBackfillErr(e?.message ?? "Backfill failed — it will resume where it stopped.");
    } finally {
      setBackfilling(false);
      loadArchive();
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Health? Your local data stays; reconnect any time.")) return;
    setBusy(true);
    await fetch("/api/settings", { method: "DELETE" });
    await load(); setBusy(false);
  }

  function openAiForm(p: ProviderType) {
    setAiExpanded(p === aiExpanded ? null : p);
    setAiErr(null);
    const info = ai?.providers[p];
    setAiKey("");
    setAiUrl(info?.baseUrl || "http://localhost:11434");
    setAiModel(info?.model || "");
    setAiVModel(info?.visionModel || "");
  }

  async function saveAiProvider(p: ProviderType) {
    setAiSaving(true); setAiErr(null);
    try {
      const body: any = { action: "save", provider: p };
      if (KEY_PROVIDERS.includes(p) && p !== "ollama") body.apiKey = aiKey;
      if (p === "ollama") body.baseUrl = aiUrl;
      if (aiModel)  body.model = aiModel;
      if (aiVModel) body.visionModel = aiVModel;
      const res = await fetch("/api/ai-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      setAiExpanded(null); setAiKey(""); setAiModel(""); setAiVModel("");
      loadAi(); load();
    } catch (e: any) {
      setAiErr(e.message ?? "Save failed");
    } finally {
      setAiSaving(false);
    }
  }

  // openai-oauth: change the active model. Same model serves text + vision.
  async function selectOAuthModel(p: ProviderType, model: string) {
    await fetch("/api/ai-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", provider: p, model, visionModel: model }),
    });
    loadAi(); load();
  }

  async function activateProvider(p: ProviderType) {
    await setProviderRole("primary", p);
  }

  async function setProviderRole(role: "primary" | "secondary", p: ProviderType | null) {
    await fetch("/api/ai-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setRole", role, provider: p }),
    });
    loadAi(); load();
  }

  async function disconnectAiProvider(p: ProviderType) {
    if (!confirm(`Disconnect ${ai?.providers[p]?.label ?? p}?`)) return;
    await fetch(`/api/ai-provider?provider=${p}`, { method: "DELETE" });
    loadAi(); load();
  }

  const s = data?.settings;

  const [activeTab, setActiveTab] = useState<"integrations" | "ai" | "preferences" | "archive">("integrations");

  useEffect(() => {
    if (archive?.backfill) {
      setBackfillPct(archive.backfill.pct);
    } else if (archive) {
      setBackfillPct(null);
    }
  }, [archive]);

  function renderIntegrations() {
    if (!data) return null;
    const isGhealthConnected = data.connected;
    return (
      <div className="stack" style={{ gap: 20 }}>
        {/* Connection Map Visualizer */}
        <div className="connection-map rise rise-2">
          <div className="connection-node">
            <div className="connection-node-icon" style={{ background: "var(--heart-soft)", color: "var(--heart)" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20s-7-4.4-9-8.5C1.4 8.2 3.2 5 6.6 5c2 0 3.3 1 4.4 2.4h2C14.1 6 15.4 5 17.4 5c3.4 0 5.2 3.2 3.6 6.5-2 4.1-9 8.5-9 8.5z" />
              </svg>
            </div>
            <span>Google Health</span>
          </div>
          <div className={`connection-bridge ${isGhealthConnected ? "connected" : "disconnected"}`} />
          <div className="connection-node">
            <div className="connection-node-icon" style={{
              background: "var(--activity-soft)",
              color: "var(--activity)",
              border: isGhealthConnected ? "1.5px solid var(--activity)" : "1.5px solid transparent"
            }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <span>HealthTrack</span>
          </div>
        </div>

        <section className="card rise rise-3">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-label">
              <IconChip icon={HeartIcon} color="var(--heart)" />
              Connection Status
            </div>
            <span className="badge" style={{
              background: data.connected ? "var(--activity-soft)" : "var(--food-soft)",
              color:      data.connected ? "var(--activity)"      : "var(--food)",
            }}>
              {data.connected ? "connected" : data.configured ? "not connected" : "no credentials"}
            </span>
          </div>

          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
            Synchronize raw health telemetry data, workouts, sleep, and measurements directly from your Google Health data.
          </p>

          {data.connected && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-soft)", marginBottom: 10 }}>
                Synchronized Permissions
              </h3>
              <div className="stack" style={{ gap: 8 }}>
                {data.permissions.map((p) => (
                  <div key={p.label} className="row" style={{ justifyContent: "space-between", fontSize: 13.5, background: "var(--bg-inset)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--hairline)" }}>
                    <span style={{ color: "var(--ink-soft)" }}>{p.label}</span>
                    <span style={{ color: p.granted ? "var(--activity)" : "var(--food)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                      {p.granted ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Granted
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                          Missing
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.needsReconnect && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "color-mix(in srgb, var(--food) 10%, var(--bg-raised))", border: "1px solid color-mix(in srgb, var(--food) 30%, transparent)", padding: "12px 14px", borderRadius: 12, marginTop: 16 }}>
              <span style={{ color: "var(--food)" }}>⚠️</span>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                Some permissions were added after you first connected. Please reconnect once to grant them.
              </p>
            </div>
          )}

          <div className="row" style={{ gap: 10, marginTop: 20 }}>
            <a className="btn" href="/api/googlehealth/auth" style={{
              background: data.needsReconnect ? "var(--food)" : "var(--ink)",
              color: data.needsReconnect ? "var(--bg)" : "var(--bg)",
              textDecoration: "none", flex: 1, textAlign: "center",
            }}>
              {data.connected ? "Refresh Permissions" : "Connect Google Health"}
            </a>
            {data.connected && (
              <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderAi() {
    if (!data) return null;
    const isAiConfigured = data.aiConfigured;
    return (
      <div className="stack" style={{ gap: 20 }}>
        <section className="card rise rise-2">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-label">
              <IconChip icon={LungsIcon} color="var(--breath)" />
              AI Engine
            </div>
            {isAiConfigured && (
              <span className="badge" style={{ background: "var(--activity-soft)", color: "var(--activity)" }}>
                {data.aiProviderName}
              </span>
            )}
          </div>
          
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
            Connect a language model to power the Health Coach and automated food analysis. Vision-capable models are recommended to parse meal photos.
          </p>

          {ai && (() => {
            const configured = (Object.keys(ai.providers) as ProviderType[]).filter((p) => ai.providers[p].configured);
            if (configured.length === 0) return null;
            const labelFor = (p: string) => ai.providers[p as ProviderType]?.label ?? p;
            return (
              <div className="stack" style={{ gap: 10, marginTop: 18, background: "var(--bg-inset)", padding: "14px 16px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>Primary model</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Used first for every request</span>
                  </div>
                  <select className="field" style={{ minWidth: 200, padding: "6px 10px", borderRadius: 8, fontSize: 13 }}
                    value={ai.primary ?? ""}
                    onChange={(e) => setProviderRole("primary", e.target.value as ProviderType)}>
                    {!ai.primary && <option value="">Select…</option>}
                    {configured.map((p) => <option key={p} value={p}>{labelFor(p)}</option>)}
                  </select>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>Secondary (fallback)</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Used automatically if the primary fails</span>
                  </div>
                  <select className="field" style={{ minWidth: 200, padding: "6px 10px", borderRadius: 8, fontSize: 13 }}
                    value={ai.secondary ?? ""}
                    onChange={(e) => setProviderRole("secondary", (e.target.value || null) as ProviderType | null)}>
                    <option value="">None</option>
                    {configured.filter((p) => p !== ai.primary).map((p) => <option key={p} value={p}>{labelFor(p)}</option>)}
                  </select>
                </div>
              </div>
            );
          })()}

          {!ai ? (
            <p className="pulsing" style={{ color: "var(--ink-soft)", marginTop: 16, fontSize: 13 }}>Loading providers…</p>
          ) : (
            <div className="stack" style={{ gap: 12, marginTop: 20 }}>
              {(Object.keys(ai.providers) as ProviderType[]).map((p) => {
                const info       = ai.providers[p];
                const isPrimary  = ai.primary === p;
                const isSecondary = ai.secondary === p;
                const isActive   = isPrimary; // primary drives the card highlight
                const isExpanded = aiExpanded === p;
                const isOAuth   = p === "openai-oauth";
                const isOllama  = p === "ollama";
                const isKeyProv = KEY_PROVIDERS.includes(p);

                return (
                  <div key={p} className={`provider-card ${isActive ? "active" : ""}`} style={{
                    border: `1.5px solid ${isActive ? "var(--activity)" : "var(--hairline)"}`,
                    borderRadius: 16,
                    padding: "14px 16px",
                    background: isActive ? "var(--activity-soft)" : "var(--bg-inset)",
                    transition: "all 0.25s ease"
                  }}>
                    {/* Header row */}
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 14.5 }}>{info.label}</span>
                        {isPrimary && (
                          <span className="badge" style={{ background: "var(--activity)", color: "var(--bg)", fontSize: 10.5, padding: "2px 8px" }}>Primary</span>
                        )}
                        {isSecondary && (
                          <span className="badge" style={{ background: "var(--sleep)", color: "var(--bg)", fontSize: 10.5, padding: "2px 8px" }}>Fallback</span>
                        )}
                        {info.fromEnv && !isPrimary && !isSecondary && (
                          <span className="badge" style={{ background: "var(--ink-faint)", color: "var(--ink-soft)", fontSize: 10.5, padding: "2px 8px" }}>.env file</span>
                        )}
                        {info.configured && !isPrimary && !isSecondary && (
                          <span className="badge" style={{ background: "var(--sleep-soft)", color: "var(--sleep)", fontSize: 10.5, padding: "2px 8px" }}>Ready</span>
                        )}
                      </div>

                      <div className="row" style={{ gap: 6 }}>
                        {info.configured && !isPrimary && (
                          <button className="btn" style={{ fontSize: 12, padding: "5px 12px", background: "var(--ink)", color: "var(--bg)" }}
                            onClick={() => activateProvider(p)}>
                            Set Primary
                          </button>
                        )}
                        {isOAuth && !deviceFlow && (
                          <button className="btn" style={{ fontSize: 12, padding: "5px 12px" }}
                            onClick={startDeviceCode} disabled={deviceStarting}>
                            {deviceStarting ? "…" : info.configured ? "Reconnect" : "Connect"}
                          </button>
                        )}
                        {isOAuth && deviceFlow && (
                          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }}
                            onClick={cancelDeviceFlow}>
                            Cancel
                          </button>
                        )}
                        {!isOAuth && (
                          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }}
                            onClick={() => openAiForm(p)}>
                            {isExpanded ? "Close" : info.configured ? "Edit" : "Configure"}
                          </button>
                        )}
                        {info.configured && !info.fromEnv && (
                          <button className="btn btn-ghost"
                            style={{ fontSize: 12, padding: "5px 8px", color: "var(--heart)", borderColor: "transparent" }}
                            onClick={() => disconnectAiProvider(p)}
                            title="Disconnect credentials"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Model details display */}
                    {info.configured && !isExpanded && (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-soft)", display: "flex", gap: 12 }}>
                        <span>🤖 {info.model}</span>
                        {info.visionModel && info.visionModel !== info.model && (
                          <span>👁️ {info.visionModel}</span>
                        )}
                      </div>
                    )}

                    {/* Select OAuth model */}
                    {isOAuth && info.configured && (
                      <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 12 }}>
                        <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>Model Selection</label>
                        <select className="field" value={info.model}
                          onChange={(e) => selectOAuthModel(p, e.target.value)}
                          style={{ flex: 1, padding: "6px 10px", borderRadius: 8, fontSize: 13 }}>
                          {OPENAI_OAUTH_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                          {!OPENAI_OAUTH_MODELS.some((m) => m.id === info.model) && (
                            <option value={info.model}>{info.model} (current)</option>
                          )}
                        </select>
                      </div>
                    )}

                    {/* Hint when not configured */}
                    {!info.configured && !isExpanded && !deviceFlow && (
                      <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 6 }}>{providerHint(p)}</p>
                    )}

                    {/* Device flow code container */}
                    {isOAuth && deviceFlow && (
                      <div style={{
                        marginTop: 12,
                        background: "var(--bg)",
                        border: "1px solid var(--hairline)",
                        borderRadius: 12,
                        padding: "14px",
                      }}>
                        <p style={{ fontSize: 13, fontWeight: 700, fontStyle: "normal", marginBottom: 4 }}>
                          Link your ChatGPT subscription
                        </p>
                        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12, lineHeight: 1.5 }}>
                          1. Navigate to <a href={deviceFlow.verificationUri} target="_blank" rel="noreferrer" style={{ color: "var(--activity)", textDecoration: "underline" }}>{deviceFlow.verificationUri}</a>
                          <br />
                          2. Enter the code below when requested:
                        </p>
                        
                        {/* Digital verification display */}
                        <div style={{ position: "relative" }}>
                          <div className="digit-container">
                            {deviceFlow.userCode.split("").map((char, index) => (
                              <div key={index} className="digit-box">{char}</div>
                            ))}
                          </div>
                          
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", position: "absolute", right: 0, top: -4 }} onClick={() => {
                            navigator.clipboard.writeText(deviceFlow.userCode);
                          }}>
                            Copy
                          </button>
                        </div>
                        
                        <p className="pulsing" style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center", marginTop: 12 }}>
                          Waiting for device authorization response…
                        </p>
                      </div>
                    )}

                    {/* Config Form fields */}
                    {isExpanded && !isOAuth && (
                      <div className="stack" style={{ gap: 10, marginTop: 14 }}>
                        {isKeyProv && !isOllama && (
                          <div>
                            <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4, fontWeight: 600 }}>
                              {providerKeyLabel(p)}
                            </label>
                            <input type="password" className="field"
                              placeholder={providerKeyPlaceholder(p)}
                              value={aiKey} onChange={(e) => setAiKey(e.target.value)}
                              style={{ width: "100%" }} />
                          </div>
                        )}
                        {isOllama && (
                          <div>
                            <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4, fontWeight: 600 }}>
                              Ollama Base URL
                            </label>
                            <input type="url" className="field" placeholder="http://localhost:11434"
                              value={aiUrl} onChange={(e) => setAiUrl(e.target.value)}
                              style={{ width: "100%" }} />
                          </div>
                        )}
                        <div className="row" style={{ gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4, fontWeight: 600 }}>
                              {isOllama ? "Text model" : "Model ID (optional)"}
                            </label>
                            <input type="text" className="field"
                              placeholder={isOllama ? "llama3.2" : `default: ${info.model}`}
                              value={aiModel} onChange={(e) => setAiModel(e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4, fontWeight: 600 }}>
                              {isOllama ? "Vision model" : "Vision ID (optional)"}
                            </label>
                            <input type="text" className="field"
                              placeholder={isOllama ? "llava" : `default: ${info.visionModel}`}
                              value={aiVModel} onChange={(e) => setAiVModel(e.target.value)} />
                          </div>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.4 }}>{providerHint(p)}</p>
                        {aiErr && <p style={{ fontSize: 12.5, color: "var(--heart)", fontWeight: 600 }}>⚠️ {aiErr}</p>}
                        
                        <div className="row" style={{ gap: 8, marginTop: 4 }}>
                          <button className="btn" disabled={aiSaving || (!aiKey && !isOllama)}
                            onClick={() => saveAiProvider(p)} style={{ flex: 1 }}>
                            {aiSaving ? "Saving…" : "Save"}
                          </button>
                          <button className="btn btn-ghost" onClick={() => setAiExpanded(null)}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Device flow error */}
                    {isOAuth && deviceErr && !deviceFlow && (
                      <p style={{ fontSize: 12.5, color: "var(--heart)", marginTop: 10, fontWeight: 600 }}>⚠️ {deviceErr}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderPreferences() {
    if (!data) return null;
    return (
      <div className="stack" style={{ gap: 20 }}>
        {/* Global Preferences */}
        <section className="card rise rise-2">
          <div className="card-label" style={{ marginBottom: 14 }}>
            <IconChip icon={LungsIcon} color="var(--breath)" />
            App Preferences
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", background: "var(--bg-inset)", padding: "12px 16px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Theme Mode</span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Select light or dark user interface</span>
              </div>
              <ThemeToggle />
            </div>

            {/* Auto Refresh Row */}
            <div className="row" style={{ justifyContent: "space-between", background: "var(--bg-inset)", padding: "12px 16px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Auto Refresh</span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Interval to sync telemetry in background</span>
              </div>
              <select
                value={autoRefresh}
                onChange={(e) => handleAutoRefreshChange(e.target.value)}
                className="field"
                style={{
                  width: 150,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--hairline)",
                  background: "var(--bg-inset)",
                  color: "var(--ink)",
                  fontSize: 13.5,
                }}
              >
                <option value="disabled">Disabled</option>
                <option value="1">Every 1 minute</option>
                <option value="5">Every 5 minutes</option>
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
              </select>
            </div>

            <div className="row" style={{ justifyContent: "space-between", background: "var(--bg-inset)", padding: "12px 16px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Timezone</span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Local database mapping timezone</span>
              </div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{data.timezone}</span>
            </div>
          </div>
        </section>

        {/* Metric Units Grid */}
        {(data.profile || s) && (
          <section className="card rise rise-3">
            <div className="card-label">
              <IconChip icon={ScaleIcon} color="var(--food)" />
              Account & Measurement Units
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 8 }}>
              User profile statistics and system units imported directly from your Google Health settings.
            </p>

            <div className="pref-grid">
              {data.profile?.age != null && (
                <div className="pref-card">
                  <span className="pref-card-label">Age</span>
                  <span className="pref-card-value">{data.profile.age} yrs</span>
                </div>
              )}
              {data.profile?.membershipStartDate && (
                <div className="pref-card">
                  <span className="pref-card-label">Member Since</span>
                  <span className="pref-card-value">{data.profile.membershipStartDate.year}</span>
                </div>
              )}
              {unit(s?.weightUnit) && (
                <div className="pref-card">
                  <span className="pref-card-label">Weight</span>
                  <span className="pref-card-value">{unit(s.weightUnit)}</span>
                </div>
              )}
              {unit(s?.distanceUnit) && (
                <div className="pref-card">
                  <span className="pref-card-label">Distance</span>
                  <span className="pref-card-value">{unit(s.distanceUnit)}</span>
                </div>
              )}
              {unit(s?.waterUnit) && (
                <div className="pref-card">
                  <span className="pref-card-label">Water</span>
                  <span className="pref-card-value">{unit(s.waterUnit)}</span>
                </div>
              )}
              {unit(s?.temperatureUnit) && (
                <div className="pref-card">
                  <span className="pref-card-label">Temp</span>
                  <span className="pref-card-value">{unit(s.temperatureUnit)}</span>
                </div>
              )}
              {s?.languageLocale && (
                <div className="pref-card">
                  <span className="pref-card-label">Locale</span>
                  <span className="pref-card-value">{s.languageLocale}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Connected Devices */}
        {data.devices && data.devices.length > 0 && (
          <section className="card rise rise-4">
            <div className="card-label">
              <IconChip icon={ScaleIcon} color="var(--sleep)" />
              Paired Devices
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 8, marginBottom: 14 }}>
              External sensors, smart rings, and wearables. Click the edit pencil to rename them locally.
            </p>
            <div className="stack" style={{ gap: 10 }}>
              {data.devices.map((d: any, i: number) => (
                <DeviceRow key={i} index={i} device={d} onSaved={load} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderArchive() {
    if (!data) return null;
    return (
      <div className="stack" style={{ gap: 20 }}>
        <section className="card rise rise-2">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-label">
              <IconChip icon={ScaleIcon} color="var(--sleep)" />
              Local Data Archive
            </div>
            {archive && archive.coverage.days > 0 && (
              <span className="badge" style={{ background: "var(--activity-soft)", color: "var(--activity)" }}>
                {archive.coverage.days} days cached
              </span>
            )}
          </div>
          
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
            Days older than 3 days are cached inside a local SQLite database (`archive.db`). This allows near-instant loading of historical trends without making slow round-trip web requests to Google APIs. Recent days are loaded dynamically.
          </p>

          {archive && archive.coverage.days > 0 && (
            <div className="stack" style={{ gap: 8, marginTop: 18, background: "var(--bg-inset)", padding: "14px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13.5 }}>
                <span style={{ color: "var(--ink-soft)" }}>Cached Period</span>
                <span style={{ fontWeight: 600 }}>{archive.coverage.days} days ({archive.coverage.oldest} to {archive.coverage.newest})</span>
              </div>
            </div>
          )}

          {/* Sync/Backfill Progress Block */}
          <div style={{ marginTop: 20, background: "var(--bg-inset)", padding: "16px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>1-Year History Synchronization</span>
              {backfillPct !== null && (
                <span className="display-num" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sleep)" }}>{backfillPct}%</span>
              )}
            </div>

            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.5 }}>
              {backfilling 
                ? "Retrieving batch telemetry records from Google servers. Please keep this tab open."
                : "Pre-fetch up to one year of health history to populate the Trends and Records dashboards immediately."
              }
            </p>

            {/* Progress Track component */}
            {(backfilling || (backfillPct !== null && backfillPct > 0)) && (
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${backfillPct ?? 0}%` }} />
              </div>
            )}

            {backfillErr && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, color: "var(--heart)", fontSize: 12.5 }}>
                <span>⚠️</span>
                <span>{backfillErr}</span>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={runBackfill} disabled={backfilling} style={{ width: "100%" }}>
                {backfilling
                  ? "Syncing History batches…"
                  : archive?.backfill && archive.backfill.pct !== 100 && archive.backfill.pct !== null
                    ? `Resume Sync (${backfillPct ?? archive.backfill.pct}% completed)`
                    : "Synchronize 1-Year History"}
              </button>
            </div>
          </div>
        </section>

        {/* Storage Meta */}
        <section className="card rise rise-3">
          <div className="card-label">
            <IconChip icon={LungsIcon} color="var(--breath)" />
            App Engine Storage
          </div>
          <div className="stack" style={{ gap: 6, marginTop: 12, fontSize: 13.5 }}>
            <Row k="Local Storage Path" v="local data/ folder + archive.db" />
            <Row k="Privacy Policy" v="Your data never leaves this machine except for chosen AI provider calls." />
          </div>
        </section>
      </div>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 840 }}>
      <header className="rise rise-1" style={{ marginBottom: 24 }}>
        <h1 className="page-title">Settings.</h1>
        <p className="page-sub">Connection, permissions, and app preferences.</p>
      </header>

      {!data ? (
        <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : (
        <div className="settings-grid">
          {/* Tab Navigation */}
          <nav className="settings-nav rise rise-2">
            <button
              className={`settings-tab-btn ${activeTab === "integrations" ? "active" : ""}`}
              onClick={() => setActiveTab("integrations")}
            >
              <span>📡</span> Integrations
            </button>
            <button
              className={`settings-tab-btn ${activeTab === "ai" ? "active" : ""}`}
              onClick={() => setActiveTab("ai")}
            >
              <span>🧠</span> AI Assistant
            </button>
            <button
              className={`settings-tab-btn ${activeTab === "preferences" ? "active" : ""}`}
              onClick={() => setActiveTab("preferences")}
            >
              <span>⚙️</span> Preferences
            </button>
            <button
              className={`settings-tab-btn ${activeTab === "archive" ? "active" : ""}`}
              onClick={() => setActiveTab("archive")}
            >
              <span>📦</span> Data & Storage
            </button>
          </nav>

          {/* Tab Content Panel */}
          <div className="settings-content stack">
            {activeTab === "integrations" && renderIntegrations()}
            {activeTab === "ai" && renderAi()}
            {activeTab === "preferences" && renderPreferences()}
            {activeTab === "archive" && renderArchive()}
          </div>
        </div>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
      <span style={{ color: "var(--ink-soft)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );
}

/** A paired-device row whose label is locally editable — Google often returns
 *  only a numeric id, so the override (PATCH /api/devices) gives it a name. */
function DeviceRow({ index, device, onSaved }: { index: number; device: any; onSaved: () => void }) {
  const id = String(device.name?.split("/").pop() ?? "");
  const fallback = device.deviceVersion ?? id;
  const current = device.displayName ?? fallback;
  const battery = device.batteryLevel != null ? `${device.batteryLevel}% battery` : null;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: id, label: val }),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="row" style={{ justifyContent: "space-between", gap: 10, background: "var(--bg-inset)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--hairline)", width: "100%" }}>
        <span style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>{`Device ${index + 1}`}</span>
        <span className="row" style={{ gap: 8 }}>
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            placeholder={fallback}
            className="field"
            style={{
              width: 140, fontSize: 13, padding: "5px 10px", textAlign: "right",
            }}
          />
          <button className="btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={save} disabled={saving}>
            {saving ? "…" : "Save"}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12, background: "var(--bg-inset)", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--hairline)", width: "100%" }}>
      <span style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>{`Device ${index + 1}`}</span>
      <span className="row" style={{ gap: 8, fontWeight: 600, textAlign: "right", fontSize: 13.5 }}>
        <span>{[current, battery].filter(Boolean).join(" · ") || "paired device"}</span>
        <button
          aria-label="rename device"
          onClick={() => { setVal(device.displayName ?? ""); setEditing(true); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 4, display: "flex", borderRadius: 6, transition: "background 0.2s" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--hairline)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
          </svg>
        </button>
      </span>
    </div>
  );
}
