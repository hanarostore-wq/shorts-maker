"use client";
import {useEffect,useState} from 'react';

export type AnalyticsStatus={state:string;collection:string;error?:string|null;task?:string};
type Summary={profit:number;loss:number;fees:number;net:number;basis:string};
type Runtime={mode:'paper'|'live';running:boolean;judgmentRunning?:boolean};
type Finance={paper?:Summary;live?:Summary;status?:AnalyticsStatus;runtime?:Runtime|null};

export function useTradingFinance(asset:string){
  const [data,setData]=useState<Finance|null>(null);
  const [message,setMessage]=useState('집계 확인 중');
  useEffect(()=>{
    if(asset!=='coin') return;
    let alive=true;
    const load=async()=>{
      try{
        const [analyticsResponse,paperResponse,liveResponse]=await Promise.all([
          fetch('/api/trading/analytics?action=status&asset=coin',{cache:'no-store'}),
          fetch('/api/coin/terminal/worker?mode=paper',{cache:'no-store'}),
          fetch('/api/coin/terminal/worker?mode=live',{cache:'no-store'}),
        ]);
        const analytics=await analyticsResponse.json();
        if(!analyticsResponse.ok) throw Error(analyticsResponse.status===401?'인증 후 조회':analytics.error||'집계 조회 실패');
        const [paper,live]=await Promise.all([paperResponse.json().catch(()=>null),liveResponse.json().catch(()=>null)]);
        const paperRunning=Boolean(paper?.engine?.running);
        const liveRunning=Boolean(live?.engine?.running);
        const runtime=liveRunning?{mode:'live' as const,running:true,judgmentRunning:Boolean(live?.engine?.judgmentRunning)}:paperRunning?{mode:'paper' as const,running:true,judgmentRunning:Boolean(paper?.engine?.judgmentRunning)}:null;
        if(alive){setData({...analytics,runtime});setMessage('');}
      }catch(e){if(alive){setData(null);setMessage((e as Error).message);}}
    };
    void load();
    const t=setInterval(()=>void load(),5000);
    return()=>{alive=false;clearInterval(t);};
  },[asset]);
  return {data,message:asset==='coin'?message:'집계 연결 대기'};
}

export function FinanceAmounts({row}:{row?:Summary}){
  const won=(n:number|undefined)=>n===undefined?'미집계':n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'원';
  return <><span className="text-red-300">익 {won(row?.profit)}</span><span className="text-blue-300">손 {won(row?.loss)}</span><span className="text-zinc-400">비 {won(row?.fees)}</span><span className="text-emerald-300">총 {won(row?.net)}</span></>;
}

export function DepartmentFinance({asset,data,message}:{asset:string;data:Finance|null;message:string}){
  const runtime=data?.runtime??null;
  const displayMode=runtime?.mode??'paper';
  const modeLabel=runtime?.mode==='paper'?'모의':runtime?.mode==='live'?'실전':'대기';
  return <div aria-label="부서 손익" className="flex flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-[11px]" title="익·손·비·총은 완료 거래 기준입니다. 비용은 거래 수수료이며 총순익에 다시 차감하지 않습니다.">
    {['coin','stock'].includes(asset)&&<span className={`border px-1.5 py-0.5 font-bold ${runtime?.mode==='live'?'border-red-700 text-red-300':runtime?.mode==='paper'?'border-amber-700 text-amber-300':'border-zinc-700 text-zinc-500'}`}>현재 {modeLabel}</span>}
    <FinanceAmounts row={data?.[displayMode]}/>
    {message&&<span className="text-zinc-500">{message}</span>}
  </div>;
}

export type TradingRuntime=Runtime|null;
