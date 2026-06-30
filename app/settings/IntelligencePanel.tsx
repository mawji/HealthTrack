"use client";

// Background Intelligence settings (Phase 2): the on/off + quiet-hour schedule and
// the per-tier method + model pickers for the nightly reflection. Deliberately
// separate from the coach's primary/secondary models (the "AI Assistant" tab) —
// these point the background passes at a cheap/local model. The model tiers are
// consumed by the reflection's Tier-1/Tier-2 passes (Phase 3); Phase 1 reflection
// is deterministic and already runs free. See plans/coach-background-intelligence.md.

import { useEffect, useState } from "react";
import { IconChip, LungsIcon } from "@/components/icons";

interface Method { type: string; label: string; configured: boolean }
interface Tier { method: string; model: string }
interface Settings { enabled: boolean; scheduleHour: number; tier1: Tier | null; tier2: Tier | null; aggressiveness: string }
interface TierRun { tier: string; method: string; model: string; ms: number; ok: boolean; estTokens: number; error?: string }
interface LogEntry {
  id: string; at: string; trigger: string; modelRan: boolean; skippedReason?: string;
  signalsSeen: number; notesSeen: number; tierRuns: TierRun[];
  proposed: { adds: number; updates: number; retires: number; questions: number };
  applied: { adds: number; updates: number; retires: number };
  decayed: number; estTokensTotal: number;
}
interface Payload {
  settings: Settings;
  methods: Method[];
  models: Record<string, string[]>;
  ollamaError: string | null;
  log: LogEntry[];
}

const HINT: Record<string, string> = {
  ollama: "Local Ollama — free and private. Best choice for Tier-1. Pull a small model (e.g. llama3.2) first.",
  "openai-oauth": "Your ChatGPT subscription. Pick a small/cheap model for the background.",
  openrouter: "OpenRouter — pick a small, low-cost model for the background.",
  "openai-key": "OpenAI API key. Choose a cheap model (e.g. gpt-4o-mini).",
  "gemini-key": "Gemini API key. Choose a flash/cheap model.",
  "anthropic-key": "Anthropic API key. Choose a Haiku-class model.",
};

