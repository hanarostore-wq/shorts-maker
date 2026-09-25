"use client";
import { useEffect, useState } from "react";
import { formatWon, normalizeFinance, type FinanceSummary } from "@/lib/finance";

export type AnalyticsStatus = { state: string; collection: string; error?: string | null; task?: string };
type Runtime = { mode: "paper" | "live"; running: boolean; judgmentRunning?: boolean };
type Finance = { paper?: FinanceSummary | null; live?: FinanceSummary | null; status?: AnalyticsStatus; runtime?: Runtime | null };

export function useTradingFinance(asset: string) {
  const [data, setData] = useState<Finance | null>(null);
  const [message, setMessage] = useState("집계 확인 중");
  useEffect(() => {
    if (asset !== "coin") return;
    let alive = true;
    const load = async () => {
      try {
        const [analyticsResponse, paperResponse, liveResponse] = await Promise.all([
          fetch(`/api/trading/analytics?action=status&asset=${asset}`, { cache: "no-store" }),
          fetch("/api/coin/terminal/worker?mode=paper", { cache: "no-store" }),
          fetch("/api/coin/terminal/worker?mode=live", { cache: "no-store" }),
        ]);
        const analytics = await analyticsResponse.json();
        if (!analyticsResponse.ok) throw Error(analyticsResponse.status === 401 ? "인증 후 조회" : analytics.error || "집계 조회 실패");
        const [paper, live] = await Promise.all([paperResponse.json().catch(() => null), liveResponse.json().catch(() => null)]);
        const paperRunning = Boolean(paper?.engine?.running);
        const liveRunning = Boolean(live?.engine?.running);
        const runtime = liveRunning ? { mode: "live" as const, running: true, judgmentRunning: Boolean(live?.engine?.judgmentRunning) } : paperRunning ? { mode: "paper" as const, running: true, judgmentRunning: Boolean(paper?.engine?.judgmentRunning) } : null;
        if (alive) { setData({ paper: normalizeFinance(analytics.paper), live: normalizeFinance(analytics.live), status: analytics.status, runtime }); setMessage(""); }
      } catch (error) { if (alive) { setData(null); setMessage((error as Error).message); } }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [asset]);
  return { data, message: asset === "coin" ? message : "집계 연결 대기" };
}

export function FinanceAmounts({ row }: { row?: FinanceSummary | null }) {
  return <><span className="text-red-300">익 {formatWon(row?.profit)}</span><span className="text-blue-300">손 {formatWon(row?.loss)}</span><span className="text-zinc-400">비 {formatWon(row?.fees)}</span><span className="text-emerald-300">총 {formatWon(row?.net)}</span></>;
}

export function DepartmentFinance({ asset, data, message }: { asset: string; data: Finance | null; message: string }) {
  const runtime = data?.runtime ?? null;
  const displayMode = runtime?.mode ?? "paper";
  const modeLabel = runtime?.mode === "paper" ? "모의" : runtime?.mode === "live" ? "실전" : "대기";
  return <div aria-label="부서 손익" className="flex flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-[11px]" title="모든 원화 금액은 10원 미만 절삭. 총순익 = 이익 - 손실 - 비용.">
    {["coin", "stock"].includes(asset) && <span className={`border px-1.5 py-0.5 font-bold ${runtime?.mode === "live" ? "border-red-700 text-red-300" : runtime?.mode === "paper" ? "border-amber-700 text-amber-300" : "border-zinc-700 text-zinc-500"}`}>현재 {modeLabel}</span>}
    <FinanceAmounts row={data?.[displayMode]} />
    {message && <span className="text-zinc-500">{message} · 10원 단위 기준</span>}
  </div>;
}

export type TradingRuntime = Runtime | null;
