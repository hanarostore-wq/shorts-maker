"use client";

import { useState } from "react";

export function CoinSimulationPanel() {
  const [rows, setRows] = useState<Array<{ tick: string; action: string; reason: string }>>([]);
  const [message, setMessage] = useState("테스트 대기");
  const run = async () => {
    setMessage("WebSocket 모의주문 테스트 데이터 확인 중...");
    try {
      const response = await fetch("/api/coin/market?market=KRW-BTC", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "실시간 시세를 받지 못했습니다");
      setRows((data.candles || []).slice(0, 10).map((candle: { trade_price: number }, index: number) => ({ tick: `${index + 1}틱`, action: index % 5 === 0 ? "매수 후보" : index % 7 === 0 ? "매도 후보" : "주문 차단", reason: index % 5 === 0 ? "RSI·SMA 조건 검토" : "조건 미충족 또는 리스크 차단" })));
      setMessage("모의 테스트 완료 · 실제 주문 미전송");
    } catch (error) { setMessage(`모의 테스트 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`); }
  };
  return <div className="flex h-full flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]"><div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">모의 자동주문 테스트</span><span className="text-amber-400">실제 주문 없음</span></div><button onClick={() => void run()} className="border border-amber-700 px-2 py-2 text-amber-400">WebSocket 테스트 실행</button><div className="min-h-24 flex-1 overflow-auto border border-zinc-800 p-2">{rows.length ? rows.map((row) => <div key={row.tick} className="grid grid-cols-[45px_80px_1fr] gap-2 text-[10px]"><span className="text-zinc-600">{row.tick}</span><span className={row.action.includes("후보") ? "text-amber-400" : "text-zinc-500"}>{row.action}</span><span className="text-zinc-400">{row.reason}</span></div>) : <span className="text-zinc-600">실행 버튼을 누르면 최근 1분봉 기준 모의 판단 결과가 표시됩니다</span>}</div><div className="border border-zinc-800 p-2 text-zinc-500">{message}</div></div>;
}
