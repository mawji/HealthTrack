"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMedsAlert } from "./useMedsAlert";

/** The five logo bars, shared with Logo.tsx geometry (viewBox 0 0 56 50). */
const BARS = [
  { x: 0, y: 16.5, h: 17, c: "var(--sleep)" },
  { x: 11.5, y: 10, h: 30, c: "var(--breath)" },
  { x: 23, y: 0, h: 50, c: "var(--heart)" },
  { x: 34.5, y: 8.5, h: 33, c: "var(--activity)" },
  { x: 46, y: 15, h: 20, c: "var(--food)" },
];

/** Profile avatar with a small menu: Records (kept out of the mobile
 *  nav bar) and Settings. On mobile the avatar is the brand mark — the
 *  five vitals bars clip the Google profile photo, so the logo doubles
 *  as the profile picture (flat bars when no photo). Desktop keeps the
 *  classic circular photo; the 900px breakpoint swaps them via CSS. */
export default function AvatarMenu() {
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [user, setUser] = useState<{ name: string; picture: string }>({ name: "", picture: "" });
  const { lowCount } = useMedsAlert();

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then(setUser).catch(() => {});
  }, []);

  // Desktop reaches everything from the sidebar, so the avatar opens no menu —
  // it's just an account marker. Mobile keeps the dropdown.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const sync = () => { setIsDesktop(mq.matches); if (mq.matches) setOpen(false); };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const initial = (user.name || "S").slice(0, 1).toUpperCase();

  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        aria-label={isDesktop ? "profile" : "profile menu"}
        onClick={() => { if (!isDesktop) setOpen((o) => !o); }}
        style={{
          width: 44,
          height: 40,
          border: "none",
          padding: 0,
          cursor: isDesktop ? "default" : "pointer",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="avatar-bars" style={{ display: "flex", transform: "translateY(-4px)" }}>
          <svg width="42" height="37.5" viewBox="0 0 56 50" aria-hidden="true">
            <defs>
              <clipPath id="ht-avatar-bars">
                {BARS.map((b) => (
                  <rect key={b.x} x={b.x} y={b.y} width="10" height={b.h} rx="5" />
                ))}
              </clipPath>
            </defs>
            {user.picture ? (
              <g clipPath="url(#ht-avatar-bars)">
                <image href={user.picture} x="0" y="-3" width="56" height="56" preserveAspectRatio="xMidYMid slice" />
                {BARS.map((b) => (
                  <rect key={b.x} x={b.x} y={b.y} width="10" height={b.h} rx="5" fill={b.c} opacity="0.22" />
                ))}
              </g>
            ) : (
              BARS.map((b) => <rect key={b.x} x={b.x} y={b.y} width="10" height={b.h} rx="5" fill={b.c} />)
            )}
          </svg>
        </span>
        <span
          className="avatar-circle"
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid var(--hairline)",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 15,
            color: "var(--bg)",
            background: "linear-gradient(135deg, var(--breath), var(--sleep))",
          }}
        >
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.picture} alt={user.name || "profile"} width={38} height={38} style={{ objectFit: "cover" }} />
          ) : (
            initial
          )}
        </span>
        {lowCount > 0 && !isDesktop && (
          <span
            aria-label="medications running low"
            style={{
              position: "absolute",
              top: -1,
              right: -1,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: "var(--heart)",
              border: "2px solid var(--bg)",
            }}
          />
        )}
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setOpen(false)} />
          <div
            className="card"
            style={{
              position: "absolute",
              right: 0,
              top: 46,
              zIndex: 71,
              padding: 8,
              minWidth: 170,
              boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
            }}
          >
            {user.name && (
              <p style={{ fontSize: 12, color: "var(--ink-faint)", padding: "4px 10px 8px" }}>{user.name}</p>
            )}
            {/* On desktop these all live in the sidebar, so the menu hides them
                (mobile keeps them — the bottom bar has no room). */}
            <div className="mobile-only">
              <MenuLink href="/settings?tab=profile" label="Profile" onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
                </svg>
              } />
              <MenuLink href="/goals" label="Goals" onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.5" />
                </svg>
              } />
              <MenuLink href="/journal" label="Journal" onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5l1-3.6L15.4 5.5l2.6 2.6L7.6 18.5z" /><path d="M13.6 7.3l2.6 2.6" /><path d="M4 21h16" />
                </svg>
              } />
              <MenuLink href="/medications" label="Meds" badge={lowCount} onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-40 12 12)" /><path d="M8.6 8.4l7 7" />
                </svg>
              } />
              <MenuLink href="/memory" label="Memory" onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3.5a4.5 4.5 0 0 0-4 6.6 4 4 0 0 0 1 5.4V20h3v-2.5" />
                  <path d="M15 3.5a4.5 4.5 0 0 1 4 6.6 4 4 0 0 1-1 5.4V20h-3v-2.5" />
                  <path d="M12 4.5v12" />
                </svg>
              } />
              <MenuLink href="/records" label="Records" onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9.5 13h5M9.5 16.5h5" />
                </svg>
              } />
              <MenuLink href="/settings" label="Settings" onClick={() => setOpen(false)} icon={
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
                </svg>
              } />
              <a href="/guide.html" target="_blank" rel="noopener" onClick={() => setOpen(false)} className="row" style={{ gap: 9, padding: "9px 10px", borderRadius: 10, textDecoration: "none", color: "var(--ink)", fontSize: 13.5, fontWeight: 600 }}>
                <span style={{ color: "var(--ink-soft)", display: "flex" }}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.4 2.4 0 1 1 3.3 2.3c-.7.3-1.3.9-1.3 1.7v.4" /><circle cx="12" cy="16.6" r=".6" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                How to use
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, label, icon, onClick, badge = 0 }: { href: string; label: string; icon: React.ReactNode; onClick: () => void; badge?: number }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="row"
      style={{
        gap: 9,
        padding: "9px 10px",
        borderRadius: 10,
        textDecoration: "none",
        color: "var(--ink)",
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <span style={{ color: "var(--ink-soft)", display: "flex" }}>{icon}</span>
      {label}
      {badge > 0 && (
        <span
          style={{
            marginLeft: "auto",
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: "var(--heart)",
            color: "var(--bg)",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
