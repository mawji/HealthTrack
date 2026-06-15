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
    await fetch("/api/ai-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate", provider: p }),
    });
    loadAi(); load();
  }

  async function disconnectAiProvider(p: ProviderType) {
    if (!confirm(`Disconnect ${ai?.providers[p]?.label ?? p}?`)) return;
    await fetch(`/api/ai-provider?provider=${p}`, { method: "DELETE" });
    loadAi(); load();
  }

  const s = data?.settings;

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <header className="rise rise-1" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Settings.</h1>
        <p className="page-sub">Connection, permissions, and app preferences.</p>
      </header>

      {!data ? (
        <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : (
        <div className="stack">

          {/* Google Health */}
          <section className="card rise rise-2">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="card-label">
                <IconChip icon={HeartIcon} color="var(--heart)" />
                Google Health
              </div>
              <span className="badge" style={{
                background: data.connected ? "var(--activity-soft)" : "var(--food-soft)",
                color:      data.connected ? "var(--activity)"      : "var(--food)",
              }}>
                {data.connected ? "connected" : data.configured ? "not connected" : "no credentials"}
              </span>
            </div>

            {data.connected && (
              <div className="stack" style={{ gap: 6, marginTop: 14 }}>
                {data.permissions.map((p) => (
                  <div key={p.label} className="row" style={{ justifyContent: "space-between", fontSize: 13.5 }}>
                    <span style={{ color: "var(--ink-soft)" }}>{p.label}</span>
                    <span style={{ color: p.granted ? "var(--activity)" : "var(--food)", fontWeight: 700 }}>
                      {p.granted ? "✓" : "missing"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {data.needsReconnect && (
              <p style={{ fontSize: 12.5, color: "var(--food)", marginTop: 12 }}>
                Some permissions were added after you first connected — reconnect once to grant them.
              </p>
            )}

            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <a className="btn" href="/api/googlehealth/auth" style={{
                background: data.needsReconnect ? "var(--food)" : "var(--ink)",
                textDecoration: "none", flex: 1, textAlign: "center",
              }}>
                {data.connected ? "Reconnect (refresh permissions)" : "Connect Google Health"}
              </a>
              {data.connected && (
                <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
              )}
            </div>
          </section>

          {/* Account & units */}
          {data.connected && (data.profile || s || data.devices.length > 0) && (
            <section className="card rise rise-3">
              <div className="card-label">
                <IconChip icon={ScaleIcon} color="var(--food)" />
                Account & units
              </div>
              <div className="stack" style={{ gap: 6, marginTop: 12, fontSize: 13.5 }}>
                {data.profile?.age != null && <Row k="Age" v={`${data.profile.age}`} />}
                {data.profile?.membershipStartDate && <Row k="Member since" v={`${data.profile.membershipStartDate.year}`} />}
                {s?.timeZone && <Row k="Account timezone" v={s.timeZone} />}
                {unit(s?.weightUnit)   && <Row k="Weight unit"   v={unit(s.weightUnit)!} />}
                {unit(s?.distanceUnit) && <Row k="Distance unit" v={unit(s.distanceUnit)!} />}
                {unit(s?.waterUnit)    && <Row k="Water unit"    v={unit(s.waterUnit)!} />}
                {unit(s?.temperatureUnit) && <Row k="Temperature" v={unit(s.temperatureUnit)!} />}
                {s?.languageLocale && <Row k="Locale" v={s.languageLocale} />}
                {data.devices.map((d: any, i: number) => (
                  <Row key={i} k={`Device ${i + 1}`}
                    v={[d.displayName ?? d.name?.split("/").pop(), d.batteryLevel != null ? `${d.batteryLevel}% battery` : null]
                      .filter(Boolean).join(" · ") || "paired device"} />
                ))}
              </div>
            </section>
          )}

          {/* Local archive */}
          {data.connected && (
            <section className="card rise rise-4">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="card-label">
                  <IconChip icon={ScaleIcon} color="var(--sleep)" />
                  Local archive
                </div>
                {archive && archive.coverage.days > 0 && (
                  <span className="badge" style={{ background: "var(--activity-soft)", color: "var(--activity)" }}>
                    {archive.coverage.days} days
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
                Past days are stored locally once they're final (3 days old), so history and trends
                load without the API. Today and recent days always come live from Google Health.
              </p>
              {archive && archive.coverage.days > 0 && (
                <div className="stack" style={{ gap: 6, marginTop: 10, fontSize: 13.5 }}>
                  <Row k="Archived" v={`${archive.coverage.days} days`} />
                  {archive.coverage.oldest && (
                    <Row k="Range" v={`${archive.coverage.oldest} → ${archive.coverage.newest}`} />
                  )}
                </div>
              )}
              <div className="row" style={{ gap: 10, marginTop: 14 }}>
                <button className="btn" onClick={runBackfill} disabled={backfilling} style={{ flex: 1 }}>
                  {backfilling
                    ? `Backfilling… ${backfillPct != null ? backfillPct + "%" : ""}`
                    : archive?.backfill && archive.backfill.pct !== 100
                      ? "Resume backfill (1 year)"
                      : "Backfill history (1 year)"}
                </button>
              </div>
              {backfillErr && (
                <p style={{ fontSize: 12.5, color: "var(--food)", marginTop: 10 }}>{backfillErr}</p>
              )}
            </section>
          )}

          {/* ── AI Provider ──────────────────────────────────────────────── */}
          <section className="card rise rise-5">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="card-label">
                <IconChip icon={LungsIcon} color="var(--breath)" />
                AI Provider
              </div>
              {data.aiConfigured && (
                <span className="badge" style={{ background: "var(--activity-soft)", color: "var(--activity)" }}>
                  {data.aiProviderName}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 8 }}>
              Connect any one provider. Vision-capable models handle both the AI coach and food photo analysis.
            </p>

            {!ai ? (
              <p className="pulsing" style={{ color: "var(--ink-soft)", marginTop: 12, fontSize: 13 }}>Loading…</p>
            ) : (
              <div className="stack" style={{ gap: 8, marginTop: 14 }}>
                {(Object.keys(ai.providers) as ProviderType[]).map((p) => {
                  const info      = ai.providers[p];
                  const isActive  = ai.active === p;
                  const isExpanded = aiExpanded === p;
                  const isOAuth   = p === "openai-oauth";
                  const isOllama  = p === "ollama";
                  const isKeyProv = KEY_PROVIDERS.includes(p);

                  return (
                    <div key={p} style={{
                      border: `1.5px solid ${isActive ? "var(--activity)" : "var(--border)"}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: isActive ? "var(--activity-soft)" : "transparent",
                    }}>
                      {/* Header row */}
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{info.label}</span>
                          {isActive && (
                            <span className="badge" style={{ background: "var(--activity)", color: "#fff", fontSize: 11 }}>active</span>
                          )}
                          {info.fromEnv && !isActive && (
                            <span className="badge" style={{ background: "var(--ink-faint)", color: "var(--ink-soft)", fontSize: 11 }}>from .env</span>
                          )}
                          {info.configured && !isActive && (
                            <span className="badge" style={{ background: "var(--sleep-soft)", color: "var(--sleep)", fontSize: 11 }}>connected</span>
                          )}
                        </div>

                        <div className="row" style={{ gap: 6 }}>
                          {info.configured && !isActive && (
                            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 10px" }}
                              onClick={() => activateProvider(p)}>
                              Use
                            </button>
                          )}
                          {isOAuth && !deviceFlow && (
                            <button className="btn" style={{ fontSize: 12, padding: "3px 10px" }}
                              onClick={startDeviceCode} disabled={deviceStarting}>
                              {deviceStarting ? "…" : info.configured ? "Reconnect" : "Connect"}
                            </button>
                          )}
                          {isOAuth && deviceFlow && (
                            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 10px" }}
                              onClick={cancelDeviceFlow}>
                              Cancel
                            </button>
                          )}
                          {!isOAuth && (
                            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 10px" }}
                              onClick={() => openAiForm(p)}>
                              {info.configured ? "Edit" : "Configure"}
                            </button>
                          )}
                          {info.configured && !info.fromEnv && (
                            <button className="btn btn-ghost"
                              style={{ fontSize: 12, padding: "3px 10px", color: "var(--food)" }}
                              onClick={() => disconnectAiProvider(p)}>
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Model line */}
                      {info.configured && (
                        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
                          {info.model === info.visionModel
                            ? `${info.model} · text + vision`
                            : `Text: ${info.model} · Vision: ${info.visionModel}`}
                        </p>
                      )}

                      {/* ChatGPT subscription: model picker */}
                      {isOAuth && info.configured && (
                        <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 8 }}>
                          <label style={{ fontSize: 12, color: "var(--ink-soft)" }}>Model</label>
                          <select className="input" value={info.model}
                            onChange={(e) => selectOAuthModel(p, e.target.value)}
                            style={{ flex: 1, boxSizing: "border-box" }}>
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
                      {!info.configured && !isOAuth && (
                        <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>{providerHint(p)}</p>
                      )}
                      {!info.configured && isOAuth && (
                        <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>{providerHint(p)}</p>
                      )}

                      {/* ── ChatGPT device code panel ── */}
                      {isOAuth && deviceFlow && (
                        <div style={{
                          marginTop: 12,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: "12px 14px",
                        }}>
                          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                            Authorize in your browser
                          </p>
                          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>
                            1. Open{" "}
                            <a href={deviceFlow.verificationUri} target="_blank" rel="noreferrer"
                              style={{ color: "var(--activity)" }}>
                              {deviceFlow.verificationUri}
                            </a>{" "}
                            in a browser and sign in to ChatGPT.
                          </p>
                          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>
                            2. Enter this code when prompted:
                          </p>
                          <div style={{
                            fontFamily: "monospace",
                            fontSize: 22,
                            fontWeight: 700,
                            letterSpacing: "0.15em",
                            textAlign: "center",
                            padding: "10px 0",
                            background: "var(--bg)",
                            borderRadius: 6,
                            marginBottom: 12,
                          }}>
                            {deviceFlow.userCode}
                          </div>
                          <p className="pulsing" style={{ fontSize: 12.5, color: "var(--ink-soft)", textAlign: "center" }}>
                            Waiting for authorization…
                          </p>
                        </div>
                      )}

                      {/* ── API key / Ollama config form ── */}
                      {isExpanded && !isOAuth && (
                        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                          {isKeyProv && !isOllama && (
                            <div>
                              <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4 }}>
                                {providerKeyLabel(p)}
                              </label>
                              <input type="password" className="input"
                                placeholder={providerKeyPlaceholder(p)}
                                value={aiKey} onChange={(e) => setAiKey(e.target.value)}
                                style={{ width: "100%", boxSizing: "border-box" }} />
                            </div>
                          )}
                          {isOllama && (
                            <div>
                              <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4 }}>
                                Ollama URL
                              </label>
                              <input type="url" className="input" placeholder="http://localhost:11434"
                                value={aiUrl} onChange={(e) => setAiUrl(e.target.value)}
                                style={{ width: "100%", boxSizing: "border-box" }} />
                            </div>
                          )}
                          <div className="row" style={{ gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4 }}>
                                {isOllama ? "Text model" : "Model (optional)"}
                              </label>
                              <input type="text" className="input"
                                placeholder={isOllama ? "llama3.2" : `default: ${info.model}`}
                                value={aiModel} onChange={(e) => setAiModel(e.target.value)}
                                style={{ width: "100%", boxSizing: "border-box" }} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 4 }}>
                                {isOllama ? "Vision model" : "Vision model (optional)"}
                              </label>
                              <input type="text" className="input"
                                placeholder={isOllama ? "llava" : `default: ${info.visionModel}`}
                                value={aiVModel} onChange={(e) => setAiVModel(e.target.value)}
                                style={{ width: "100%", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          <p style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{providerHint(p)}</p>
                          {aiErr && <p style={{ fontSize: 12.5, color: "var(--food)" }}>{aiErr}</p>}
                          <div className="row" style={{ gap: 8 }}>
                            <button className="btn" disabled={aiSaving || (!aiKey && !isOllama)}
                              onClick={() => saveAiProvider(p)} style={{ flex: 1 }}>
                              {aiSaving ? "Saving…" : "Save & activate"}
                            </button>
                            <button className="btn btn-ghost" onClick={() => setAiExpanded(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Device code error */}
                      {isOAuth && deviceErr && !deviceFlow && (
                        <p style={{ fontSize: 12.5, color: "var(--food)", marginTop: 8 }}>{deviceErr}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* App */}
          <section className="card rise rise-6">
            <div className="card-label">
              <IconChip icon={LungsIcon} color="var(--breath)" />
              App
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 12, fontSize: 13.5 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ color: "var(--ink-soft)" }}>Theme</span>
                <ThemeToggle />
              </div>
              <Row k="Health data timezone" v={data.timezone} />
              {data.aiConfigured && <Row k="Coach model"  v={data.aiModel} />}
              {data.aiConfigured && <Row k="Vision model" v={data.visionModel} />}
              <Row k="Storage" v="local data/ folder + archive.db" />
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 12 }}>
              Nothing leaves this machine except calls to Google Health and your chosen AI provider.
            </p>
          </section>

        </div>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--ink-soft)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );
}
