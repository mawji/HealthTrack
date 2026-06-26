"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage, DaySummary } from "@/lib/types";
import { VizCard, VizPlaceholder } from "@/components/ChatVisuals";
import Toast from "@/components/Toast";
import { FENCE_RE, tryParseSpec } from "@/lib/coach/parse";
import { detectSources } from "@/lib/coach/source-pills";

// ── Fenced protocols: ```viz renders a card, ```log executes an action ──
// The regex + lenient JSON parse are shared with the Telegram handler via
// lib/coach/parse.ts; splitParts below adds the streaming "pending" handling
// that only the live web render needs.

type Part =
  | { kind: "text"; value: string }
  | { kind: "viz"; spec: any }
  | { kind: "action"; spec: any; raw: string }
  | { kind: "pending" };

type ConvMeta = { id: string; title: string; updatedAt: string; messageCount: number };

/** Compact "2h ago" / "3d ago" label for the history list. */
function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

function ActionRunner({ spec, raw, msgKey, inert = false }: { spec: any; raw: string; msgKey: string; inert?: boolean }) {
  const [status, setStatus] = useState<"running" | "done" | "failed">("running");
  const [detail, setDetail] = useState("");
  const [isPlan, setIsPlan] = useState(false);
  // Memory actions (rememberFact/updateMemory/forgetFact) get their own verbs.
  const [memVerb, setMemVerb] = useState<string | null>(null);

  useEffect(() => {
    if (inert) return; // history-loaded actions never re-execute
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
        } else if (spec.action === "planWorkout") {
          setIsPlan(true);
          const res = await fetch("/api/workout-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(spec),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const saved = await res.json();
          setDetail(
            `${saved.name} · ${saved.date} · ${saved.durationMin} min` +
              (saved.estCalories ? ` · ~${saved.estCalories} kcal (est.)` : "")
          );
        } else if (spec.action === "logExerciseSnack") {
          const res = await fetch("/api/exercise-snacks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ routineId: spec.routineId, source: "coach" }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const state = await res.json();
          setDetail(`snack ${state.completed.length} of ${state.target} today`);
        } else if (spec.action === "rememberFact") {
          setMemVerb("Remembered");
          const res = await fetch("/api/coach/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: spec.text, category: spec.category, source: "coach" }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const m = await res.json();
          setDetail(m.text);
        } else if (spec.action === "updateMemory") {
          setMemVerb("Updated");
          const res = await fetch("/api/coach/memory", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: spec.id, text: spec.text, category: spec.category }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          const m = await res.json();
          setDetail(m.text);
        } else if (spec.action === "forgetFact") {
          setMemVerb("Forgot");
          const res = await fetch(`/api/coach/memory?id=${encodeURIComponent(spec.id)}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`(${res.status})`);
          setDetail("removed from memory");
        } else if (spec.action === "answerQuestion") {
          setMemVerb("Noted");
          const res = await fetch("/api/coach/questions/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: spec.id, action: "answer", answer: spec.answer, memoryText: spec.memoryText, category: spec.category, topic: spec.topic }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          setDetail(spec.memoryText || spec.answer || "saved");
          try { window.dispatchEvent(new Event("ht-question-changed")); } catch {}
        } else if (spec.action === "declineTopic") {
          setMemVerb("Noted");
          const res = await fetch("/api/coach/questions/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: spec.id, action: "decline", topic: spec.topic }),
          });
          if (!res.ok) throw new Error(`(${res.status})`);
          setDetail("won't bring that up again");
          try { window.dispatchEvent(new Event("ht-question-changed")); } catch {}
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

  // History-loaded action: show a neutral, already-done chip without re-running.
  if (inert) {
    const verb =
      spec?.action === "rememberFact" || spec?.action === "updateMemory" ? "Remembered"
      : spec?.action === "forgetFact" ? "Forgot"
      : spec?.action === "answerQuestion" || spec?.action === "declineTopic" ? "Noted"
      : spec?.action === "planWorkout" ? "Planned"
      : "Logged";
    return (
      <div className="row" style={{ gap: 10, alignSelf: "flex-start", padding: "8px 14px", borderRadius: 14, border: "1px solid var(--hairline)", background: "var(--bg-raised)", fontSize: 13 }}>
        <span style={{ color: "var(--ink-faint)", fontSize: 15 }}>✓</span>
        <span style={{ color: "var(--ink-faint)" }}>{verb} earlier in this chat</span>
      </div>
    );
  }

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
        {status === "running"
          ? memVerb ? "Saving…" : isPlan ? "Planning…" : "Logging…"
          : status === "done"
            ? `${memVerb ?? (isPlan ? "Planned" : "Logged")} — ${detail}`
            : `Couldn't ${memVerb ? "save" : isPlan ? "plan" : "log"}: ${detail}`}
      </span>
    </div>
  );
}

function MessageContent({
  content,
  week,
  isChat = true,
  msgKey = "",
  executable = true,
}: {
  content: string;
  week: DaySummary[];
  isChat?: boolean;
  msgKey?: string;
  /** Whether ```log actions in this message should execute. False for messages
   *  loaded from history so reopening a past chat doesn't re-run logging. */
  executable?: boolean;
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
          // Only live chat messages execute; insights and history-loaded messages
          // render their actions inert so reopening a chat doesn't re-log.
          if (!isChat || !part.spec) return null;
          if (!executable) return <ActionRunner key={i} spec={part.spec} raw={part.raw} msgKey={msgKey} inert />;
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

/** Provenance pills under a coach reply — one per source the coach referenced
 *  (evidence guideline or data source), tappable to the source. */
function SourcePills({ content }: { content: string }) {
  const pills = detectSources(content);
  if (!pills.length) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 2 }}>
      {pills.map((p) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 11px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            color: "var(--breath)",
            background: "color-mix(in srgb, var(--breath) 14%, transparent)",
            border: "1px solid color-mix(in srgb, var(--breath) 30%, transparent)",
          }}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {p.label}
        </a>
      ))}
    </div>
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
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  // Voice input: record → /api/transcribe → drop text into the box for review.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Gate the starter suggestions until we've checked for an open question, so a
  // pending question doesn't flash behind the default suggestions.
  const [questionChecked, setQuestionChecked] = useState(false);
  // Conversation persistence + history.
  const [convId, setConvId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ConvMeta[]>([]);
  // Messages at index >= liveFromIndex were produced in this session and may
  // execute their actions; earlier ones (loaded from history) render inert.
  const [liveFromIndex, setLiveFromIndex] = useState(0);
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

  // Opening the coach raises any open proactive question first. Fast path: an
  // already-open question (e.g. tapped from the Daily card) is a local read, so
  // seed it immediately — no waiting on the slower evaluate (which hits Google
  // Health) and no flash of the default suggestions. Then evaluate in the
  // background to reconcile a stale one / create a new one.
  useEffect(() => {
    let cancelled = false;
    const seedIfOpen = (d: any) => {
      if (!cancelled && d?.open?.prompt) {
        setMessages((m) => (m.length === 0 ? [{ role: "assistant", content: d.open.prompt }] : m));
      }
    };
    (async () => {
      try {
        seedIfOpen(await fetch("/api/coach/questions").then((r) => r.json()));
      } catch {
        // best-effort
      }
      if (!cancelled) setQuestionChecked(true);
      try {
        await fetch("/api/coach/questions", { method: "POST" }).catch(() => {});
        seedIfOpen(await fetch("/api/coach/questions").then((r) => r.json()));
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function send() {
    void sendText(input);
  }

  async function sendText(raw: string) {
    const text = raw.trim();
    if (!text || streaming) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);
    const t0 = performance.now();
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
      const fellBackTo = res.headers.get("X-AI-Fallback");
      if (fellBackTo) setFallbackNote(`Primary model unavailable — using ${fellBackTo}.`);
      // Latency breakdown (open DevTools console). TTFT captures the gpt-5.5
      // reasoning gap that the server-side stream-open timing can't see.
      const ctxMs = res.headers.get("X-Context-Ms");
      const provMs = res.headers.get("X-Provider-Ms");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let ttft = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (!ttft && acc.trim()) {
          ttft = Math.round(performance.now() - t0);
          console.log(`[coach] context=${ctxMs}ms · provider-open=${provMs}ms · time-to-first-token=${ttft}ms`);
        }
        setMessages([...next, { role: "assistant", content: acc }]);
      }
      console.log(`[coach] total=${Math.round(performance.now() - t0)}ms`);
      // Persist the conversation (verbatim, incl. viz/log fences) so it can be
      // revisited or continued later. Save once the exchange is complete.
      persist([...next, { role: "assistant", content: acc }]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `⚠ ${e.message ?? e}` }]);
    } finally {
      setStreaming(false);
    }
  }

  // Hold-to-speak: press the mic to record, release to stop → transcribe →
  // send. (Press-and-hold rather than tap-toggle, like a walkie-talkie.)
  async function startRecording() {
    if (transcribing || streaming || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1200) return; // a too-short tap — ignore, nothing said
        setTranscribing(true);
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Transcription failed");
          if (json.text) await sendText(json.text); // send on release
        } catch (e: any) {
          setFallbackNote(`Voice: ${e.message ?? e}`);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setFallbackNote("Microphone unavailable — check browser permissions.");
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  async function persist(msgs: ChatMessage[]) {
    try {
      const saved = await fetch("/api/coach/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: convId, messages: msgs }),
      }).then((r) => r.json());
      if (saved?.id) setConvId(saved.id);
    } catch {
      // best-effort
    }
  }

  function newChat() {
    setMessages([]);
    setConvId(null);
    setLiveFromIndex(0);
    setHistoryOpen(false);
  }

  async function toggleHistory() {
    const open = !historyOpen;
    setHistoryOpen(open);
    if (open) {
      const d = await fetch("/api/coach/conversations").then((r) => r.json()).catch(() => ({}));
      setHistory(d.conversations ?? []);
    }
  }

  async function openConversation(id: string) {
    const c = await fetch(`/api/coach/conversations?id=${id}`).then((r) => r.json()).catch(() => null);
    if (c?.messages) {
      setMessages(c.messages);
      setConvId(c.id);
      setLiveFromIndex(c.messages.length); // loaded messages are inert (no re-logging)
    }
    setHistoryOpen(false);
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/coach/conversations?id=${id}`, { method: "DELETE" }).catch(() => {});
    setHistory((h) => h.filter((c) => c.id !== id));
    if (convId === id) newChat();
  }

  return (
    <main className="page" style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
      <Toast message={fallbackNote} onDone={() => setFallbackNote(null)} tone="warn" />
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 14, justifyContent: "space-between" }}>
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
          <div className="row" style={{ gap: 8, flex: "none" }}>
            <button className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5 }} onClick={newChat} title="Start a new chat">New</button>
            <button className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5 }} onClick={toggleHistory} title="Past conversations">History</button>
          </div>
        </div>

        {historyOpen && (
          <div className="card" style={{ marginTop: 12, padding: 8, maxHeight: 320, overflowY: "auto" }}>
            {history.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-soft)", padding: "8px 10px" }}>No saved conversations yet.</p>
            ) : (
              history.map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: "space-between", gap: 8, padding: "4px 2px" }}>
                  <button
                    onClick={() => openConversation(c.id)}
                    className="row"
                    style={{ flex: 1, minWidth: 0, gap: 8, padding: "8px 10px", borderRadius: 10, border: "none", background: convId === c.id ? "color-mix(in srgb, var(--breath) 12%, transparent)" : "transparent", color: "var(--ink)", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)", flex: "none" }}>{relativeTime(c.updatedAt)}</span>
                  </button>
                  <button aria-label="delete conversation" className="icon-btn" style={{ color: "var(--ink-faint)", flex: "none" }} onClick={() => deleteConversation(c.id)}>✕</button>
                </div>
              ))
            )}
          </div>
        )}
      </header>

      {/* Chat */}
      <section className="rise rise-2" style={{ marginTop: 4, flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-label" style={{ marginBottom: 10 }}>
          <span className="dot" style={{ background: "var(--breath)" }} />
          Ask your coach
        </div>
        <div className="stack" style={{ gap: 12, flex: 1 }}>
          {messages.length === 0 && questionChecked && (
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
                <>
                  <MessageContent content={m.content} week={weekData} msgKey={`m${i}`} executable={i >= liveFromIndex} />
                  <SourcePills content={m.content} />
                </>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <input
            className="field"
            placeholder={transcribing ? "Transcribing…" : recording ? "Listening — tap mic to stop" : "Ask about your health…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={recording || transcribing}
          />
          <button
            className="btn"
            aria-label="Hold to speak"
            title="Hold to speak (on-device transcription)"
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startRecording(); }}
            onPointerUp={(e) => { e.currentTarget.releasePointerCapture?.(e.pointerId); stopRecording(); }}
            onContextMenu={(e) => e.preventDefault()}
            disabled={transcribing || streaming}
            style={{
              flex: "none",
              padding: "12px 14px",
              background: recording ? "var(--heart)" : "var(--bg-inset)",
              color: recording ? "white" : "var(--ink-soft)",
              border: "1px solid var(--hairline)",
              touchAction: "none",
              transform: recording ? "scale(1.06)" : "none",
              transition: "transform 0.12s ease, background 0.12s ease",
            }}
          >
            {transcribing ? (
              <span className="pulsing" style={{ fontSize: 16, lineHeight: 1 }}>•••</span>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <line x1="12" y1="18" x2="12" y2="21" />
                <line x1="8.5" y1="21" x2="15.5" y2="21" />
              </svg>
            )}
          </button>
          <button className="btn" style={{ background: "var(--breath)", flex: "none", padding: "12px 18px" }} onClick={send} disabled={streaming || !input.trim()}>
            ↑
          </button>
        </div>
      </section>
    </main>
  );
}
