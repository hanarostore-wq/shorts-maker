"use client";

import { useState } from "react";

interface VerifyResponse {
  valid: boolean;
  plan: string;
  expiresAt: string | null;
  reason: string | null;
}

const REASON_TEXT: Record<string, string> = {
  malformed: "키 형식이 올바르지 않습니다. 대시(-)까지 그대로 붙여넣어 주세요.",
  not_found: "등록되지 않은 키입니다.",
  revoked: "회수된 키입니다.",
  expired: "이용 기간이 끝난 키입니다.",
  device_limit: "등록 가능한 기기 수를 넘었습니다. 기기 해제를 요청해 주세요.",
  storage_unavailable: "지금은 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

export function LicenseChecker() {
  const [key, setKey] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const res = await fetch("/api/license/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 확인 전용 조회라 기기를 새로 등록하지 않도록 고정된 id를 쓴다.
        body: JSON.stringify({ key, deviceId: "web-check" }),
      });
      setResult(await res.json());
    } catch {
      setResult({ valid: false, plan: "free", expiresAt: null, reason: "storage_unavailable" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="SM-PRO-XXXX-XXXX-XXXX"
          className="min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-zinc-500"
        />
        <button
          onClick={check}
          disabled={checking || key.trim().length === 0}
          className="border border-zinc-600 px-3 py-1.5 text-[12px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-40"
        >
          {checking ? "확인 중..." : "확인"}
        </button>
      </div>
      {result && (
        <p className={`text-[11px] ${result.valid ? "text-emerald-400" : "text-rose-400"}`}>
          {result.valid
            ? `✅ ${result.plan === "lifetime" ? "평생 이용권" : "프로"} · ${
                result.expiresAt
                  ? `${new Date(result.expiresAt).toLocaleDateString("ko-KR")}까지`
                  : "만료 없음"
              }`
            : `❌ ${REASON_TEXT[result.reason ?? ""] ?? "확인하지 못했습니다."}`}
        </p>
      )}
    </div>
  );
}
