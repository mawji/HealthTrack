"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage, CoachInsight, DaySummary } from "@/lib/types";
import { VizCard, VizPlaceholder } from "@/components/ChatVisuals";

const PERIODS = ["day", "week", "month"] as const;

// ── Fenced protocols: ```viz renders a card, ```log executes an action ──

const FENCE_RE = /```(viz|log)\s*([\s\S]*?)```/g;

function tryParseSpec(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    // tolerate single quotes / unquoted keys from smaller models
    try {
      const relaxed = raw
        .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')
        .replace(/'/g, '"');
      return JSON.parse(relaxed);
    } catch {
      return null;
    }
  }
}

type Part =
  | { kind: "text"; value: string }
  | { kind: "viz"; spec: any }
  | { kind: "action"; spec: any; raw: string }
  | { kind: "pending" };

/** Renders **bold** spans — gpt-oss likes markdown emphasis. */
function renderInline(text: string) {
  const pieces = text.split(/\*\*([^*]+)\*\*/g);
  return pieces.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

/** Splits streamed content into prose, finished viz cards, and a pending
 *  placeholder for a fence that hasn't closed yet. */
function splitParts(content: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of content.matchAll(FENCE_RE)) {
    if (m.index! > last) parts.push({ kind: "text", value: content.slice(last, m.index) });
    if (m[1] === "log") parts.push({ kind: "action", spec: tryParseSpec(m[2]), raw: m[2].trim() });
    else parts.push({ kind: "viz", spec: tryParseSpec(m[2]) });
    last = m.index! + m[0].length;
  }
  let tail = content.slice(last);
  const open = tail.indexOf("```");
  if (open !== -1) {
    // unclosed fence — still streaming
    const before = tail.slice(0, open);
    if (before.trim()) parts.push({ kind: "text", value: before });
    parts.push({ kind: "pending" });
  } else {
    tail = tail.replace(/`{1,2}$/, ""); // partial trailing backticks
    if (tail.trim()) parts.push({ kind: "text", value: tail });
  }
  return parts;
}

// Executed action signatures survive re-renders and streaming re-parses.
const executedActions = new Set<string>();

function ActionRunner({ spec, raw, msgKey }: { spec: any; raw: string; msgKey: string }) {
  const [status, setStatus] = useState<"running" | "done" | "failed">("running");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const sig = `${msgKey}:${raw}`;
    if (executedActions.has(sig)) return;
    executedActions.add(sig);
    (async () => {
      try {
        if (!spec?.action) throw new Error("bad action");
        if (spec.action === "logWorkout") {
          const res = await fetch("/api/workouts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(spec),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const saved = await res.json();
          setDetail(
            `${saved.name} · ${saved.durationMin} min` +
              (saved.syncedToHealth ? " · synced to Google Health" : " · saved to journal")
          );
        } else if (spec.action === "logWater") {
          const glasses = Math.max(1, Math.round(Number(spec.glasses) || 1));
          let last: any = null;
          for (let g = 0; g < glasses; g++) {
            const res = await fetch("/api/water", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ delta: 1 }),
            });
            if (!res.ok) throw new Error(`(${res.status})`);
            last = await res.json();
          }
          setDetail(`${glasses * 250} ml added · ${(last?.ml / 1000).toFixed(2)} L today`);
        } else {
          throw new Error(`unknown action ${spec.action}`);
        }
        setStatus("done");
      } catch (e: any) {
        setStatus("failed");
        setDetail(String(e.message ?? e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const color = status === "failed" ? "var(--heart)" : "var(--activity)";
  return (
    <div
      className="row"
      style={{
        gap: 10,
        alignSelf: "flex-start",
        padding: "10px 14px",
        borderRadius: 14,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 9%, var(--bg-raised))`,
        fontSize: 13,
      }}
    >
      <span style={{ color, fontSize: 15 }} className={status === "running" ? "pulsing" : undefined}>
        {status === "running" ? "…" : status === "done" ? "✓" : "✕"}
      </span>
      <span style={{ color: "var(--ink-soft)" }}>
        {status === "running" ? "Logging…" : status === "done" ? `Logged — ${detail}` : `Couldn't log: ${detail}`}
      </span>
    </div>
  );
}

function MessageContent({
  content,
  week,
  isChat = true,
  msgKey = "",
}: {
  content: string;
  week: DaySummary[];
  isChat?: boolean;
  msgKey?: string;
}) {
  if (!content) {
    if (!isChat) return null;
    return (
      <div
        style={{
          padding: "11px 15px",
          borderRadius: 18,
          borderBottomLeftRadius: 6,
          background: "var(--bg-raised)",
          border: "1px solid var(--hairline)",
          alignSelf: "flex-start",
        }}
      >
        <span className="pulsing">●●●</span>
      </div>
    );
  }

  return (
    <>
      {splitParts(content).map((part, i) => {
        if (part.kind === "pending") return <VizPlaceholder key={i} />;
        if (part.kind === "viz") {
          return part.spec ? <VizCard key={i} spec={part.spec} week={week} /> : null;
        }
        if (part.kind === "action") {
          // Only chat messages execute; insights never carry actions.
          if (!isChat || !part.spec) return null;
          return <ActionRunner key={i} spec={part.spec} raw={part.raw} msgKey={msgKey} />;
        }
        const text = part.value.trim();
        if (!text) return null;
        if (!isChat) {
          return (
            <p key={i} style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.5 }}>
              {renderInline(text)}
            </p>
          );
        }
        return (
          <div
            key={i}
            style={{
              alignSelf: "flex-start",
              maxWidth: "100%",
              padding: "11px 15px",
              borderRadius: 18,
              borderBottomLeftRadius: 6,
              background: "var(--bg-raised)",
              color: "var(--ink)",
              border: "1px solid var(--hairline)",
              fontSize: 14.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {renderInline(text)}
          </div>
        );
      })}
    </>
  );
}

