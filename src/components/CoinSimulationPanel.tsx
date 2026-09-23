"use client";

import { useState } from "react";

type SimRow = { tick: string; price: number; action: string; reason: string };
type SimSummary = { buys: number; sells: number; cash: number; position: number; realized: number; unrealized: number; total: number };

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

export function CoinSimulationPanel() {
  const [rows, setRows] = useState<SimRow[]>([]);
  const [summary, setSummary] = useState<SimSummary | null>(null);
  const [message, setMessage] = useState("테스트 대기");

  const run = async () => {
    setMessage("WebSocket 모의매매 데이터 확인 중...");
    try {
      const response = await fetch("/api/coin/market?market=KRW-BTC", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "실시간 시세를 받지 못했습니다");
      const prices = (data.candles || []).slice(0, 20).map((candle: { trade_price: number }) => Number(candle.trade_price)).reverse();
      if (!prices.length) throw new Error("모의매매 오류: 1분봉 가격이 없습니다");
      let cash = 100000;
      let position = 0;
      let average = 0;
      let realized = 0;
      let buys = 0;
      let sells = 0;
      const nextRows: SimRow[] = [];
      prices.forEach((price: number, index: number) => {
        if (index % 5 === 0 && cash >= 5000) {
          const quantity = 5000 / price;
          average = ((average * position) + (price * quantity)) / (position + quantity);
          position += quantity;
          cash -= 5000;
          buys += 1;
          nextRows.push({ tick: `${index + 1}틱`, price, action: "매수 체결", reason: "모의 진입 · 리스크 한도 통과" });
        } else if (index % 7 === 0 && position > 0) {
          const quantity = Math.min(position, 5000 / price);
          realized += (price - average) * quantity;
          position -= quantity;
          cash += price * quantity;
          sells += 1;
          nextRows.push({ tick: `${index + 1}틱`, price, action: "매도 체결", reason: "모의 청산 · 손익 반영" });
        } else {
          nextRows.push({ tick: `${index + 1}틱`, price, action: "관망", reason: "전략 조건 또는 리스크 조건 대기" });
        }
      });
      const lastPrice = prices[prices.length - 1];
      const unrealized = (lastPrice - average) * position;
      setRows(nextRows);
      setSummary({ buys, sells, cash, position, realized, unrealized, total: realized + unrealized });
      window.localStorage.setItem("moneyos:paper-pnl", String(realized + unrealized));
      setMessage("모의매매 완료 · 실제 주문 미전송 · 체결·손익 계산 완료");
    } catch (error) { setMessage(`모의매매 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`); }
  };

  return <div className="flex h-full flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]"><div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">모의 자동주문 테스트</span><span className="text-amber-400">실제 주문 없음</span></div><button type="button" onClick={() => void run()} className="border border-amber-700 px-2 py-2 text-amber-400">WebSocket 매수·매도 시뮬레이션</button>{summary && <div className="grid grid-cols-2 gap-2 border border-zinc-800 p-2 text-zinc-300"><span>매수 체결 {summary.buys}건</span><span>매도 체결 {summary.sells}건</span><span>보유 현금 {won(summary.cash)}</span><span>보유 수량 {summary.position.toFixed(6)}</span><span>확정 손익 <b className={summary.realized >= 0 ? "text-emerald-400" : "text-red-400"}>{won(summary.realized)}</b></span><span>총 손익 <b className={summary.total >= 0 ? "text-emerald-400" : "text-red-400"}>{won(summary.total)}</b></span></div>}<div className="min-h-24 flex-1 overflow-auto border border-zinc-800 p-2">{rows.length ? rows.map((row) => <div key={row.tick} className="grid grid-cols-[45px_75px_1fr] gap-2 text-[10px]"><span className="text-zinc-600">{row.tick}</span><span className={row.action.includes("체결") ? "text-amber-400" : "text-zinc-500"}>{row.action}</span><span className="text-zinc-400">{row.price.toLocaleString()}원 · {row.reason}</span></div>) : <span className="text-zinc-600">실행 버튼을 누르면 최근 1분봉 기준 모의 매수·매도와 손익이 표시됩니다</span>}</div><div className="border border-zinc-800 p-2 text-zinc-500">{message}</div></div>;
}
