"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  const [user, setUser] = useState<{ name: string; picture: string }>({ name: "", picture: "" });

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then(setUser).catch(() => {});
  }, []);

  const initial = (user.name || "S").slice(0, 1).toUpperCase();

  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        aria-label="profile menu"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 44,
          height: 40,
          border: "none",
          padding: 0,
          cursor: "pointer",
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
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, label, icon, onClick }: { href: string; label: string; icon: React.ReactNode; onClick: () => void }) {
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
    </Link>
  );
}