export default function Coach() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("day");
  const [insight, setInsight] = useState<CoachInsight | null>(null);
  const [insightErr, setInsightErr] = useState("");
  const [loadingInsight, setLoadingInsight] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [weekData, setWeekData] = useState<DaySummary[]>([]);

  useEffect(() => {
    fetch("/api/health?view=today")
      .then((r) => r.json())
      .then((data) => {
        if (data?.week) setWeekData(data.week);
      })
      .catch(() => {});
  }, []);

  const loadInsight = (p: string, force = false) => {
    setInsight(null);
    setInsightErr("");
    setLoadingInsight(true);
    fetch(`/api/coach/insights?period=${p}${force ? "&refresh=1" : ""}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "failed");
        setInsight(json);
      })
      .catch((e) => setInsightErr(String(e.message ?? e)))
      .finally(() => setLoadingInsight(false));
  };

  useEffect(() => {
    loadInsight(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Chat failed (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
      }
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `⚠ ${e.message ?? e}` }]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <main className="page" style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 14 }}>
          <div
            className="orb"
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              flex: "none",
              background: "radial-gradient(circle at 32% 30%, var(--breath-soft), var(--breath))",
              boxShadow: "0 0 0 6px var(--breath-soft)",
            }}
          />
          <div>
            <h1 className="page-title">Coach.</h1>
            <p className="page-sub">Watching your numbers so you don&apos;t have to.</p>
          </div>
        </div>
      </header>

      <div className="row rise rise-2" style={{ gap: 8, marginBottom: 12 }}>
        {PERIODS.map((p) => (
          <button
            key={p}
            className={`btn ${p === period ? "" : "btn-ghost"}`}
            style={{ padding: "7px 16px", fontSize: 13, textTransform: "capitalize" }}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <section className="card rise rise-3" style={{ borderLeft: "3px solid var(--breath)", position: "relative" }}>
        <button
          aria-label="regenerate summary"
          title="Regenerate with the latest data"
          onClick={() => loadInsight(period, true)}
          disabled={loadingInsight}
          className="icon-btn"
          style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, opacity: loadingInsight ? 0.5 : 1 }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loadingInsight ? "pulsing" : undefined}>
            <path d="M20.5 11a8.5 8.5 0 1 0-2 6.5" />
            <path d="M21 21v-5h-5" />
          </svg>
        </button>
        {loadingInsight && <p className="pulsing" style={{ color: "var(--breath)", fontWeight: 600 }}>Reading your {period}…</p>}
        {insightErr && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{insightErr}</p>}
        {insight && (
          <>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 560, lineHeight: 1.25, paddingRight: 36 }}>
              {insight.headline}
            </h2>
            <MessageContent content={insight.body} week={weekData} isChat={false} />
            {insight.viz && <VizCard spec={insight.viz} week={weekData} />}
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {insight.focusAreas?.map((f, i) => (
                <div key={i} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                  <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--breath)", marginTop: 7, flex: "none" }} />
                  <div>
                    <strong style={{ fontSize: 13.5 }}>{f.title}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--breath)", marginLeft: 7 }}>{f.metric}</span>
                    <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>{f.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Chat */}
      <section className="rise rise-4" style={{ marginTop: 18, flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-label" style={{ marginBottom: 10 }}>
          <span className="dot" style={{ background: "var(--breath)" }} />
          Ask your coach
        </div>
        <div className="stack" style={{ gap: 12, flex: 1 }}>
          {messages.length === 0 && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {["How did I sleep this week?", "Am I eating enough protein?", "Plan tomorrow's workout"].map((s) => (
                <button key={s} className="btn btn-ghost" style={{ fontSize: 12.5, padding: "8px 14px" }} onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                width: "100%",
                maxWidth: "85%",
                gap: 8,
              }}
            >
              {m.role === "user" ? (
                <div
                  style={{
                    alignSelf: "flex-end",
                    padding: "11px 15px",
                    borderRadius: 18,
                    borderBottomRightRadius: 6,
                    background: "var(--ink)",
                    color: "var(--bg)",
                    fontSize: 14.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              ) : (
                <MessageContent content={m.content} week={weekData} msgKey={`m${i}`} />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <input
            className="field"
            placeholder="Ask about your health…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn" style={{ background: "var(--breath)", flex: "none", padding: "12px 18px" }} onClick={send} disabled={streaming || !input.trim()}>
            ↑
          </button>
        </div>
      </section>
    </main>
  );
}
