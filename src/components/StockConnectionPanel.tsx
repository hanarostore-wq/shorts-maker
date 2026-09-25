"use client";

import { useEffect, useState } from "react";

type CredentialState = { ok?: boolean; configured?: boolean; error?: string; code?: string };
type SaveResult = { ok?: boolean; configured?: boolean; message?: string; error?: string; code?: string };

export function StockConnectionPanel() {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [message, setMessage] = useState("서버 저장 상태 확인 중...");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/stock/credentials", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as CredentialState;
        if (!response.ok || !result.ok) throw new Error(result.error || "[NAMUH_CREDENTIAL_STATUS_ERROR] 나무플러그 키 저장 상태 조회가 실패했습니다");
        if (!active) return;
        setSaved(Boolean(result.configured));
        setMessage(result.configured ? "서버 Redis에 암호화 저장된 나무플러그 인증키가 있습니다" : "API 키 입력 대기");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "[NAMUH_CREDENTIAL_STATUS_ERROR] 나무플러그 키 저장 상태를 확인하지 못했습니다");
      });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage("나무플러그 인증키 암호화 저장 중...");
    try {
      const response = await fetch("/api/stock/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appKey, appSecret }),
      });
      const result = await response.json() as SaveResult;
      const code = result.code || (response.ok ? "NAMUH_CREDENTIAL_SAVE_UNKNOWN" : "NAMUH_CREDENTIAL_SAVE_HTTP_ERROR");
      if (!response.ok || !result.ok) {
        setSaved(false);
        setMessage(`[${code}] ${result.error || "나무플러그 인증키 저장에 실패했습니다"}`);
        return;
      }
      setSaved(true);
      setAppKey("");
      setAppSecret("");
      setMessage(result.message || "나무플러그 인증키 암호화 저장 완료");
    } catch (error) {
      setMessage(`[NAMUH_CREDENTIAL_SAVE_REQUEST_ERROR] 저장 요청 단계에서 실패했습니다: ${error instanceof Error ? error.message : "원인 미상"}`);
    } finally {
      setBusy(false);
    }
  };

  const hasError = message.startsWith("[") || message.includes("오류") || message.includes("실패");
  return (
    <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="font-bold text-zinc-100">나무플러그 API 연결</span>
        <span className={saved ? "text-emerald-400" : "text-amber-400"}>{saved ? "암호화 저장됨" : "저장 대기"}</span>
      </div>
      <p className="text-zinc-500">App Key·App Secret은 서버 Redis에 AES-256-GCM으로 암호화 저장됩니다. 화면·응답·로그에는 비밀키를 다시 표시하지 않습니다.</p>
      <input value={appKey} onChange={(event) => setAppKey(event.target.value)} placeholder="APP KEY" autoComplete="off" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" />
      <input value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder="APP SECRET" type="password" autoComplete="new-password" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" />
      <button disabled={busy} onClick={() => void save()} className="border border-emerald-700 px-3 py-2 text-emerald-400 disabled:text-zinc-600">{busy ? "암호화 저장 중..." : "API 키 저장"}</button>
      <div className={hasError ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
      <p className="text-[10px] text-zinc-600">저장에는 공유 Redis와 STOCK_CREDENTIALS_ENCRYPTION_KEY(없으면 코인 암호화 키)가 필요합니다. 실제 시세·주문 연결은 별도 검증 단계입니다.</p>
    </div>
  );
}
