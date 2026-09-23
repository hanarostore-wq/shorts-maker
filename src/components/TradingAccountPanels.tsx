"use client";

import { useEffect, useState } from "react";

type Account = { ok: boolean; liveTradingEnabled?: boolean; cash?: number; tradingValue?: number; totalValue?: number; pnl?: number; updatedAt?: string; error?: string };
const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

function useAccount(asset: "coin" | "stock") {
  const [data, setData] = useState<Account | null>(null);
  const [message, setMessage] = useState(asset === "coin" ? "실제 업비트 잔고 조회 대기" : "실제 주식 잔고 API 연결 대기");
  useEffect(() => {
    const load = async () => {
      if (asset === "stock") { setMessage("실제 주식 자산 오류: 나무플러그 인증·잔고 조회 명세 연결 전입니다"); return; }
      try { const response = await fetch("/api/coin/account", { cache: "no-store" }); const result = await response.json(); if (!result.ok) throw new Error(result.error); setData(result); setMessage(`실제 잔고 갱신 ${new Date(result.updatedAt).toLocaleTimeString("ko-KR")}`); } catch (error) { setMessage(`실제 자산 조회 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`); }
    };
    const first = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 5000); return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [asset]);
  return { data, message };
}

export function AssetManagementPanel({ asset }: { asset: "coin" | "stock" }) {
  const { data, message } = useAccount(asset);
  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]"><div className="flex items-center justify-between border-b border-zinc-800 pb-2"><b className="text-zinc-100">자산관리 · 실제 잔고</b><span className="text-emerald-400">5초 갱신</span></div><div className="border border-zinc-800 p-3"><div className="flex justify-between border-b border-zinc-900 py-2"><span className="text-zinc-400">현금자산 · 지금 바로 쓸 수 있는 돈</span><b className="text-zinc-100">{data ? won(data.cash || 0) : "-"}</b></div><div className="flex justify-between py-2"><span className="text-zinc-400">매매자산 · 현재 가격으로 계산한 보유자산</span><b className="text-zinc-100">{data ? won(data.tradingValue || 0) : "-"}</b></div></div><div className={message.includes("오류") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div><p className="text-[10px] text-zinc-600">모의 금액은 섞지 않고 실제 계좌 잔고만 표시합니다.</p></div>;
}

export function ProfitRealizationPanel({ asset }: { asset: "coin" | "stock" }) {
  const { data, message } = useAccount(asset);
  const [paperPnl, setPaperPnl] = useState(0);
  useEffect(() => { const read = () => setPaperPnl(Number(window.localStorage.getItem("moneyos:paper-pnl") || 0)); read(); window.addEventListener("storage", read); return () => window.removeEventListener("storage", read); }, []);
  const live = data?.liveTradingEnabled;
  const value = live ? (data?.pnl || 0) : paperPnl;
  const label = live ? "실전투자 수익금 · 현재 보유 평가손익" : "모의매매 수익금 · 가상 매수·매도 손익";
  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]"><div className="flex items-center justify-between border-b border-zinc-800 pb-2"><b className="text-zinc-100">수익실현</b><span className={value >= 0 ? "text-emerald-400" : "text-red-400"}>{value >= 0 ? "+" : "-"}{won(Math.abs(value))}</span></div><div className="border border-zinc-800 p-4 text-center"><div className="mb-2 text-zinc-500">{label}</div><div className={`text-2xl font-bold ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}>{value >= 0 ? "+" : "-"}{won(Math.abs(value))}</div><div className="mt-2 text-[10px] text-zinc-600">전체 보유량을 현재 가격과 매수가로 비교한 금액</div></div><div className={message.includes("오류") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div></div>;
}

export function LiveTradingPanel({ asset }: { asset: "coin" | "stock" }) { return <div className="flex flex-col gap-3 border-2 border-red-900 bg-zinc-950 p-3 text-[11px]"><b className="text-red-400">실제매매원</b><div className="border border-red-950 bg-red-950/20 p-3 text-red-300">실제 주문은 승인관리·리스크관리·블랙 3단계 승인 전까지 차단됩니다.</div><div className="text-zinc-500">{asset === "coin" ? "업비트 주문 API" : "나무플러그 주문 API"} 연결 상태와 주문 명세 확인이 필요합니다.</div></div>; }
