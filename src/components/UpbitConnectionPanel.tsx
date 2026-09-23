"use client";

import { useState } from "react";

export function UpbitConnectionPanel() {
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [message, setMessage] = useState("API 키 입력 대기");
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    setMessage("업비트 잔고 조회로 API 연결 검증 중...");
    try {
      const response = await fetch("/api/coin/test-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessKey, secretKey }) });
      const result = await response.json();
      setMessage(result.ok ? `${result.message} · 통화 ${result.accountCount}개` : result.error || "업비트 연결 오류: 상세 오류가 없습니다");
    } catch (error) {
      setMessage(`업비트 연결 요청 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally { setBusy(false); }
  };

  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">업비트 API 연결</span><span className="text-amber-400">키 저장 안 함</span></div>
    <p className="text-zinc-500">이 창은 입력한 키로 업비트 잔고 조회만 검증합니다. 키를 Redis·브라우저 저장소·로그에 저장하지 않습니다.</p>
    <input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Access Key" autoComplete="off" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" />
    <input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Secret Key" type="password" autoComplete="new-password" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" />
    <button disabled={busy} onClick={() => void test()} className="border border-emerald-700 px-3 py-2 text-emerald-400 disabled:text-zinc-600">{busy ? "연결 확인 중..." : "API 연결 테스트"}</button>
    <div className={message.includes("오류") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
    <p className="text-[10px] text-zinc-600">자동매매 서버에서 계속 사용하려면 Vercel 환경변수 UPBIT_ACCESS_KEY·UPBIT_SECRET_KEY에도 등록해야 합니다. 출금 권한은 허용하지 마세요.</p>
  </div>;
}