export default function IntelligencePanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<Record<string, string>>({});
  const [reflectMsg, setReflectMsg] = useState<string | null>(null);

  const load = () => fetch("/api/coach/intelligence").then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save(patch: Partial<Settings>) {
    setBusy(true);
    try {
      const r = await fetch("/api/coach/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((res) => res.json());
      if (r?.settings) setData((d) => (d ? { ...d, settings: r.settings } : d));
    } finally { setBusy(false); }
  }

  async function testTier(key: "tier1" | "tier2", tier: Tier | null) {
    if (!tier?.method || !tier?.model) { setTest((t) => ({ ...t, [key]: "Pick a method and model first." })); return; }
    setTest((t) => ({ ...t, [key]: "Testing…" }));
    const r = await fetch("/api/coach/intelligence?action=test", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tier }),
    }).then((res) => res.json()).catch(() => null);
    setTest((t) => ({ ...t, [key]: r?.ok ? `✅ Reachable — replied "${r.sample}"` : `⚠ ${r?.error ?? "failed"}` }));
  }

  async function runReflection() {
    setReflectMsg("Running… (model passes can take a moment)");
    const r = await fetch("/api/coach/wellbeing?trigger=manual", { method: "POST" }).then((res) => res.json()).catch(() => null);
    setReflectMsg(r?.ran ? "✅ Reflection written — see Journal → Wellbeing." : `Skipped — ${r?.reason ?? "couldn't run"}`);
    load(); // refresh the run log below
  }

  if (!data) return <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading…</p>;
  const { settings, methods, models } = data;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card rise rise-2">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-label">
            <IconChip icon={LungsIcon} color="var(--breath)" />
            Background Intelligence
          </div>
          <button className={settings.enabled ? "btn" : "btn btn-ghost"} disabled={busy} onClick={() => save({ enabled: !settings.enabled })}>
            {settings.enabled ? "On" : "Off"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
          Once a night, the coach reviews your week/month across activity, sleep, habits, food and labs and
          refreshes its <b>Wellbeing</b> view (Journal → Wellbeing). Phase 1 is deterministic and free;
          the model tiers below add cheaper-then-refined memory distillation as it rolls out. Your main
          coach models (AI Assistant tab) are unchanged.
        </p>

        {settings.enabled && (
          <div className="row" style={{ justifyContent: "space-between", background: "var(--bg-inset)", padding: "12px 16px", borderRadius: 14, border: "1px solid var(--hairline)", marginTop: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Run at (quiet hour)</span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Local time the nightly reflection runs.</span>
            </div>
            <select className="field" style={{ width: 110, padding: "6px 10px", borderRadius: 8, fontSize: 13 }}
              value={settings.scheduleHour} disabled={busy} onChange={(e) => save({ scheduleHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" disabled={busy} onClick={runReflection}>Run reflection now</button>
          <a className="btn btn-ghost" href="/journal?view=wellbeing" style={{ textDecoration: "none" }}>Open Journal → Wellbeing</a>
          {reflectMsg && <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{reflectMsg}</span>}
        </div>
      </section>

      <section className="card rise rise-3">
        <div className="card-label" style={{ marginBottom: 6 }}>Background models</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14, lineHeight: 1.5 }}>
          Pick a <b>method</b> (a provider you've set up, or local Ollama) and a <b>model</b> for each tier.
          <b> Tier-1</b> is the cheap/local first stab; <b>Tier-2</b> refines what Tier-1 surfaces. Leave Tier-2
          empty to reuse Tier-1. {data.ollamaError && <span style={{ color: "var(--ink-faint)" }}>Ollama not detected ({data.ollamaError}).</span>}
        </p>

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14, background: "var(--bg-inset)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--hairline)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>How readily it forms memories</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Conservative records only durable facts; eager also notes emerging tendencies.</span>
          </div>
          <select className="field" style={{ width: 150, padding: "6px 10px", borderRadius: 8, fontSize: 13, textTransform: "capitalize" }}
            value={settings.aggressiveness} disabled={busy} onChange={(e) => save({ aggressiveness: e.target.value } as Partial<Settings>)}>
            {["conservative", "balanced", "eager"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <TierPicker label="Tier-1 — first stab (cheap/local)" tierKey="tier1" tier={settings.tier1}
          methods={methods} models={models} busy={busy} test={test.tier1}
          onChange={(t) => save({ tier1: t })} onTest={(t) => testTier("tier1", t)} />
        <div style={{ height: 14 }} />
        <TierPicker label="Tier-2 — refine (optional)" tierKey="tier2" tier={settings.tier2}
          methods={methods} models={models} busy={busy} test={test.tier2}
          onChange={(t) => save({ tier2: t })} onTest={(t) => testTier("tier2", t)} />
      </section>

      <section className="card rise rise-4">
        <div className="card-label" style={{ marginBottom: 6 }}>Background activity</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12, lineHeight: 1.5 }}>
          Every reflection run, with what each tier did and a rough token estimate. Nothing is a black box —
          memories it writes appear on the Memory page labelled “noticed in review”.
        </p>
        {data.log.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>No runs yet. Press “Run reflection now” above.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {data.log.map((e) => (
              <div key={e.id} style={{ background: "var(--bg-inset)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--hairline)" }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{new Date(e.at).toLocaleString()} · {e.trigger}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                    {e.modelRan ? `~${e.estTokensTotal} est. tokens` : (e.skippedReason ?? "deterministic only")}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
                  {e.signalsSeen} signal(s), {e.notesSeen} note(s)
                  {e.modelRan && <> · memory +{e.applied.adds}/~{e.applied.updates}/-{e.applied.retires}</>}
                  {e.decayed > 0 && <> · {e.decayed} decayed</>}
                </div>
                {e.tierRuns.map((t, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: t.ok ? "var(--ink-soft)" : "var(--heart)", marginTop: 3 }}>
                    {t.tier}: {t.method}/{t.model} · {t.ms}ms {t.ok ? "✓" : `✕ ${t.error ?? "failed"}`}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TierPicker({ label, tier, methods, models, busy, test, onChange, onTest }: {
  label: string; tierKey: string; tier: Tier | null;
  methods: Method[]; models: Record<string, string[]>; busy: boolean; test?: string;
  onChange: (t: Tier | null) => void; onTest: (t: Tier | null) => void;
}) {
  const method = tier?.method ?? "";
  const model = tier?.model ?? "";
  const opts = method ? (models[method] ?? []) : [];
  // Always show every model for the method (a native select doesn't filter by the
  // current value the way a datalist does); include the current model if it isn't
  // in the live list, plus a Custom… escape hatch for ids the provider can't list.
  const allOpts = Array.from(new Set([...opts, ...(model && !opts.includes(model) ? [model] : [])]));
  const [custom, setCustom] = useState(false);

  return (
    <div style={{ background: "var(--bg-inset)", padding: "14px 16px", borderRadius: 14, border: "1px solid var(--hairline)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>{label}</div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600 }}>Method</label>
          <select className="field" style={{ minWidth: 180, padding: "6px 10px", borderRadius: 8, fontSize: 13 }}
            value={method} disabled={busy}
            onChange={(e) => { const m = e.target.value; setCustom(false); onChange(m ? { method: m, model: (models[m] ?? [])[0] ?? "" } : null); }}>
            <option value="">None</option>
            {methods.map((m) => (
              <option key={m.type} value={m.type}>{m.label}{m.configured ? "" : " (not set up)"}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600 }}>Model</label>
          {custom ? (
            <input className="field" autoFocus placeholder="type a model id" value={model} disabled={busy || !method}
              onChange={(e) => method && onChange({ method, model: e.target.value })}
              style={{ padding: "6px 10px", borderRadius: 8, fontSize: 13 }} />
          ) : (
            <select className="field" value={model} disabled={busy || !method}
              onChange={(e) => { if (e.target.value === "__custom__") { setCustom(true); } else if (method) onChange({ method, model: e.target.value }); }}
              style={{ padding: "6px 10px", borderRadius: 8, fontSize: 13 }}>
              {!model && <option value="">{method ? "pick a model" : "choose a method first"}</option>}
              {allOpts.map((o) => <option key={o} value={o}>{o}</option>)}
              {method && <option value="__custom__">Custom…</option>}
            </select>
          )}
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "7px 12px" }} disabled={busy || !method || !model}
          onClick={() => onTest(tier)}>Test</button>
      </div>
      {method && HINT[method] && <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 8 }}>{HINT[method]}</p>}
      {test && <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>{test}</p>}
    </div>
  );
}
