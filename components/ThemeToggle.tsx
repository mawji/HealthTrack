"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "sidelink" }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ht-theme", next);
    } catch {
      // private browsing — theme just won't persist
    }
    setTheme(next);
  }

  const icon =
    theme === "dark" ? (
      // sun — switch to light
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
      </svg>
    ) : (
      // moon — switch to dark
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
      </svg>
    );

  // Sidebar variant: a side-link row matching the Settings entry below it.
  if (variant === "sidelink") {
    return (
      <button className="side-link" onClick={toggle} aria-label="toggle theme">
        <span className="side-icon" style={{ background: "color-mix(in srgb, var(--ink) 9%, transparent)", color: "var(--ink-soft)" }}>
          {icon}
        </span>
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <button className="icon-btn" onClick={toggle} aria-label="toggle theme" title="Toggle light/dark">
      {icon}
    </button>
  );
}
