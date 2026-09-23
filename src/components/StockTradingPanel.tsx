"use client";

import { useEffect, useState } from "react";
import type { Agent } from "@/lib/types";

const NH_PLUG_GUIDE = "https://www.nhplug.com/apiservice?group_id=be078217-0bf2-4bd3-8a6f-7d20e1dff90b&api_id=dba721ee-1584-4fde-8164-92c028dc760c";

const roleText: Record<string, string> = {
  t1: "GPT·로컬AI 전략 연구",
  t2: "JEV 초고속 국내주식 신호 판단",
  t3: "Python 지표·손익 계산",
  t4: "호가·스프레드 감시",
  t5: "보유 주식·미체결 주문 관리",
  t6: "일일 손실·포지션 한도 차단",
  t7: "실제 주문 없는 체결 시뮬레이션",
  t8: "나무플러그 시세·주문 API 연결",
  t9: "실거래 전환 승인",
  t10: "최종 통제·긴급정지",
};

export function StockTradingPanel({ agent }: { agent: Agent }) {
  const [symbol, setSymbol] = useState("005930");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("나무플러그 API 연결 대기");

  useEffect(() => {
    void fetch("/api/stock/credentials", { cache: "no-store" })
      .then(async (response) => await response.json() as { configured?: boolean })
      .then((result) => setSaved(Boolean(result.configured)))
      .catch(() => setSaved(false));
  }, []);

  const saveCredentials = async () => {
    setBusy(true);
    setMessage("나무플러그 App Key·App Secret 암호화 저장 중...");
    try {
      const response = await fetch("/api/stock/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appKey, appSecret }) });
      const result = await response.json() as { ok?: boolean; code?: string; message?: string; error?: string };
      if (!result.ok) throw new Error(`[${result.code || "NAMUH_CREDENTIAL_SAVE_ERROR"}] ${result.error || "저장에 실패했습니다"}`);
      setSaved(true);
      setAppKey("");
      setAppSecret("");
      setMessage(result.message || "나무플러그 인증키 암호화 저장 완료");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "[NAMUH_CREDENTIAL_SAVE_ERROR] 알 수 없는 저장 오류");
    } finally {
      setBusy(false);
    }
  };

  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">나무플러그 국내주식 단타 관제</span><span className={saved ? "text-emerald-400" : "text-amber-400"}>{saved ? "인증키 암호화 저장됨" : mode === "paper" ? "모의매매" : "실제주문"}</span></div>
    <div className="text-zinc-500">현재 직원 임무: <span className="text-zinc-300">{roleText[agent.id] || agent.task}</span></div>
    <div className="border border-zinc-800 p-2"><div className="mb-2 text-zinc-400">나무플러그 API 인증키</div><div className="grid gap-2"><input value={appKey} onChange={(event) => setAppKey(event.target.value)} placeholder="APP KEY" autoComplete="off" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" /><input value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder="APP SECRET" type="password" autoComplete="new-password" className="border border-zinc-700 bg-black px-2 py-2 text-zinc-200" /><button type="button" disabled={busy} onClick={() => void saveCredentials()} className="border border-emerald-700 px-2 py-2 text-emerald-400 disabled:text-zinc-600">{busy ? "암호화 저장 중..." : "API 키 저장"}</button></div><p className="mt-2 text-[10px] text-zinc-600">App Secret은 화면에 다시 표시하지 않고 공유 Redis에 암호화 저장합니다.</p></div>
    <div className="flex gap-2"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-1 text-zinc-200" placeholder="종목코드" /><button type="button" onClick={() => setMessage(saved ? `나무플러그 시세 조회 준비 완료 · ${symbol}` : "[NAMUH_CREDENTIAL_REQUIRED] 먼저 App Key·App Secret을 저장하세요")} className="border border-zinc-600 px-2 text-zinc-300">조회</button></div>
    <div className="flex gap-2"><button type="button" onClick={() => setMode("paper")} className={`border px-2 py-1 ${mode === "paper" ? "border-amber-500 text-amber-400" : "border-zinc-700 text-zinc-500"}`}>모의매매</button><button type="button" onClick={() => setMode("live")} className={`border px-2 py-1 ${mode === "live" ? "border-red-500 text-red-400" : "border-zinc-700 text-zinc-500"}`}>실제주문</button></div>
    <div className="grid grid-cols-2 gap-2 border border-zinc-800 p-2 text-zinc-400"><span>실시간 호가 API 대기</span><span>1분봉 API 대기</span><span>RSI·SMA 계산 대기</span><span>슬리피지 차단 대기</span><span>네트워크 지연 차단 대기</span><span>일일 손실한도 적용</span></div>
    <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setMessage(`모의매매 준비 완료 · ${symbol} · 실제 주문 미전송 · 리스크 관문 대기`)} className="border border-emerald-700 px-2 py-2 text-emerald-400">매수 시뮬레이션</button><button type="button" onClick={() => setMessage(`모의매매 준비 완료 · ${symbol} · 실제 주문 미전송 · 리스크 관문 대기`)} className="border border-sky-700 px-2 py-2 text-sky-400">매도 시뮬레이션</button></div>
    <a href={NH_PLUG_GUIDE} target="_blank" rel="noreferrer" className="border border-zinc-700 px-2 py-2 text-center text-zinc-400 hover:text-zinc-100">나무플러그 API 가이드 열기</a>
    <div className={message.includes("오류") || message.includes("필요") || message.includes("ERROR") || message.includes("[") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
    <p className="text-[10px] text-zinc-600">현재 단계는 인증키 저장까지입니다. 나무플러그 공식 API의 실제 시세·주문 엔드포인트 확인 전에는 주문을 전송하지 않습니다.</p>
  </div>;
}
