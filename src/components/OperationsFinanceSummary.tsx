"use client";
import { useEffect, useState } from "react";
import { formatWon, sumFinance, type FinanceSummary } from "@/lib/finance";
import { FinanceAmounts } from "./DepartmentFinance";

type Mode = "paper" | "live";
type AnalyticsResponse = { paper?: FinanceSummary | null; live?: FinanceSummary | null };

export function OperationsFinanceSummary() {
  const [mode, setMode] = useState<Mode>("paper");
  const [rows, setRows] = useState<AnalyticsResponse[]>([]);
  const [connected, setConnected] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const results = await Promise.all(["coin", "stock"].map(async (asset) => {
        try {
          const response = await fetch(`/api/trading/analytics?action=status&asset=${asset}`, { cache: "no-store" });
          if (!response.ok) return null;
          return await response.json() as AnalyticsResponse;
        } catch { return null; }
      }));
      if (!alive) return;
      setRows(results.filter((result): result is AnalyticsResponse => Boolean(result)));
      setConnected(results.filter(Boolean).length);
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const total = sumFinance(rows.map((row) => row[mode]));
  return <section aria-label="운영본부 전체 손익" className="border-2 border-emerald-900 bg-zinc-950 px-3 py-2">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
      <div className="text-xs font-bold text-emerald-300">운영본부 전체 금액</div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span>연결 부서 {connected}개</span>
        <select aria-label="운영본부 손익 모드" value={mode} onChange={(event) => setMode(event.target.value as Mode)} className="bg-zinc-900 px-1 py-0.5 text-zinc-300"><option value="paper">모의 합계</option><option value="live">실전 합계</option></select>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-2 text-[11px]"><FinanceAmounts row={total} /></div>
    <div className="text-center text-[9px] text-zinc-600">전 부서 합산 · 10원 미만 절삭 · 총순익 = 이익 - 손실 - 비용 · 연결되지 않은 부서는 미집계</div>
    <div className={`mt-1 text-center text-sm font-bold ${total && total.net >= 0 ? "text-emerald-300" : "text-red-300"}`}>운영본부 총순익 {formatWon(total?.net)}</div>
  </section>;
}
