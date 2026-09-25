"use client";
import { useEffect, useState } from "react";

type Article={id:string;title:string;body:string;status:string;publishedUrl?:string|null;error?:string|null};

export function NaverBlogPanel(){
 const [items,setItems]=useState<Article[]>([]); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState("");
 const load=async()=>{const r=await fetch("/api/blog/naver",{cache:"no-store"});const j=await r.json();const next=j.articles||[];setItems(next);const failed=next.find((article:Article)=>article.status==="failed"&&article.error);if(failed)setMsg(`발행 실패: ${failed.error}`)};
 // 서버 상태 polling을 시작하는 초기 호출은 외부 시스템 동기화이므로 예외 처리한다.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{load();const t=setInterval(load,4000);return()=>clearInterval(t)},[]);
 const publish=async(id:string)=>{setBusy(true);setMsg("");try{const r=await fetch("/api/blog/naver",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action:"publish-now"})});const j=await r.json();setMsg(r.ok?"즉시 발행 작업을 네이버 블로거에게 전달했습니다.":j.error||"요청 실패");await load()}finally{setBusy(false)}};
 return <div className="flex flex-col gap-3">
   <div className="rounded border border-emerald-900 bg-emerald-950/20 p-3 text-[11px] text-zinc-300">
    <div className="font-bold text-emerald-300">네이버 블로거</div>
    <div className="mt-1">완성된 READY 글을 로그인된 운영본부 브라우저의 네이버 SmartEditor에 전달합니다. 네이버 비밀번호는 관제실에 저장하지 않습니다.</div>
   </div>
   {msg&&<div className="text-[11px] text-amber-300">{msg}</div>}
   <div className="max-h-[55vh] overflow-y-auto">
   {items.map(a=><div key={a.id} className="mb-2 border border-zinc-800 bg-zinc-900/40 p-3">
    <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-bold text-zinc-100">{a.title}</div><div className="mt-1 text-[10px] text-zinc-600">{a.id}</div></div><span className={`text-[10px] ${a.status === "failed" ? "text-red-400" : a.status === "published" ? "text-emerald-300" : "text-cyan-300"}`}>{a.status === "failed" ? "실패" : a.status === "queued" ? "대기 중" : a.status === "publishing" ? "발행 중" : a.status === "published" ? "발행 완료" : a.status.toUpperCase()}</span></div>
    <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] text-zinc-400">{a.body}</div>
    {a.publishedUrl&&<a className="mt-2 block text-[10px] text-blue-400 underline" href={a.publishedUrl} target="_blank">발행 글 확인</a>}
    {a.error&&<div className="mt-2 text-[10px] text-red-400">{a.error}</div>}
    <button disabled={busy||!["ready","failed"].includes(a.status)} onClick={()=>publish(a.id)} className="mt-3 border border-emerald-700 px-3 py-1.5 text-[11px] font-bold text-emerald-300 disabled:opacity-30">즉시 발행</button>
   </div>)}
   {!items.length&&<div className="py-6 text-center text-xs text-zinc-600">READY 글이 없습니다.</div>}
   </div>
 </div>
}
