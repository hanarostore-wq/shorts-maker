"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent } from "@/lib/types";

type MarketData = { ok: boolean; market: string; price?: number; indicators?: { sma5: number | null; sma20: number | null; rsi14: number | null; signal?: string }; candles?: Array<{ trade_price: number }>; orderbook?: { totalAskSize: number; totalBidSize: number; units: Array<{ ask_price: number; bid_price: number; ask_size: number; bid_size: number }> }; error?: string };

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

  const submitOrder = async (side: "buy" | "sell") => {
    setMessage(`${mode === "paper" ? "모의" : "실제"} ${side === "buy" ? "매수" : "매도"} 주문 리스크 검사 중...`);
    try {
      const response = await fetch("/api/coin/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, side, market, price: data?.price || 0, orderKrw: 5000, volume: 0, krwBalance: 100000, coinBalance: 0, dailyPnl: 0, spreadBps: 0, websocketHealthy: Boolean(data?.ok), hasOpenOrder: false }) });
      const result = await response.json();
      setMessage(result.ok ? result.message : result.error || "주문 오류: 서버가 상세 오류를 반환하지 않았습니다");
    } catch (error) {
      setMessage(`주문 연결 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
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
      {data?.ok ? <>
        <div className="grid grid-cols-2 gap-2 border border-zinc-800 p-2 text-zinc-300"><div>현재가 {data.price?.toLocaleString()}원</div><div>RSI14 {data.indicators?.rsi14?.toFixed(2) ?? "-"}</div><div>SMA5 {data.indicators?.sma5?.toFixed(2) ?? "-"}</div><div>SMA20 {data.indicators?.sma20?.toFixed(2) ?? "-"}</div><div className={data.indicators?.signal === "golden_cross" ? "text-emerald-400" : data.indicators?.signal === "dead_cross" ? "text-red-400" : "text-zinc-500"}>{data.indicators?.signal === "golden_cross" ? "골든크로스" : data.indicators?.signal === "dead_cross" ? "데드크로스" : "교차 없음"}</div></div>
        <div className="border border-zinc-800 p-2"><div className="mb-1 text-zinc-500">1분봉 차트 · 종가</div><svg viewBox="0 0 300 80" className="h-20 w-full" preserveAspectRatio="none"><polyline fill="none" stroke="#10b981" strokeWidth="1.5" points={(data.candles || []).slice().reverse().map((candle, index, values) => `${(index / Math.max(values.length - 1, 1)) * 300},${80 - ((Number(candle.trade_price) - Math.min(...values.map((v) => Number(v.trade_price)))) / Math.max(Math.max(...values.map((v) => Number(v.trade_price))) - Math.min(...values.map((v) => Number(v.trade_price))), 1)) * 70}`).join(" ")} /></svg></div>
        <div className="border border-zinc-800 p-2"><div className="mb-1 text-zinc-500">실시간 호가창 · 매도 / 매수</div>{data.orderbook?.units.slice(0, 5).map((unit, index) => <div key={`${unit.ask_price}-${index}`} className="grid grid-cols-2 gap-2 text-[10px]"><span className="text-red-300">매도 {unit.ask_price.toLocaleString()} · {unit.ask_size.toFixed(4)}</span><span className="text-emerald-300">매수 {unit.bid_price.toLocaleString()} · {unit.bid_size.toFixed(4)}</span></div>)}</div>
      </> : null}
      <div className="flex gap-2"><button onClick={() => void submitOrder("buy")} className="flex-1 border border-emerald-700 px-2 py-1 text-emerald-400">{mode === "paper" ? "매수 시뮬레이션" : "실제 매수 검사"}</button><button onClick={() => void submitOrder("sell")} className="flex-1 border border-sky-700 px-2 py-1 text-sky-400">{mode === "paper" ? "매도 시뮬레이션" : "실제 매도 검사"}</button></div>
      <div className={message.includes("오류") || message.includes("차단") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
      <div className="text-[10px] text-zinc-600">실제 주문은 기본 차단 상태이며, 리스크 관문·API 인증·블랙 승인 없이는 업비트 주문 API를 호출하지 않습니다.</div>
    </div>
  );
}
