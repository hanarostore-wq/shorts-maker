"use client";

import { useEffect, useState } from "react";
import { FinanceAmounts, useTradingFinance } from "./DepartmentFinance";
import { TraderWorkspace } from "./TraderWorkspace";

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

function useBotAccounts(asset: "coin" | "stock") {
  const [data, setData] = useState<Record<string, { cash: string; quantity: string; mark?: { positionKrw: number; unrealized: number } } | null>>({});
  const [message, setMessage] = useState("연결 확인 중");
  useEffect(() => {
    if (asset === "stock") return;
    let alive = true;
    const load = async () => { try { const pairs = await Promise.all(["paper", "live"].map(async (mode) => { const r = await fetch(`/api/coin/terminal/worker?mode=${mode}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw Error(r.status === 401 ? "매매 인증 후 조회" : j.error); return [mode, j.engine.account] as const; })); if (alive) { setData(Object.fromEntries(pairs)); setMessage("봇 배정 운용자산 · 개인 계좌와 분리 표시"); } } catch (e) { if (alive) setMessage(`자산 조회: ${(e as Error).message}`); } };
    void load(); const timer = setInterval(() => void load(), 5000); return () => { alive = false; clearInterval(timer); };
  }, [asset]);
  return { data, message: asset === "stock" ? "주식 모의·실전 잔고 엔진 연결 대기" : message };
}

function ModeCard({ mode, children }: { mode: "paper" | "live"; children: React.ReactNode }) {
  return <div className="control-room-panel-raised space-y-2 p-3"><div className="flex items-center justify-between"><b className={mode === "paper" ? "text-amber-300" : "text-red-300"}>{mode === "paper" ? "PAPER · 모의" : "LIVE · 실전"}</b><span className="text-[10px] text-[var(--control-dim)]">{mode === "paper" ? "가상 체결" : "승인 게이트"}</span></div>{children}</div>;
}

export function AssetManagementPanel({ asset }: { asset: "coin" | "stock" }) {
  const { data, message } = useBotAccounts(asset);
  return <div className="control-room-panel space-y-3 p-3 text-sm"><div><b className="text-white">자산관리</b><p className="mt-1 text-xs text-[var(--control-muted)]">모의·실전 운용자산을 분리해 표시합니다</p></div>{(["paper", "live"] as const).map((mode) => <ModeCard key={mode} mode={mode}><p className="text-[var(--control-muted)]">주문 가능 운용금: <b className="text-zinc-100">{data[mode] ? won(Number(data[mode]?.cash)) : "미집계"}</b></p><p className="text-[var(--control-muted)]">보유 평가금액: <b className="text-zinc-100">{data[mode]?.mark ? won(data[mode]?.mark?.positionKrw || 0) : "미집계"}</b></p></ModeCard>)}<p className="text-xs leading-6 text-[var(--control-muted)]">{message}</p></div>;
}

export function ProfitRealizationPanel({ asset }: { asset: "coin" | "stock" }) {
  const { data, message } = useTradingFinance(asset);
  return <div className="control-room-panel space-y-3 p-3 text-sm"><div><b className="text-white">수익실현</b><p className="mt-1 text-xs text-[var(--control-muted)]">완료 거래의 수수료 차감 후 손익입니다</p></div>{(["paper", "live"] as const).map((mode) => <ModeCard key={mode} mode={mode}><FinanceAmounts row={data?.[mode]} /></ModeCard>)}<p className="text-xs leading-6 text-[var(--control-muted)]">{message}</p><p className="text-xs leading-6 text-[var(--control-dim)]">JEV/API 원화 청구 비용은 미연결입니다. 자세한 근거와 리포트는 매매분석에서 확인하세요.</p></div>;
}

export function LiveTradingPanel({ asset }: { asset: "coin" | "stock" }) {
  if (asset === "coin") return <TraderWorkspace mode="live" />;
  return <div className="control-room-panel flex flex-col gap-3 p-3 text-[11px]"><b className="text-red-300">LIVE · 실제매매원</b><div className="border border-red-900 bg-red-950/20 p-3 leading-6 text-red-200">실제 주문은 승인관리·리스크관리·블랙 3단계 승인 전까지 차단됩니다.</div><div className="text-[var(--control-muted)]">나무플러그 주문 API 연결 상태와 주문 명세 확인이 필요합니다.</div></div>;
}
