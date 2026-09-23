"use client";

import { useState } from "react";
import type { Agent } from "@/lib/types";

const NH_PLUG_GUIDE = "https://www.nhplug.com/apiservice?group_id=be078217-0bf2-4bd3-8a6f-7d20e1dff90b&api_id=dba721ee-1584-4fde-8164-92c028dc760c";

const roleText: Record<string, string> = {
  t1: "GPT·로컬AI 전략 연구",
  t2: "JEV 초고속 국내주식 신호 판단",
  t3: "Python 지표·손익 계산",
  t4: "호가·스프레드 감시",
  t5: "보유 주식·미체결 주문 관리",
  t6: "일일 손실·포지션 한도 차단",
  t7: "실제 주문 없는 체결 시뮬레이션",
  t8: "나무플러그 시세·주문 API 연결",
  t9: "실거래 전환 승인",
  t10: "최종 통제·긴급정지",
};

export function StockTradingPanel({ agent }: { agent: Agent }) {
  const [symbol, setSymbol] = useState("005930");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [message, setMessage] = useState("나무플러그 API 연결 대기");

  const simulate = () => setMessage(`모의매매 준비 완료 · ${symbol} · 실제 주문 미전송 · 리스크 관문 대기`);

  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2"><span className="font-bold text-zinc-100">나무플러그 국내주식 단타 관제</span><span className={mode === "paper" ? "text-amber-400" : "text-red-400"}>{mode === "paper" ? "모의매매" : "실제주문"}</span></div>
    <div className="text-zinc-500">현재 직원 임무: <span className="text-zinc-300">{roleText[agent.id] || agent.task}</span></div>
    <div className="flex gap-2"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-1 text-zinc-200" placeholder="종목코드" /><button type="button" onClick={() => setMessage("나무플러그 시세 조회 오류: API 인증키 입력 화면이 아직 연결되지 않았습니다")} className="border border-zinc-600 px-2 text-zinc-300">조회</button></div>
    <div className="flex gap-2"><button type="button" onClick={() => setMode("paper")} className={`border px-2 py-1 ${mode === "paper" ? "border-amber-500 text-amber-400" : "border-zinc-700 text-zinc-500"}`}>모의매매</button><button type="button" onClick={() => setMode("live")} className={`border px-2 py-1 ${mode === "live" ? "border-red-500 text-red-400" : "border-zinc-700 text-zinc-500"}`}>실제주문</button></div>
    <div className="grid grid-cols-2 gap-2 border border-zinc-800 p-2 text-zinc-400"><span>실시간 호가 대기</span><span>1분봉 대기</span><span>RSI·SMA 대기</span><span>슬리피지 차단 대기</span><span>네트워크 지연 차단 대기</span><span>일일 손실한도 적용</span></div>
    <div className="grid grid-cols-2 gap-2"><button type="button" onClick={simulate} className="border border-emerald-700 px-2 py-2 text-emerald-400">매수 시뮬레이션</button><button type="button" onClick={simulate} className="border border-sky-700 px-2 py-2 text-sky-400">매도 시뮬레이션</button></div>
    <a href={NH_PLUG_GUIDE} target="_blank" rel="noreferrer" className="border border-zinc-700 px-2 py-2 text-center text-zinc-400 hover:text-zinc-100">나무플러그 API 가이드 열기</a>
    <div className={message.includes("오류") ? "border border-red-800 bg-red-950/20 p-2 text-red-300" : "border border-zinc-800 p-2 text-zinc-500"}>{message}</div>
    <p className="text-[10px] text-zinc-600">나무플러그 공식 가이드의 인증·주문 계약 확인 전에는 실제 주문을 전송하지 않습니다. API 규격이 확인되면 업비트와 같은 WebSocket·리스크 관문으로 연결합니다.</p>
  </div>;
}
