"use client";

import { useEffect, useRef, useState } from "react";

type Info = {
  current: string;
  latest: string | null;
  name: string | null;
  url: string | null;
  updateAvailable: boolean;
  canApply: boolean;
};

/** "Update available" banner (shown on Settings). Checks the latest GitHub
 *  release; in the Docker deployment, "Update now" asks Watchtower to pull +
 *  recreate the app, then reconnects to the new version. */
export default function UpdateBanner() {
  const [info, setInfo] = useState<Info | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "updating" | "timeout">("idle");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/update")
      .then((r) => r.json())
      .then((d: Info) => {
        setInfo(d);
        try {
          if (d.latest && localStorage.getItem("ht-update-dismissed") === d.latest) setDismissed(true);
        } catch {}
      })
      .catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  if (!info || !info.updateAvailable) return null;
  if (dismissed && phase === "idle") return null;

  function dismiss() {
    try { if (info?.latest) localStorage.setItem("ht-update-dismissed", info.latest); } catch {}
    setDismissed(true);
  }

  async function apply() {
    if (!info) return;
    const ok = window.confirm(
      `Update HealthTrack to ${info.latest}?\n\nThe app will back up your data, update, and reconnect in under a minute.`,
    );
    if (!ok) return;
    setPhase("updating");
    try { await fetch("/api/update", { method: "POST" }); } catch {}
    const started = Date.now();
    poll.current = setInterval(async () => {
      if (Date.now() - started > 150000) {
        if (poll.current) clearInterval(poll.current);
        setPhase("timeout");
        return;
      }
      try {
        const d: Info = await (await fetch("/api/update?force=1", { cache: "no-store" })).json();
        if (!d.updateAvailable) window.location.reload();
      } catch { /* app still restarting — keep polling */ }
    }, 4000);
  }

  const wrap: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 14, marginBottom: 20,
    padding: "13px 16px", borderRadius: 14, border: "1px solid var(--hairline)",
    borderLeft: "3px solid var(--activity)", background: "var(--bg-raised)",
    boxShadow: "var(--shadow)",
  };
  const btn: React.CSSProperties = {
    border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 13.5,
    cursor: "pointer", background: "var(--ink)", color: "var(--bg)", flex: "none",
  };

  if (phase === "updating") {
    return (
      <div style={wrap}>
        <span className="pulsing" style={{ fontSize: 20 }}>⟳</span>
        <div style={{ fontSize: 14 }}>
          <b>Updating to {info.latest}…</b>
          <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>Backing up, pulling, and restarting — this page will reconnect automatically.</div>
        </div>
      </div>
    );
  }

  if (phase === "timeout") {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 18 }}>⏳</span>
        <div style={{ fontSize: 14 }}>
          <b>Still finishing the update…</b>
          <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>It's taking longer than usual. Refresh in a moment, or check the container logs.</div>
        </div>
        <button style={btn} onClick={() => window.location.reload()}>Refresh</button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <span style={{ fontSize: 18 }} aria-hidden>✨</span>
      <div style={{ fontSize: 14, flex: 1 }}>
        <b>Update available — {info.latest}</b>
        <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>
          You're on {info.current}.{" "}
          {info.url && (
            <a href={info.url} target="_blank" rel="noopener" style={{ color: "var(--activity)" }}>What's new</a>
          )}
        </div>
        {!info.canApply && (
          <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-soft)" }}>
            To update, run: <code style={{ background: "var(--bg-inset)", padding: "1px 6px", borderRadius: 6 }}>docker compose pull &amp;&amp; docker compose up -d</code>
          </div>
        )}
      </div>
      {info.canApply && <button style={btn} onClick={apply}>Update now</button>}
      <button
        onClick={dismiss}
        aria-label="dismiss"
        style={{ border: "none", background: "transparent", color: "var(--ink-faint)", cursor: "pointer", fontSize: 18, flex: "none" }}
      >×</button>
    </div>
  );
}
