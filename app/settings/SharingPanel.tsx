"use client";

// In-app Sharing surface (todo #24): the owner's control panel for who may DM
// the bot and exactly what each contact can see. Every visibility decision lives
// here; the bot enforces it server-side via filterForContact. Default-deny: a
// new contact shares nothing until scopes are enabled.

import { useCallback, useEffect, useState } from "react";

interface ScopeDef { key: string; label: string; category: string; leaderboardEligible: boolean }
interface ReportSub { id: string; cadence: "daily" | "weekly"; timeLocal: string; scopes: string[] }
interface Contact {
  id: string; name: string; phone?: string; status: string;
  telegramUserId?: number; preset?: string; scopes: string[];
  leaderboard: boolean; reports: ReportSub[]; expiresAt?: string;
  pairing?: { code: string; expiresAt: number };
}
interface AuditRow { at: string; contactName: string; digest: string; kind: string }
interface Payload {
  contacts: Contact[];
  catalog: ScopeDef[];
  presets: Record<string, string[]>;
  audit: AuditRow[];
  botToken: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  active: "var(--activity)", pending: "var(--food)", revoked: "var(--ink-faint)",
};
const CATEGORY_ORDER = ["activity", "nutrition", "clinical"] as const;
const CATEGORY_LABEL: Record<string, string> = { activity: "Activity", nutrition: "Nutrition", clinical: "Clinical" };

