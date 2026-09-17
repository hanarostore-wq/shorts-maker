"use client";

import { useEffect, useState } from "react";

interface Status {
  naver: boolean;
  coupang: boolean;
}

export function IntegrationPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/integrations/status")
      .then((res) => res.json())
      .then(setStatus);
  }, []);

  const sync = async (platform: "naver" | "coupang") => {
    setLoading(platform);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(`❌ ${platform === "naver" ? "스마트스토어" : "쿠팡"} 오류: ${data.error}`);
      } else {
        setResult(`✅ ${platform === "naver" ? "스마트스토어" : "쿠팡"} 상품 ${data.count}건 조회 완료`);
      }
    } catch {
      setResult(`❌ ${platform === "naver" ? "스마트스토어" : "쿠팡"} 요청 자체가 실패했습니다`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-2 border-zinc-700 bg-zinc-950 p-3">
      <span className="text-sm font-bold text-zinc-300">스토어 연동 상태</span>
      <div className="flex flex-wrap items-center gap-3">
        <StatusRow
          label="스마트스토어"
          connected={status?.naver ?? null}
          onSync={() => sync("naver")}
          loading={loading === "naver"}
        />
        <StatusRow
          label="쿠팡"
          connected={status?.coupang ?? null}
          onSync={() => sync("coupang")}
          loading={loading === "coupang"}
        />
      </div>
      {result && <span className="text-[11px] text-zinc-400">{result}</span>}
    </div>
  );
}

function StatusRow({
  label,
  connected,
  onSync,
  loading,
}: {
  label: string;
  connected: boolean | null;
  onSync: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border border-zinc-800 bg-zinc-900 px-2 py-1">
      <span
        className={`h-1.5 w-1.5 ${
          connected === null
            ? "bg-zinc-600"
            : connected
              ? "bg-emerald-400"
              : "bg-rose-500"
        }`}
      />
      <span className="text-[11px] font-bold text-zinc-200">{label}</span>
      <span className="text-[10px] text-zinc-500">
        {connected === null ? "확인 중" : connected ? "키 등록됨" : "키 미등록"}
      </span>
      <button
        onClick={onSync}
        disabled={!connected || loading}
        className="border border-emerald-600 px-2 py-0.5 text-[10px] font-bold text-emerald-400 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
      >
        {loading ? "조회 중..." : "지금 조회"}
      </button>
    </div>
  );
}
