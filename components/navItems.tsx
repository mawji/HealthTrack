// Shared nav definition for the desktop sidebar and mobile bottom bar.
export const NAV_ITEMS = [
  {
    href: "/",
    label: "Daily",
    color: "var(--heart)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v4.5l3 2" />
      </svg>
    ),
  },
  {
    href: "/fitness",
    label: "Fitness",
    color: "var(--food)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 8.5l8 8" />
        <rect x="2.5" y="9" width="3.4" height="6" rx="1.2" transform="rotate(-45 4.2 12)" />
        <rect x="5.6" y="6.6" width="3.4" height="8.5" rx="1.2" transform="rotate(-45 7.3 10.8)" />
        <rect x="15" y="8.9" width="3.4" height="8.5" rx="1.2" transform="rotate(-45 16.7 13.2)" />
        <rect x="18.1" y="9" width="3.4" height="6" rx="1.2" transform="rotate(-45 19.8 12)" />
      </svg>
    ),
  },
  {
    href: "/trends",
    label: "Trends",
    color: "var(--activity)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l4.5-5.5 3.5 3 4-6L20 12" />
        <path d="M4 21h16" />
      </svg>
    ),
  },
  {
    href: "/food",
    label: "Food",
    color: "var(--food)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M7 3v7a2.5 2.5 0 0 0 5 0V3" />
        <path d="M9.5 3v18" />
        <path d="M17 3c-1.7 1.5-2.5 4-2.5 6.5 0 2 1 3 2.5 3v8.5" />
      </svg>
    ),
  },
  {
    href: "/coach",
    label: "Coach",
    color: "var(--breath)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-4.6-9.2-9C1.2 8.6 3 5 6.5 5c2 0 3.4 1 4.5 2.5h2C14.1 6 15.5 5 17.5 5 21 5 22.8 8.6 21.2 12 19 16.4 12 21 12 21z" />
        <path d="M7 12h2.5l1.5-2.5 2 4 1.5-1.5H17" />
      </svg>
    ),
  },
  {
    href: "/records",
    label: "Records",
    color: "var(--sleep)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v4h4" />
        <path d="M9.5 13h5M9.5 16.5h5" />
      </svg>
    ),
  },
];
