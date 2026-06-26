"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navItems";
import { useOpenQuestion } from "./useOpenQuestion";

export default function BottomNav() {
  const pathname = usePathname();
  const { open } = useOpenQuestion();
  // Records, Goals, Journal and Memory live in the avatar menu on mobile to keep the bar uncramped.
  const HIDDEN = new Set(["/records", "/goals", "/journal", "/memory"]);
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.filter((t) => !HIDDEN.has(t.href)).map((t) => (
        <Link key={t.href} href={t.href} className={pathname === t.href ? "active" : ""} style={{ position: "relative" }}>
          {t.icon}
          {t.label}
          {open && t.href === "/coach" && <QuestionBadge top={5} right={12} />}
        </Link>
      ))}
    </nav>
  );
}

/** Small dot marking an open coach question on the Coach nav item. */
export function QuestionBadge({ top = 0, right = 0 }: { top?: number; right?: number }) {
  return (
    <span
      aria-label="a question from your coach"
      style={{
        position: "absolute",
        top, right,
        width: 9, height: 9,
        borderRadius: "50%",
        background: "var(--breath)",
        border: "2px solid var(--nav-bg)",
        boxShadow: "0 0 0 1px var(--breath)",
      }}
    />
  );
}
