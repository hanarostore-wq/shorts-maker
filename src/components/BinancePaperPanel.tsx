"use client";

import type { Agent } from "@/lib/types";

const SITES = {
  c_binance_spot: {
    title: "바이낸스 현물 PAPER",
    url: "https://black.taild4819c.ts.net:8444",
    accent: "text-emerald-300",
    kind: "현물",
    guide: "코인을 가상 원화로 사고파는 연습장입니다",
    metrics: ["가상 시작금", "현재 가진 가상 돈", "보유 코인", "오늘 가격 움직임"],
  },
  c_binance_futures: {
    title: "바이낸스 선물 PAPER",
    url: "https://black.taild4819c.ts.net:8445",
    accent: "text-violet-300",
    kind: "선물",
    guide: "가격이 오를 때와 내릴 때를 모두 가상으로 연습하는 곳입니다",
    metrics: ["가상 증거금", "사용 중인 돈", "펀딩비", "청산 위험"],
  },
} as const;

export function BinancePaperPanel({ agent }: { agent: Agent }) {
  const site = SITES[agent.id as keyof typeof SITES];
  if (!site) return null;
  return (
    <section className="control-room-panel flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--control-line)] pb-3">
        <div>
          <p className={`text-sm font-black ${site.accent}`}>{site.title}</p>
          <p className="mt-1 text-[11px] text-[var(--control-muted)]">{site.guide}</p>
        </div>
        <span className="rounded border border-[var(--control-line-strong)] bg-[var(--control-surface-raised)] px-2 py-1 text-[10px] font-bold text-amber-200">PAPER 전용</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {site.metrics.map((metric) => (
          <div key={metric} className="rounded border border-[var(--control-line)] bg-[var(--control-surface-raised)] px-3 py-2">
            <p className="text-[11px] font-semibold text-zinc-200">{metric}</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--control-muted)]">어려운 용어는 사이트 안에서 쉬운 말로 바로 설명합니다</p>
          </div>
        ))}
      </div>
      <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-100">
        실제 Binance 계정·API 키·실제 주문은 연결하지 않습니다. 모든 금액은 원화 기준의 가상 자산입니다.
      </div>
      <a href={site.url} target="_blank" rel="noopener noreferrer" className="control-room-button flex items-center justify-center gap-2 text-xs font-black">
        {site.kind} PAPER 대시보드 열기 ↗
      </a>
    </section>
  );
}
