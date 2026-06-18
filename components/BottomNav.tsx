"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navItems";

export default function BottomNav() {
  const pathname = usePathname();
  // Records, Goals and Journal live in the avatar menu on mobile to keep the bar uncramped.
  const HIDDEN = new Set(["/records", "/goals", "/journal"]);
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.filter((t) => !HIDDEN.has(t.href)).map((t) => (
        <Link key={t.href} href={t.href} className={pathname === t.href ? "active" : ""}>
          {t.icon}
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
