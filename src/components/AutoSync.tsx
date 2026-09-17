"use client";

import { useEffect } from "react";

const SYNC_INTERVAL_MS = 60_000;

export function AutoSync() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const syncAll = async () => {
      try {
        const res = await fetch("/api/integrations/status");
        const status: Record<string, boolean> = await res.json();
        const platforms = Object.entries(status)
          .filter(([, connected]) => connected)
          .map(([platform]) => platform);

        await Promise.all(
          platforms.map((platform) =>
            fetch("/api/integrations/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ platform }),
            }).catch(() => null),
          ),
        );
      } catch {
        // 다음 주기에 재시도
      }
    };

    if (!cancelled) syncAll();
    timer = setInterval(syncAll, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
