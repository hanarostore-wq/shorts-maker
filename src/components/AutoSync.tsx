"use client";

import { useEffect } from "react";

const SYNC_INTERVAL_MS = 60_000;
const LAST_DEPLOYMENT_KEY = "shorts-maker:last-deployment-uid";

export function AutoSync() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const syncPlatform = async (platform: string) => {
      const res = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      }).catch(() => null);
      if (!res || !res.ok) return;

      if (platform === "vercel") {
        const data = await res.json().catch(() => null);
        const deployment = data?.deployment;
        if (!deployment || deployment.state !== "READY") return;

        const lastUid = localStorage.getItem(LAST_DEPLOYMENT_KEY);
        if (lastUid === null) {
          // 처음 열었을 때는 새로고침 없이 기준만 기록한다.
          localStorage.setItem(LAST_DEPLOYMENT_KEY, deployment.uid);
          return;
        }
        if (lastUid !== deployment.uid) {
          localStorage.setItem(LAST_DEPLOYMENT_KEY, deployment.uid);
          window.location.reload();
        }
      }
    };

    const syncAll = async () => {
      try {
        const res = await fetch("/api/integrations/status");
        const status: Record<string, boolean> = await res.json();
        const platforms = Object.entries(status)
          .filter(([, connected]) => connected)
          .map(([platform]) => platform);

        await Promise.all(platforms.map(syncPlatform));
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
