"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage, DaySummary } from "@/lib/types";
import { VizCard, VizPlaceholder } from "@/components/ChatVisuals";

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
        } else if (spec.action === "logFood") {
          const res = await fetch("/api/food/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: spec.name,
              mealType: spec.mealType,
              calories: spec.calories,
              proteinG: spec.proteinG,
              carbsG: spec.carbsG,
              fatG: spec.fatG,
              glycemicLoad: spec.glycemicLoad,
              loggedAt: spec.loggedAt,
              notes: spec.notes,
            }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const saved = await res.json();
          setDetail(
            `${saved.name} · ${saved.calories} kcal` +
              (saved.syncedToHealth ? " · synced to Google Health" : " · saved")
          );
        } else if (spec.action === "logHabit") {
          const res = await fetch("/api/habits/record", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              habitId: spec.habitId,
              date: spec.date,
              value: spec.value,
              note: spec.note,
            }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const { record, status } = await res.json();
          if (!record) throw new Error("no matching habit");
          const v =
            typeof record.value === "boolean"
              ? record.value
                ? "yes"
                : "no"
              : record.value;
          setDetail(
            `${spec.habitId} · ${v}` +
              (status?.completed ? " · on track" : "") +
              (status?.streak ? ` · streak ${status.streak}d` : "")
          );
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

// A bank of starter prompts — a fresh handful is shown on each visit so the
// page feels alive and surfaces what the coach can do (analysis + logging).
const SUGGESTION_BANK = [
  // Sleep
  "How did I sleep this week?",
  "Is my deep sleep where it should be?",
  "Why have I been waking up tired?",
  "What time should I wind down tonight?",
  // Recovery & vitals
  "Am I recovered enough to train hard today?",
  "What is my HRV trend telling me?",
  "Is my resting heart rate creeping up?",
  "Anything concerning in my vitals lately?",
  // Movement
  "Am I on track for my step goal today?",
  "How active have I been this week?",
  "Have I been moving enough lately?",
  // Training
  "Plan tomorrow's workout",
  "What should I train today?",
  "Am I training too hard this week?",
  "Help me build a balanced weekly plan",
  "I did a 45-minute run this morning",
  // Nutrition
  "Am I eating enough protein?",
  "How balanced were my meals today?",
  "Am I in a calorie deficit this week?",
  "I had oatmeal and eggs for breakfast",
  "What should I eat after my workout?",
  // Hydration
  "Am I drinking enough water today?",
  "Log 2 glasses of water",
  // Trends & weight
  "How is my weight trending?",
  "What changed in my health this month?",
  "Am I burning more than I'm eating?",
  // Focus
  "What should I focus on this week?",
  "Give me one thing to improve today",
];

function pickSuggestions(n: number): string[] {
  const pool = [...SUGGESTION_BANK];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export default function Coach() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Picked once per mount → a new set every time the user opens the page.
  const [suggestions] = useState(() => pickSuggestions(4));
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
            <p className="page-sub">Ask a question, or tell me what you ate or trained.</p>
          </div>
        </div>
      </header>

      {/* Chat */}
      <section className="rise rise-2" style={{ marginTop: 4, flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-label" style={{ marginBottom: 10 }}>
          <span className="dot" style={{ background: "var(--breath)" }} />
          Ask your coach
        </div>
        <div className="stack" style={{ gap: 12, flex: 1 }}>
          {messages.length === 0 && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {suggestions.map((s) => (
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
