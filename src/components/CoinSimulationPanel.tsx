"use client";

import { useState } from "react";
import { decidePaper, type PaperDecision } from "@/lib/paperEngine";

type SimRow = { tick: string; price: number; action: string; reason: string; pnl: number };
type Summary = { cash: number; position: number; realized: number; unrealized: number; total: number; buys: number; sells: number };

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const judgmentNames: Array<[keyof PaperDecision["judgments"], string]> = [
  ["regime", "시장 분위기"], ["direction", "방향"], ["toxicFlow", "위험한 흐름"], ["liquidityStress", "거래 편의"], ["quoteEnvironment", "호가 상태"], ["inventoryPressure", "보유 압력"], ["executionHealth", "실행 상태"],
];

export function CoinSimulationPanel() {
  const [rows, setRows] = useState<SimRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [decision, setDecision] = useState<PaperDecision | null>(null);
  const [message, setMessage] = useState("모의매매 대기 · 실제 주문 없음");
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setMessage("업비트 실시간 1분봉을 읽고 모의 엔진을 실행 중...");
    try {
      const response = await fetch("/api/coin/market?market=KRW-BTC", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; price?: number; candles?: Array<{ trade_price: number }>; orderbook?: { units?: Array<{ ask_price: number; bid_price: number; ask_size: number; bid_size: number }> } };
      if (!data.ok || !data.candles?.length) throw new Error("PAPER_MARKET_DATA_MISSING: 업비트 1분봉을 받지 못했습니다");
      const prices = data.candles.slice(0, 20).map((candle) => Number(candle.trade_price)).reverse();
      const book = data.orderbook?.units?.[0];
      let cash = 100000;
      let position = 0;
      let average = 0;
      let realized = 0;
      let buys = 0;
      let sells = 0;
      const nextRows: SimRow[] = [];
      let lastDecision: PaperDecision | null = null;
      prices.forEach((price, index) => {
        const history = prices.slice(0, index + 1);
        const current = decidePaper({ price, prices: history, bestAsk: book?.ask_price, bestBid: book?.bid_price, askSize: book?.ask_size, bidSize: book?.bid_size, dataAgeMs: 0, websocketHealthy: true }, position * price, realized);
        lastDecision = current;
        if (current.action === "BUY" && cash >= 5000) {
          const quantity = 5000 / price;
          average = ((average * position) + price * quantity) / (position + quantity);
          position += quantity; cash -= 5000; buys += 1;
          nextRows.push({ tick: `${index + 1}틱`, price, action: "매수 체결", reason: current.reason, pnl: 0 });
        } else if (current.action === "SELL" && position > 0) {
          const quantity = position;
          const pnl = (price - average) * quantity;
          realized += pnl; cash += price * quantity; position = 0; sells += 1;
          nextRows.push({ tick: `${index + 1}틱`, price, action: "매도 체결", reason: current.reason, pnl });
        } else {
          nextRows.push({ tick: `${index + 1}틱`, price, action: current.action === "PULL_QUOTES" || current.action === "KILL" ? "주문 차단" : "관망", reason: current.reason, pnl: 0 });
        }
      });
      const lastPrice = prices[prices.length - 1];
      const unrealized = (lastPrice - average) * position;
      setRows(nextRows);
      setDecision(lastDecision);
      setSummary({ cash, position, realized, unrealized, total: realized + unrealized, buys, sells });
      setMessage("모의 루프 완료 · JEV 연결 전 규칙 기반 안전 폴백 · 실제 주문 미전송");
    } catch (error) {
      setMessage(error instanceof Error ? `[PAPER_RUN_ERROR] ${error.message}` : "[PAPER_RUN_ERROR] 알 수 없는 모의매매 오류");
    } finally { setRunning(false); }
  };

  return <div className="flex h-full flex-col gap-3 border-2 border-zinc-700 bg-[#0b0e11] p-3 text-[11px]">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">모의매매 엔진</span><span className="text-amber-400">PAPER · 실제 주문 없음</span></div>
    <div className="grid grid-cols-4 gap-1 border border-zinc-800 bg-[#11161b] p-2 text-center"><div><span className="block text-[10px] text-zinc-500">모드</span><b className="text-amber-300">모의</b></div><div><span className="block text-[10px] text-zinc-500">폴백 단계</span><b className="text-sky-300">{decision?.fallback || "대기"}</b></div><div><span className="block text-[10px] text-zinc-500">판단 제공자</span><b className="text-zinc-300">{decision?.provider || "JEV 대기"}</b></div><div><span className="block text-[10px] text-zinc-500">결정</span><b className={decision?.action === "BUY" ? "text-emerald-400" : decision?.action === "SELL" ? "text-red-400" : "text-zinc-300"}>{decision?.action || "-"}</b></div></div>
    <button type="button" disabled={running} onClick={() => void run()} className="border border-amber-700 px-2 py-2 text-amber-400 disabled:text-zinc-600">{running ? "모의 루프 실행 중..." : "실시간 데이터로 모의 루프 실행"}</button>
    {summary && <div className="grid grid-cols-3 gap-1 border border-zinc-800 bg-[#11161b] p-2 text-zinc-300"><span>현금 {won(summary.cash)}</span><span>보유 {summary.position.toFixed(6)}</span><span>매수 {summary.buys}건</span><span>매도 {summary.sells}건</span><span>확정 손익 <b className={summary.realized >= 0 ? "text-emerald-400" : "text-red-400"}>{won(summary.realized)}</b></span><span>총 손익 <b className={summary.total >= 0 ? "text-emerald-400" : "text-red-400"}>{won(summary.total)}</b></span></div>}
    {decision && <div className="border border-zinc-800 bg-[#11161b] p-2"><div className="mb-2 flex items-center justify-between text-zinc-400"><span>JEV 7판단 입력판</span><span className="text-[10px] text-yellow-500">연결 전 RULES_ONLY</span></div><div className="grid grid-cols-2 gap-1">{judgmentNames.map(([key, label]) => <div key={key} className="flex justify-between gap-2 border-b border-zinc-900 py-1"><span className="text-zinc-500">{label}</span><span className="text-zinc-300">{decision.judgments[key]}</span></div>)}</div><div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-zinc-500"><span>현재가 {Math.round(decision.state.mid).toLocaleString()}</span><span>호가차이 {decision.state.spreadBps.toFixed(1)}bp</span><span>RSI {decision.state.rsi?.toFixed(1) ?? "-"}</span></div></div>}
    <div className="min-h-24 flex-1 overflow-auto border border-zinc-800 bg-[#080a0d] p-2">{rows.length ? rows.map((row) => <div key={row.tick} className="grid grid-cols-[40px_68px_1fr_65px] gap-2 border-b border-zinc-900 py-1 text-[10px]"><span className="text-zinc-600">{row.tick}</span><span className={row.action === "매수 체결" ? "text-emerald-400" : row.action === "매도 체결" ? "text-red-400" : row.action === "주문 차단" ? "text-orange-400" : "text-zinc-500"}>{row.action}</span><span className="text-zinc-400">{Math.round(row.price).toLocaleString()}원 · {row.reason}</span><span className={row.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{row.pnl ? won(row.pnl) : "-"}</span></div>) : <span className="text-zinc-600">실행하면 매수·매도·관망·차단과 손익이 체결 장부에 표시됩니다</span>}</div>
    <div className={message.includes("오류") || message.includes("ERROR") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
  </div>;
}
