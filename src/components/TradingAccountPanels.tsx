"use client";

import { useEffect, useState } from "react";
import {FinanceAmounts,useTradingFinance} from "./DepartmentFinance";
import { TraderWorkspace } from "./TraderWorkspace";

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

function useBotAccounts(asset:"coin"|"stock") {const [data,setData]=useState<Record<string,{cash:string;quantity:string;mark?:{positionKrw:number;unrealized:number}}|null>>({}),[message,setMessage]=useState('연결 확인 중');useEffect(()=>{if(asset==='stock')return;let alive=true;const load=async()=>{try{const pairs=await Promise.all(['paper','live'].map(async mode=>{const r=await fetch('/api/coin/terminal/worker?mode='+mode),j=await r.json();if(!r.ok)throw Error(r.status===401?'매매 인증 후 조회':j.error);return [mode,j.engine.account] as const;}));if(alive){setData(Object.fromEntries(pairs));setMessage('봇에 배정된 운용자산 · 개인 계좌 전체 자산과 구분');}}catch(e){if(alive)setMessage('자산 조회: '+(e as Error).message);}};void load();const timer=setInterval(()=>void load(),5000);return()=>{alive=false;clearInterval(timer);};},[asset]);return {data,message:asset==='stock'?'주식 모의·실전 잔고 엔진 연결 대기':message};}
export function AssetManagementPanel({asset}:{asset:"coin"|"stock"}){const {data,message}=useBotAccounts(asset);return <div className="space-y-3 text-sm"><b>자산관리 · 모의/실전 운용자산</b>{(['paper','live'] as const).map(mode=><div key={mode} className="rounded border border-zinc-700 p-3"><b>{mode==='paper'?'모의':'실전'}</b><p>주문 가능 운용금: {data[mode]?won(Number(data[mode]?.cash)):'미집계'}</p><p>보유 평가금액: {data[mode]?.mark?won(data[mode]?.mark?.positionKrw||0):'미집계'}</p></div>)}<p>{message}</p></div>;}
export function ProfitRealizationPanel({asset}:{asset:"coin"|"stock"}){const {data,message}=useTradingFinance(asset);return <div className="space-y-3 text-sm"><b>수익실현 · 완료된 거래 손익</b>{(['paper','live'] as const).map(mode=><div key={mode} className="space-y-2 rounded border border-zinc-700 p-3"><b>{mode==='paper'?'모의':'실전'}</b><div className="flex flex-wrap gap-3"><FinanceAmounts row={data?.[mode]}/></div></div>)}<p>{message}</p><p className="text-xs text-zinc-400">수수료 차감 후 손익입니다. 비용은 이미 반영된 거래 수수료이며 중복 차감하지 않습니다. Jev/API 원화 청구 비용은 미연결입니다. 자세한 근거와 리포트는 매매분석에서 확인하세요.</p></div>;}

export function LiveTradingPanel({ asset }: { asset: "coin" | "stock" }) {
  if (asset === "coin") return <TraderWorkspace mode="live" />;
  return <div className="flex flex-col gap-3 border-2 border-red-900 bg-zinc-950 p-3 text-[11px]"><b className="text-red-400">실제매매원</b><div className="border border-red-950 bg-red-950/20 p-3 text-red-300">실제 주문은 승인관리·리스크관리·블랙 3단계 승인 전까지 차단됩니다.</div><div className="text-zinc-500">나무플러그 주문 API 연결 상태와 주문 명세 확인이 필요합니다.</div></div>;
}
