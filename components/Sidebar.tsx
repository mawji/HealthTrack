"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navItems";
import Logo from "./Logo";

/** Desktop sidebar — Apple-Health-style category list with colored icons. */
export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="wordmark">
        <Logo size={22} />
        <div>
          Health<span>Track</span>
        </div>
      </div>
      {NAV_ITEMS.map((t) => (
        <Link key={t.href} href={t.href} className={`side-link ${pathname === t.href ? "active" : ""}`}>
          <span
            className="side-icon"
            style={{
              background: `color-mix(in srgb, ${t.color} 18%, transparent)`,
              color: t.color,
            }}
          >
            {t.icon}
          </span>
          {t.label}
        </Link>
      ))}
      <div className="side-foot">
        <Link href="/settings" className={`side-link ${pathname === "/settings" ? "active" : ""}`}>
          <span className="side-icon" style={{ background: "color-mix(in srgb, var(--ink) 9%, transparent)", color: "var(--ink-soft)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
            </svg>
          </span>
          Settings
        </Link>
        <span style={{ fontSize: 11, color: "var(--ink-faint)", padding: "0 10px" }}>local · private</span>
      </div>
    </aside>
  );
}