export default function SharingPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPreset, setNewPreset] = useState("custom");
  const [codes, setCodes] = useState<Record<string, string>>({});

  const load = useCallback(() => fetch("/api/telegram/contacts").then((r) => r.json()).then(setData).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>): Promise<Payload | null> {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/telegram/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setData(json);
      return json;
    } catch (e: any) { setErr(String(e.message ?? e)); return null; }
    finally { setBusy(false); }
  }

  if (!data) return <p className="pulsing" style={{ color: "var(--ink-soft)" }}>Loading…</p>;

  if (!data.botToken) {
    return (
      <section className="card rise rise-2">
        <div className="card-label">🔗 Sharing</div>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 10 }}>
          Configure and pair your Telegram bot first (Settings → Telegram). Sharing uses the same bot.
        </p>
      </section>
    );
  }

  const scopeCard = (c: Contact) => {
    const grouped = CATEGORY_ORDER.map((cat) => ({ cat, scopes: data.catalog.filter((s) => s.category === cat) }));
    return (
      <div className="stack" style={{ gap: 14, marginTop: 12 }}>
        {/* Preset */}
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Preset:</span>
          {(["trainer", "clinician", "friend"] as const).map((p) => (
            <button key={p} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", textTransform: "capitalize" }}
              disabled={busy}
              onClick={() => act({ action: "update", id: c.id, preset: p, scopes: data.presets[p] })}>
              {p}
            </button>
          ))}
        </div>

        {/* Per-scope toggles, grouped, default-deny */}
        {grouped.map(({ cat, scopes }) => (
          <div key={cat} className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {CATEGORY_LABEL[cat]}{cat === "clinical" ? " — sensitive" : ""}
            </span>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {scopes.map((s) => {
                const on = c.scopes.includes(s.key);
                return (
                  <button key={s.key}
                    className={on ? "btn" : "btn btn-ghost"}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    disabled={busy}
                    onClick={() => {
                      const next = on ? c.scopes.filter((k) => k !== s.key) : [...c.scopes, s.key];
                      act({ action: "update", id: c.id, scopes: next, preset: "custom" });
                    }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Leaderboard + expiry */}
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button className={c.leaderboard ? "btn" : "btn btn-ghost"} style={{ fontSize: 12, padding: "4px 10px" }}
            disabled={busy} onClick={() => act({ action: "update", id: c.id, leaderboard: !c.leaderboard })}>
            {c.leaderboard ? "✓ In leaderboard" : "Add to leaderboard"}
          </button>
          <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", gap: 6, alignItems: "center" }}>
            Expires
            <input type="date" className="prox-field" style={{ width: 150 }}
              value={c.expiresAt ? c.expiresAt.slice(0, 10) : ""}
              disabled={busy}
              onChange={(e) => act({ action: "update", id: c.id, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : "" })} />
          </label>
        </div>

        {/* Scheduled report */}
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className={c.reports.length ? "btn" : "btn btn-ghost"} style={{ fontSize: 12, padding: "4px 10px" }}
            disabled={busy || !c.scopes.length}
            onClick={() => act({
              action: "update", id: c.id,
              reports: c.reports.length ? [] : [{ id: Math.random().toString(36).slice(2), cadence: "daily", timeLocal: "07:00", scopes: c.scopes }],
            })}>
            {c.reports.length ? "✓ Daily report" : "Schedule daily report"}
          </button>
          {c.reports.length > 0 && (
            <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", gap: 6, alignItems: "center" }}>
              at
              <input type="time" className="prox-field" style={{ width: 110 }}
                value={c.reports[0].timeLocal} disabled={busy}
                onChange={(e) => act({ action: "update", id: c.id, reports: [{ ...c.reports[0], timeLocal: e.target.value, scopes: c.scopes }] })} />
            </label>
          )}
          {!c.scopes.length && <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>enable a scope first</span>}
        </div>

        {/* Pairing / binding */}
        <div className="stack" style={{ gap: 6, background: "var(--bg-inset)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--hairline)" }}>
          {c.status === "active" && c.telegramUserId ? (
            <span style={{ fontSize: 12.5, color: "var(--activity)" }}>✅ Connected (Telegram id {c.telegramUserId})</span>
          ) : codes[c.id] ? (
            <>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Ask them to open your bot and send (valid 24h):</span>
              <code style={{ fontSize: 14, fontWeight: 700, color: "var(--activity)" }}>/start {codes[c.id]}</code>
              <button className="btn btn-ghost" style={{ fontSize: 12, alignSelf: "flex-start", marginTop: 4 }} disabled={busy} onClick={load}>
                They’ve sent it — refresh
              </button>
            </>
          ) : (
            <button className="btn" style={{ fontSize: 12, alignSelf: "flex-start" }} disabled={busy}
              onClick={async () => { const r = await act({ action: "pair", id: c.id }); if ((r as any)?.pairing) setCodes((m) => ({ ...m, [c.id]: (r as any).pairing.code })); }}>
              Generate invite code
            </button>
          )}
        </div>

        {/* Danger zone */}
        <div className="row" style={{ gap: 8 }}>
          {c.status === "active" && (
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--heart)" }} disabled={busy} onClick={() => act({ action: "revoke", id: c.id })}>
              Revoke access
            </button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--heart)" }} disabled={busy}
            onClick={() => { if (confirm(`Delete ${c.name}? This removes the contact and stops all sharing.`)) act({ action: "delete", id: c.id }); }}>
            Delete
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card rise rise-2">
        <div className="card-label" style={{ marginBottom: 8 }}>🔗 Shared contacts</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14, lineHeight: 1.5 }}>
          Share selected metrics with specific people through your bot. Each contact is <b>read-only</b> and sees
          <b> only</b> what you enable here — nothing by default. They must pair with a one-time code, and you can
          revoke anytime. Telegram isn’t end-to-end encrypted; avoid sharing what you wouldn’t put in a normal chat.
        </p>

        {/* Add contact */}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <input placeholder="Contact name" value={newName} onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 140, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--bg-inset)", color: "var(--ink)", fontSize: 13.5 }} />
          <select className="prox-field" style={{ width: 130, border: "1px solid var(--hairline)", borderRadius: 10, padding: "9px 10px" }}
            value={newPreset} onChange={(e) => setNewPreset(e.target.value)}>
            <option value="custom">Custom (none)</option>
            <option value="trainer">Trainer</option>
            <option value="clinician">Clinician</option>
            <option value="friend">Friend/family</option>
          </select>
          <button className="btn" disabled={busy || !newName.trim()}
            onClick={async () => { if (await act({ action: "create", name: newName, preset: newPreset })) { setNewName(""); setNewPreset("custom"); } }}>
            Add
          </button>
        </div>

        {data.contacts.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>No contacts yet.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {data.contacts.map((c) => (
              <div key={c.id} style={{ background: "var(--bg-inset)", borderRadius: 14, border: "1px solid var(--hairline)", padding: "12px 16px" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                      {c.scopes.length} scope{c.scopes.length === 1 ? "" : "s"}{c.leaderboard ? " · leaderboard" : ""}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[c.status] ?? "var(--ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {c.status}
                  </span>
                </div>
                {open === c.id && scopeCard(c)}
              </div>
            ))}
          </div>
        )}
        {err && <p style={{ fontSize: 12.5, color: "var(--heart)", marginTop: 12 }}>{err}</p>}
      </section>

      {/* Audit trail */}
      {data.audit.length > 0 && (
        <section className="card rise rise-3">
          <div className="card-label" style={{ marginBottom: 8 }}>📜 Share log</div>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>Every metric sent to a contact, newest first (scope labels only, never values).</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-soft)" }}>
            {data.audit.map((a, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <b style={{ color: "var(--ink)" }}>{a.contactName}</b> · {a.digest} <span style={{ opacity: 0.6 }}>· {a.kind} · {new Date(a.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
