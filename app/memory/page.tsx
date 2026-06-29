"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CoachMemory, CoachMemoryCategory } from "@/lib/types";

const CATEGORIES: { key: CoachMemoryCategory; label: string }[] = [
  { key: "preference", label: "Preference" },
  { key: "constraint", label: "Constraint" },
  { key: "condition", label: "Condition" },
  { key: "lifestyle", label: "Lifestyle" },
  { key: "goal", label: "Goal" },
  { key: "advice", label: "Advice" },
  { key: "pattern", label: "Pattern" },
  { key: "openness", label: "Openness" },
  { key: "boundary", label: "Boundary" },
  { key: "other", label: "Note" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<CoachMemoryCategory, string>;

const SOURCE_LABEL: Record<string, string> = {
  coach: "coach", user: "you", proactive: "from a question", derived: "noticed from data",
  reflection: "noticed in review",
};

export default function MemoryPage() {
  const router = useRouter();
  const [memories, setMemories] = useState<CoachMemory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newCat, setNewCat] = useState<CoachMemoryCategory>("preference");
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);

  // Manual "ask me something now" — force-create a question (bypasses the
  // evening window + once/day cap; keeps topic cooldowns + sensitive policy) and
  // open the coach to answer it. Lets the user build context fast.
  async function askMe() {
    setAsking(true);
    try {
      const r = await fetch("/api/coach/questions?force=1", { method: "POST" }).then((res) => res.json()).catch(() => null);
      if (r?.created || r?.open) {
        try { window.dispatchEvent(new Event("ht-question-changed")); } catch {}
        router.push("/coach");
      } else {
        alert("Nothing to ask right now — the coach already knows the easy topics, or one is on cooldown. Try again later.");
      }
    } finally {
      setAsking(false);
    }
  }

  const load = async () => {
    const d = await fetch("/api/coach/memory").then((r) => r.json()).catch(() => ({}));
    setMemories(d.memories ?? []);
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  async function add() {
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    try {
      await fetch("/api/coach/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, category: newCat, source: "user" }),
      });
      setNewText("");
      await load();
    } finally { setAdding(false); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch("/api/coach/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this memory? The coach will forget it.")) return;
    await fetch(`/api/coach/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  // Pinned first, then newest.
  const ordered = [...memories].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return (b.updatedAt < a.updatedAt ? -1 : 1);
  });

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Memory.</h1>
        <p className="page-sub">
          Durable facts your coach remembers about you — preferences, constraints, lifestyle, and goals.
          These travel with every conversation. You own them: edit, pin, or delete anything.
        </p>
        <button className="btn" style={{ marginTop: 12, padding: "8px 16px", fontSize: 13 }} disabled={asking} onClick={askMe}>
          {asking ? "Asking…" : "Have the coach ask me something"}
        </button>
      </header>

      {/* Add */}
      <section className="card rise rise-1" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 10 }}>
          <input
            className="field"
            value={newText}
            placeholder="e.g. Prefers morning workouts"
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <div className="row" style={{ gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
            <select className="field" value={newCat} onChange={(e) => setNewCat(e.target.value as CoachMemoryCategory)} style={{ flex: "0 1 auto" }}>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button className="btn" disabled={adding || !newText.trim()} onClick={add}>{adding ? "Adding…" : "Remember this"}</button>
          </div>
        </div>
      </section>

      {!loaded ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : ordered.length === 0 ? (
        <section className="card"><p style={{ color: "var(--ink-soft)" }}>
          Nothing yet. As you chat, the coach saves durable facts it learns — or add one above.
        </p></section>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {ordered.map((m) => (
            <MemoryRow
              key={m.id}
              m={m}
              editing={editing === m.id}
              onToggleEdit={() => setEditing(editing === m.id ? null : m.id)}
              onSave={(text, category) => { patch(m.id, { text, category }); setEditing(null); }}
              onPin={() => patch(m.id, { pinned: !m.pinned })}
              onDelete={() => remove(m.id)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function MemoryRow({ m, editing, onToggleEdit, onSave, onPin, onDelete }: {
  m: CoachMemory;
  editing: boolean;
  onToggleEdit: () => void;
  onSave: (text: string, category: CoachMemoryCategory) => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(m.text);
  const [cat, setCat] = useState<CoachMemoryCategory>(m.category);

  return (
    <section className="card" style={{ padding: "12px 16px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <input className="field" value={text} onChange={(e) => setText(e.target.value)} style={{ marginBottom: 8 }} />
          ) : (
            <p style={{ fontSize: 14.5, fontWeight: 600 }}>
              {m.pinned && <span title="pinned" style={{ marginRight: 6 }}>📌</span>}
              {m.text}
            </p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {editing ? (
              <select className="field" value={cat} onChange={(e) => setCat(e.target.value as CoachMemoryCategory)} style={{ padding: "4px 8px", fontSize: 12 }}>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            ) : (
              <span className="badge" style={{ background: "var(--breath-soft)", color: "var(--breath)", fontSize: 11 }}>{CAT_LABEL[m.category]}</span>
            )}
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{SOURCE_LABEL[m.source] ?? m.source}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flex: "none" }}>
          {editing ? (
            <button className="btn" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => onSave(text.trim() || m.text, cat)}>Save</button>
          ) : (
            <>
              <button className="icon-btn" aria-label={m.pinned ? "unpin" : "pin"} title={m.pinned ? "unpin" : "pin"} style={{ color: m.pinned ? "var(--food)" : "var(--ink-faint)" }} onClick={onPin}>📌</button>
              <button className="icon-btn" aria-label="edit" style={{ color: "var(--ink-faint)" }} onClick={onToggleEdit}>✎</button>
              <button className="icon-btn" aria-label="delete" style={{ color: "var(--ink-faint)" }} onClick={onDelete}>✕</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
