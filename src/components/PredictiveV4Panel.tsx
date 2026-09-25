"use client";

import { useMemo } from "react";
import { assessCandidate, type PredictiveSnapshot } from "@/lib/predictiveV4";

const label: Record<string, string> = {
  RISK_ON: "위험선호", TREND_UP: "상승추세", MIXED: "혼합", RANGE: "박스", RISK_OFF: "위험회피", PANIC: "패닉",
  ULTRA: "초고유동성", HIGH: "고유동성", MEDIUM: "중유동성", LOW: "저유동성",
  PRE_BREAKOUT: "상승 전조", PULLBACK_REACCEL: "눌림 재가속", TREND_CONTINUATION: "안정 추세",
};

export function PredictiveV4Panel({ snapshot, now }: { snapshot: PredictiveSnapshot | null; now?: number }) {
  const assessment = useMemo(() => snapshot ? assessCandidate(snapshot, { previousState: snapshot.state, now }) : null, [now, snapshot]);
  if (!assessment) return <section className="border-t border-[#2a333d] bg-[#0b1016] px-3 py-3 text-[11px] text-zinc-600">V4 SHADOW · 후보 snapshot 수신 대기</section>;
  const gateEntries = Object.entries(assessment.gates);
  return <section className="border-t border-[#2a333d] bg-[#0b1016] px-3 py-3 text-[11px]">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <b className="text-white">V4 SHADOW</b><span className="border border-cyan-800 px-2 py-0.5 font-mono text-[10px] text-cyan-300">predictive-v4</span>
      <span className={assessment.shadowEligible ? "text-emerald-300" : "text-amber-300"}>{assessment.shadowEligible ? "가상 진입 후보" : "진입 대기"}</span>
      <span className="ml-auto text-zinc-600">실제 주문 0 · V3 유지</span>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="border border-[#2a3542] p-2"><span className="block text-zinc-600">시장 국면</span><b className="text-zinc-200">{label[assessment.regime]}</b></div>
      <div className="border border-[#2a3542] p-2"><span className="block text-zinc-600">전략형</span><b className="text-zinc-200">{label[assessment.strategyType]}</b></div>
      <div className="border border-[#2a3542] p-2"><span className="block text-zinc-600">Future Opportunity</span><b className="text-cyan-300">{assessment.opportunityScore}</b></div>
      <div className="border border-[#2a3542] p-2"><span className="block text-zinc-600">Chase Risk</span><b className={assessment.chaseRisk >= 60 ? "text-red-300" : "text-emerald-300"}>{assessment.chaseRisk}</b></div>
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500"><span>상태 <b className="text-zinc-300">{assessment.state}</b></span><span>유동성 <b className="text-zinc-300">{label[assessment.liquidityClass]}</b></span><span>Expected Net Edge <b className={assessment.cost.allowed ? "text-emerald-300" : "text-red-300"}>{assessment.cost.expectedNetEdgePct.toFixed(2)}%</b></span></div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{gateEntries.map(([key, passed]) => <span key={key} className={passed ? "text-emerald-400" : "text-red-300"}>{passed ? "✓" : "×"} {key}</span>)}</div>
  </section>;
}
