"use client";

import { useEffect, useMemo, useState } from "react";

type Report = { date: string; generatedAt: string; mode: "paper" | "live"; filledOrders: number; buys: number; sells: number; estimatedVolumeKrw: number; dailyLossLimitKrw: number; maxPositionKrw: number; liveTradingEnabled: boolean };

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

export function UpbitReportDashboard() {
  const [reports, setReports] = useState<Report[]>([]);
  const [message, setMessage] = useState("리포트 이력 조회 대기");

  const load = async () => {
    try {
      const response = await fetch("/api/coin/report/history", { cache: "no-store" });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "리포트 이력을 받지 못했습니다");
      setReports(result.reports || []);
      setMessage(result.reports?.length ? `최근 ${result.reports.length}개 리포트` : "아직 생성된 일일 리포트가 없습니다");
    } catch (error) {
      setMessage(`리포트 조회 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  };

  useEffect(() => { const first = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 60000); return () => { window.clearTimeout(first); window.clearInterval(timer); }; }, []);

  const latest = reports[0];
  const chart = useMemo(() => reports.slice(0, 7).reverse(), [reports]);
  const maxVolume = Math.max(...chart.map((report) => report.estimatedVolumeKrw), 1);

  return <section className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">업비트 일일 리스크·거래성과 리포트</span><span className="text-zinc-500">{message}</span></div>
    {latest ? <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="border border-zinc-800 p-2"><span className="block text-zinc-600">최근 기준일</span><b className="text-zinc-200">{latest.date}</b></div>
        <div className="border border-zinc-800 p-2"><span className="block text-zinc-600">체결</span><b className="text-zinc-200">{latest.filledOrders}건</b></div>
        <div className="border border-zinc-800 p-2"><span className="block text-zinc-600">매수 / 매도</span><b className="text-zinc-200">{latest.buys} / {latest.sells}</b></div>
        <div className="border border-zinc-800 p-2"><span className="block text-zinc-600">거래대금</span><b className="text-zinc-200">{won(latest.estimatedVolumeKrw)}</b></div>
        <div className="border border-zinc-800 p-2"><span className="block text-zinc-600">운영 모드</span><b className={latest.mode === "live" ? "text-red-400" : "text-amber-400"}>{latest.mode === "live" ? "실거래" : "모의매매"}</b></div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div className="border border-zinc-800 p-2"><div className="mb-2 text-zinc-500">최근 7일 거래대금</div><div className="flex h-28 items-end gap-2">{chart.map((report) => <div key={`${report.date}-${report.generatedAt}`} className="flex h-full flex-1 flex-col items-center justify-end gap-1"><span className="text-[9px] text-zinc-500">{report.estimatedVolumeKrw ? Math.round(report.estimatedVolumeKrw / 10000) : 0}만</span><div className="w-full bg-emerald-500/70" style={{ height: `${Math.max(4, (report.estimatedVolumeKrw / maxVolume) * 90)}px` }} /><span className="text-[9px] text-zinc-600">{report.date.slice(5)}</span></div>)}</div></div>
        <div className="border border-zinc-800 p-2"><div className="mb-2 text-zinc-500">리스크 기준</div><div className="flex justify-between border-b border-zinc-900 py-1"><span>일일 손실한도</span><b className="text-zinc-300">{won(latest.dailyLossLimitKrw)}</b></div><div className="flex justify-between border-b border-zinc-900 py-1"><span>최대 포지션</span><b className="text-zinc-300">{won(latest.maxPositionKrw)}</b></div><div className="flex justify-between py-1"><span>실거래 허용</span><b className={latest.liveTradingEnabled ? "text-red-400" : "text-emerald-400"}>{latest.liveTradingEnabled ? "ON" : "OFF"}</b></div></div>
      </div>
    </> : <div className="border border-zinc-800 p-6 text-center text-zinc-600">매일 한국시간 00:05에 자동 생성된 리포트가 이곳에 누적됩니다</div>}
  </section>;
}
