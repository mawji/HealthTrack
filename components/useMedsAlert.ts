"use client";

// Shared low-stock medication state for the nav badge. Polls the inventory
// endpoint, re-syncing on foreground and whenever a dose/supply changes
// (`ht-meds-changed`). Read-only — the meds page owns the actions.

import { useCallback, useEffect, useState } from "react";

export function useMedsAlert() {
  const [lowCount, setLowCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/medications/inventory").then((r) => r.json());
      setLowCount(d?.enabled ? (d.lowStock?.length ?? 0) : 0);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("ht-meds-changed", load);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("ht-meds-changed", load);
    };
  }, [load]);

  return { lowCount, refresh: load };
}
