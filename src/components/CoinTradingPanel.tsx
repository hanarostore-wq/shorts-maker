"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent } from "@/lib/types";

type MarketData = { ok: boolean; market: string; price?: number; indicators?: { sma5: number | null; sma20: number | null; rsi14: number | null }; error?: string };

const roleText: Record<string, string> = {
  c1: "GPT·로컬AI 전략 연구",
  c2: "JEV 초고속 현물 신호 판단",
  c3: "Python 지표·손익 계산",
  c4: "호가·스프레드 감시",
  c5: "보유 코인·미체결 주문 관리",
  c6: "일일 손실·포지션 한도 차단",
  c7: "실제 주문 없는 체결 시뮬레이션",
  c8: "업비트 시세·주문 API 연결",
  c9: "실거래 전환 승인",
  c10: "최종 통제·긴급정지",
};

export function CoinTradingPanel({ agent }: { agent: Agent }) {
  const [market, setMarket] = useState("KRW-BTC");
  const [data, setData] = useState<MarketData | null>(null);
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [message, setMessage] = useState("시세 조회 대기");

  const load = useCallback(async () => {
    setMessage("업비트 공개 시세 조회 중...");
    try {
      const response = await fetch(`/api/coin/market?market=${encodeURIComponent(market)}`, { cache: "no-store" });
      const result = (await response.json()) as MarketData;
      setData(result);
      setMessage(result.ok ? "공개 시세 연결 정상" : result.error || "시세 조회 실패");
    } catch (error) {
      setMessage(`시세 조회 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  }, [market]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 10000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  const simulate = (side: "매수" | "매도") => {
    if (mode === "live") {
      setMessage("실제 주문 차단: 서버의 실거래 활성화와 블랙 승인 토큰이 필요합니다");
      return;
    }
    setMessage(`모의 ${side} 주문 접수: 리스크 관문 통과 후 체결 시뮬레이션`);
  };

  return (
    <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="font-bold text-zinc-100">업비트 현물 단타 관제</span>
        <span className={mode === "paper" ? "text-amber-400" : "text-red-400"}>{mode === "paper" ? "모의주문" : "실제주문"}</span>
      </div>
      <div className="text-zinc-500">현재 직원 임무: <span className="text-zinc-300">{roleText[agent.id] || agent.task}</span></div>
      <div className="flex gap-2">
        <input value={market} onChange={(e) => setMarket(e.target.value.toUpperCase())} className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-1 text-zinc-200" />
        <button onClick={() => void load()} className="border border-zinc-600 px-2 text-zinc-300">조회</button>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setMode("paper")} className={`border px-2 py-1 ${mode === "paper" ? "border-amber-500 text-amber-400" : "border-zinc-700 text-zinc-500"}`}>모의주문</button>
        <button onClick={() => setMode("live")} className={`border px-2 py-1 ${mode === "live" ? "border-red-500 text-red-400" : "border-zinc-700 text-zinc-500"}`}>실제주문</button>
      </div>
      {data?.ok ? <div className="grid grid-cols-2 gap-2 border border-zinc-800 p-2 text-zinc-300"><div>현재가 {data.price?.toLocaleString()}원</div><div>RSI14 {data.indicators?.rsi14?.toFixed(2) ?? "-"}</div><div>SMA5 {data.indicators?.sma5?.toFixed(2) ?? "-"}</div><div>SMA20 {data.indicators?.sma20?.toFixed(2) ?? "-"}</div></div> : null}
      <div className="flex gap-2"><button onClick={() => simulate("매수")} className="flex-1 border border-emerald-700 px-2 py-1 text-emerald-400">매수 시뮬레이션</button><button onClick={() => simulate("매도")} className="flex-1 border border-sky-700 px-2 py-1 text-sky-400">매도 시뮬레이션</button></div>
      <div className={message.includes("오류") || message.includes("차단") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
      <div className="text-[10px] text-zinc-600">실제 주문은 기본 차단 상태이며, 리스크 관문·API 인증·블랙 승인 없이는 업비트 주문 API를 호출하지 않습니다.</div>
    </div>
  );
}
