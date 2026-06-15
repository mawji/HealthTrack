"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navItems";

export default function BottomNav() {
  const pathname = usePathname();
  // Records lives in the avatar menu on mobile to keep the bar uncramped.
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.filter((t) => t.href !== "/records").map((t) => (
        <Link key={t.href} href={t.href} className={pathname === t.href ? "active" : ""}>
          {t.icon}
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
