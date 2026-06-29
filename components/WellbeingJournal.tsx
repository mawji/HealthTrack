"use client";

// The Wellbeing tab on /journal — the read surface for the coach's background
// intelligence. Phase 1: shows the deterministic reflection narrative + audit
// scorecard, a "Run now" button, and the recent scratchpad notes (the raw trail
// behind a reflection). See plans/coach-background-intelligence.md.

import { useEffect, useState } from "react";

interface AuditDomain { domain: string; score: number; band: "good" | "ok" | "attention"; note: string }
interface Audit { at: string; scores: AuditDomain[]; topActions: string[] }
interface Entry { id: string; at: string; date: string; trigger: string; narrative: string; audit: Audit; signalCount: number; notesRolled: number }
interface Note { id: string; ts: string; source: string; note: string; tags?: string[] }
interface State {
  settings: { enabled: boolean; scheduleHour: number };
  latest: Entry | null;
  entries: Entry[];
  notes: Note[];
}

const BAND_COLOR: Record<string, string> = {
  good: "var(--good, #2e7d32)",
  ok: "var(--warn, #b08900)",
  attention: "var(--text-accent, #c1572f)",
};

/** Tiny Markdown renderer for our own narrow output (## / **bold** / _i_ / - li). */
function Markdown({ text }: { text: string }) {
  const inline = (s: string, key: number) => {
    // split on **bold** and _italic_ keeping delimiters
    const parts = s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).filter(Boolean);
    return (
      <span key={key}>
        {parts.map((p, i) =>
          p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> :
          p.startsWith("_") ? <em key={i}>{p.slice(1, -1)}</em> :
          <span key={i}>{p}</span>
        )}
      </span>
    );
  };
  const nodes: React.ReactNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) { nodes.push(<div key={i} style={{ height: 6 }} />); return; }
    if (line.startsWith("## ")) nodes.push(<h3 key={i} style={{ margin: "2px 0 6px", fontSize: 15 }}>{line.slice(3)}</h3>);
    else if (line.startsWith("- ")) nodes.push(<div key={i} style={{ paddingLeft: 14, textIndent: -8, fontSize: 13.5, lineHeight: 1.5 }}>• {inline(line.slice(2), i)}</div>);
    else nodes.push(<div key={i} style={{ fontSize: 13.5, lineHeight: 1.5 }}>{inline(line, i)}</div>);
  });
  return <>{nodes}</>;
}

export function WellbeingJournal() {
  const [state, setState] = useState<State | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const d = await fetch("/api/coach/wellbeing").then((r) => r.json()).catch(() => null);
    setState(d);
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  async function runNow() {
    setRunning(true);
    setMsg(null);
    try {
      const r = await fetch("/api/coach/wellbeing?trigger=manual", { method: "POST" }).then((res) => res.json()).catch(() => null);
      if (r?.ran) { setMsg("Reflection written."); await load(); }
      else setMsg(r?.reason ? `Skipped — ${r.reason}` : "Couldn't run right now.");
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return <p style={{ color: "var(--ink-soft)" }}>Loading…</p>;

  const latest = state?.latest ?? null;
  const audit = latest?.audit ?? null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: 0 }}>
          The coach's own view of how you're doing, refreshed in the background.
          {state?.settings && (
            <> Scheduled runs are <strong>{state.settings.enabled ? `on (~${String(state.settings.scheduleHour).padStart(2, "0")}:00)` : "off"}</strong>.</>
          )}
        </p>
        <button className="btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={runNow} disabled={running}>
          {running ? "Running…" : "Run now"}
        </button>
      </div>
      {msg && <p style={{ color: "var(--ink-soft)", fontSize: 12.5, margin: 0 }}>{msg}</p>}

      {!latest ? (
        <section className="card">
          <p style={{ color: "var(--ink-soft)" }}>
            No reflection yet. Press <strong>Run now</strong> to generate the first one from your recent data.
            {" "}(Needs a connected account — it won't draw conclusions from demo data.)
          </p>
        </section>
      ) : (
        <>
          {audit && (
            <section className="card">
              <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 10 }}>WELLBEING AUDIT</p>
              <div className="stack" style={{ gap: 9 }}>
                {audit.scores.map((d) => (
                  <div key={d.domain} className="row" style={{ alignItems: "center", gap: 10 }}>
                    <span style={{ width: 120, fontSize: 13, textTransform: "capitalize" }}>{d.domain}</span>
                    <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--line, rgba(127,127,127,0.18))", overflow: "hidden" }}>
                      <div style={{ width: `${d.score}%`, height: "100%", background: BAND_COLOR[d.band] }} />
                    </div>
                    <span style={{ width: 42, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: BAND_COLOR[d.band] }}>{d.score}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <Markdown text={latest.narrative} />
            <p style={{ color: "var(--ink-soft)", fontSize: 11.5, marginTop: 10 }}>
              {new Date(latest.at).toLocaleString()} · {latest.trigger} · {latest.signalCount} signal(s)
              {latest.notesRolled > 0 ? ` · ${latest.notesRolled} note(s) rolled in` : ""}
            </p>
          </section>

          {state && state.notes.length > 0 && (
            <section className="card">
              <button className="btn btn-ghost" style={{ padding: "4px 0", fontSize: 12.5 }} onClick={() => setShowNotes((v) => !v)}>
                {showNotes ? "▾" : "▸"} Raw notes the coach collected ({state.notes.length})
              </button>
              {showNotes && (
                <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                  {state.notes.map((n) => (
                    <div key={n.id} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <span style={{ color: "var(--ink-soft)" }}>{new Date(n.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {n.source}</span>
                      {" — "}{n.note}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {state && state.entries.length > 1 && (
            <section className="card">
              <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 10 }}>EARLIER REFLECTIONS</p>
              <div className="stack" style={{ gap: 14 }}>
                {state.entries.slice(1).map((e) => (
                  <details key={e.id}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>{e.date} — {e.signalCount} signal(s)</summary>
                    <div style={{ marginTop: 8 }}><Markdown text={e.narrative} /></div>
                  </details>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
