"use client";

import { useEffect, useState } from "react";
import type { Agent } from "@/lib/types";
import { CoinSimulationPanel } from "./CoinSimulationPanel";
import { UpbitConnectionPanel } from "./UpbitConnectionPanel";
import { StockTradingPanel } from "./StockTradingPanel";
import { AssetManagementPanel, LiveTradingPanel, ProfitRealizationPanel } from "./TradingAccountPanels";

type Kind = "coin" | "stock";
type Book = { ask_price: number; bid_price: number; ask_size: number; bid_size: number };

function OrderbookOnlyPanel({ kind }: { kind: Kind }) {
  const [rows, setRows] = useState<Book[]>([]);
  const [message, setMessage] = useState(kind === "coin" ? "업비트 호가창 연결 중" : "나무플러그 호가 명세 연결 대기");
  useEffect(() => {
    if (kind !== "coin") return;
    let active = true;
    const stream = new EventSource("/api/coin/stream?market=KRW-BTC&codes=KRW-BTC");
    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; code?: string; orderbook_units?: Book[]; message?: string };
        if (data.type === "orderbook" && data.code === "KRW-BTC") {
          if (active) { setRows(data.orderbook_units?.slice(0, 10) || []); setMessage("업비트 호가 실시간 수신 중"); }
        } else if (data.type === "relay_error" && active) setMessage(`${data.code || "[ORDERBOOK_RELAY_ERROR]"} ${data.message || "업비트 호가 서버 중계 오류"}`);
      } catch { if (active) setMessage("[ORDERBOOK_RELAY_PARSE_ERROR] 서버 중계 호가 응답 해석 실패"); }
    };
    stream.onerror = () => { if (active) setMessage("[ORDERBOOK_RELAY_CONNECTION_ERROR] 업비트 호가 서버 중계 연결 실패"); };
    return () => { active = false; stream.close(); };
  }, [kind]);
  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]"><div className="flex items-center justify-between border-b border-zinc-800 pb-2"><b className="text-zinc-100">{kind === "coin" ? "업비트 호가 감시" : "나무플러그 호가 감시"}</b><span className="text-emerald-400">호가 전용</span></div><div className="grid grid-cols-2 gap-2 text-center text-zinc-500"><span>매도 잔량</span><span>매수 잔량</span></div><div className="border border-zinc-800">{rows.length ? rows.map((row, index) => <div key={`${row.ask_price}-${index}`} className="grid grid-cols-2 gap-2 border-b border-zinc-900 px-2 py-1"><span className="text-red-300">{row.ask_price.toLocaleString()} · {row.ask_size.toFixed(4)}</span><span className="text-emerald-300">{row.bid_price.toLocaleString()} · {row.bid_size.toFixed(4)}</span></div>) : <div className="p-5 text-center text-zinc-600">{kind === "coin" ? "호가 수신 대기" : "[NAMUH_ORDERBOOK_SPEC_PENDING] 나무플러그 호가 TR 명세 확인 전"}</div>}</div><div className="border border-zinc-800 p-2 text-zinc-500">{message}</div></div>;
}

function CompactRolePanel({ kind, agent }: { kind: Kind; agent: Agent }) {
  const common = kind === "coin" ? "업비트 현물" : "나무플러그 국내주식";
  const roles: Record<string, [string, string]> = {
    c1: ["전략연구원", "AI·로컬AI가 전략 후보를 연구합니다. 주문과 그래프는 이 직원의 담당이 아닙니다."],
    c2: ["초고속 판단원", "JEV 판단 입력과 결정 시간을 관리합니다. JEV 연결 전에는 규칙 폴백 상태를 표시합니다."],
    c3: ["계산원", "Python 계산 결과·수수료·슬리피지·손익만 검증합니다."],
    c6: ["리스크관리원", "일일 손실·최대 보유금액·데이터 지연·스프레드 차단 규칙을 관리합니다."],
    c9: ["승인관리원", "모의매매와 실제주문 전환 승인 상태만 관리합니다."],
    c10: ["최종통제원", "긴급정지·전체 주문 차단·운영 상태를 관리합니다."],
    t1: ["전략연구원", "주식 전략 후보와 시장 조건을 연구합니다. 주문은 담당하지 않습니다."],
    t2: ["초고속 판단원", "주식 신호 판단과 결정 시간을 관리합니다."],
    t3: ["계산원", "주식 지표·수수료·슬리피지·손익을 계산합니다."],
    t6: ["리스크관리원", "주식 일일 손실·보유한도·지연 차단을 관리합니다."],
    t9: ["승인관리원", "주식 모의·실제 주문 전환 승인 상태를 관리합니다."],
    t10: ["최종통제원", "주식 긴급정지와 전체 주문 차단을 관리합니다."],
  };
  const [title, detail] = roles[agent.id] || [agent.name, agent.task];
  return <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px]"><div className="flex items-center justify-between border-b border-zinc-800 pb-2"><b className="text-zinc-100">{common} · {title}</b><span className="text-zinc-500">전용 모달</span></div><div className="border border-zinc-800 p-3 text-zinc-300">{detail}</div><div className="grid grid-cols-2 gap-2"><div className="border border-zinc-800 p-2 text-zinc-500">현재 상태<br /><b className="text-emerald-400">업무중</b></div><div className="border border-zinc-800 p-2 text-zinc-500">담당 업무<br /><b className="text-zinc-300">{agent.task}</b></div></div><div className="border border-zinc-800 p-2 text-zinc-600">이 직원에게 필요하지 않은 차트·호가창·주문 시뮬레이션은 표시하지 않습니다.</div></div>;
}

export function TradingRolePanel({ kind, agent }: { kind: Kind; agent: Agent }) {
  if (agent.id === (kind === "coin" ? "c4" : "t4")) return <OrderbookOnlyPanel kind={kind} />;
  if (agent.id === (kind === "coin" ? "c5" : "t5")) return <AssetManagementPanel asset={kind} />;
  if (agent.id === (kind === "coin" ? "c7" : "t7")) return <CoinSimulationPanel />;
  if (agent.id === (kind === "coin" ? "c8" : "t8")) return kind === "coin" ? <UpbitConnectionPanel /> : <StockTradingPanel agent={agent} />;
  if (agent.id === (kind === "coin" ? "c11" : "t11")) return <AssetManagementPanel asset={kind} />;
  if (agent.id === (kind === "coin" ? "c12" : "t12")) return <ProfitRealizationPanel asset={kind} />;
  if (agent.id === (kind === "coin" ? "c13" : "t13")) return <LiveTradingPanel asset={kind} />;
  return <CompactRolePanel kind={kind} agent={agent} />;
}
