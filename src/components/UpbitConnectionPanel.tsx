"use client";

import { useEffect, useState } from "react";

type CredentialState = { ok: boolean; configured?: boolean; error?: string };

type TestResult = {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  accountCount?: number;
  credentialsPersisted?: boolean;
};

export function UpbitConnectionPanel() {
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [message, setMessage] = useState("서버 저장 상태 확인 중...");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/coin/credentials", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as CredentialState;
        if (!response.ok || !result.ok) throw new Error(result.error || "[CREDENTIAL_STATUS_ERROR] 업비트 키 저장 상태 조회가 실패했습니다");
        if (!active) return;
        setSaved(Boolean(result.configured));
        setMessage(result.configured ? "서버 Redis에 암호화 저장된 업비트 키가 있습니다" : "API 키 입력 대기");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "[CREDENTIAL_STATUS_ERROR] 업비트 키 저장 상태를 확인하지 못했습니다");
      });
    return () => { active = false; };
  }, []);

  const test = async () => {
    setBusy(true);
    setMessage("업비트 잔고 조회로 API 연결 검증 중...");
    try {
      const response = await fetch("/api/coin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey, secretKey }),
      });
      const result = await response.json() as TestResult;
      const code = result.code || (response.ok ? "UPBIT_CONNECTION_UNKNOWN" : "UPBIT_CONNECTION_HTTP_ERROR");
      const detail = String(result.error || "업비트 연결 오류: 상세 오류가 없습니다");
      const cleanDetail = detail.replace(new RegExp(`^\\[?${code}\\]?[: ]*`), "").trim();
      if (!response.ok || !result.ok) {
        setSaved(false);
        setMessage(`[${code}] ${cleanDetail}`);
        return;
      }
      setSaved(Boolean(result.credentialsPersisted));
      setMessage(`${result.message || "업비트 API 연결 정상"} · 통화 ${result.accountCount ?? 0}개`);
    } catch (error) {
      setMessage(`[UPBIT_CONNECTION_REQUEST_ERROR] 업비트 연결 테스트·저장 요청 단계에서 실패했습니다: ${error instanceof Error ? error.message : "원인 미상"}`);
    } finally {
      setBusy(false);
    }
  };

  const hasError = message.startsWith("[") || message.includes("오류") || message.includes("실패");
  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">업비트 API 연결</span><span className={saved ? "text-emerald-400" : "text-amber-400"}>{saved ? "암호화 저장됨" : "저장 대기"}</span></div>
    <p className="text-zinc-500">연결 성공 후 키는 서버 Redis에 AES-256-GCM으로 암호화 저장됩니다. 화면·응답·로그에는 비밀키를 다시 표시하지 않습니다.</p>
    <input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Access Key" autoComplete="off" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" />
    <input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Secret Key" type="password" autoComplete="new-password" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" />
    <button disabled={busy} onClick={() => void test()} className="border border-emerald-700 px-3 py-2 text-emerald-400 disabled:text-zinc-600">{busy ? "연결 확인·저장 중..." : "API 연결 테스트·저장"}</button>
    <div className={hasError ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
    <p className="text-[10px] text-zinc-600">저장에는 공유 Redis와 COIN_CREDENTIALS_ENCRYPTION_KEY 환경변수가 필요합니다. 출금 권한은 허용하지 마세요.</p>
  </div>;
}
