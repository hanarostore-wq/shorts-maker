"use client";

import { useCallback, useEffect, useState } from "react";

type ResearchItem = { id: string; keyword: string; mainKeyword: string; keywordCluster: string[]; masterTopic: string; searchIntent: string; sourceUrl?: string | null; sourceTitle?: string | null; notes?: string | null; demandScore: number; trendScore: number; supplyScore: number; contentGapScore: number; fitScore: number; opportunityScore: number; selectionReason: string; status: "candidate" | "approved" | "used" | "rejected" };
type Dashboard = { items: ResearchItem[]; counts: Record<string, number> };
const inputClass = "control-room-input w-full text-xs";

export function BlogResearchPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [configured, setConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("저장 대기");
  const load = useCallback(async () => {
    const [researchResponse, credentialResponse] = await Promise.all([fetch("/api/blog/research", { cache: "no-store" }), fetch("/api/blog/research/credentials", { cache: "no-store" })]);
    setData(await researchResponse.json() as Dashboard);
    const credential = await credentialResponse.json() as { configured?: boolean };
    setConfigured(Boolean(credential.configured));
  }, []);
  // 외부 API와 조사 저장소의 초기 동기화 결과를 화면에 반영한다.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const saveCredentials = async () => {
    setBusy(true); setMessage("연결 확인 중");
    try {
      const response = await fetch("/api/blog/research/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(`[${result.code || "NAVER_CONNECTION_ERROR"}] ${result.error || "연결 실패"}`);
      setClientId(""); setClientSecret(""); setConfigured(true); setMessage("암호화 저장됨 · DataLab 정상 · Search API 정상");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Naver API 오류"); }
    finally { setBusy(false); }
  };
  const collect = async () => {
    if (!configured) return setMessage("먼저 Naver API HUB 연결 테스트·암호화 저장을 실행하세요.");
    setBusy(true); setMessage("소재 조사원이 트렌드 기반 후보를 자동 발굴하는 중입니다");
    try {
      const response = await fetch("/api/blog/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discover", blogId: "b_naver_main" }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(`[${result.code || "NAVER_RESEARCH_ERROR"}] ${result.error || "소재 조사 실패"}`);
      setMessage(`후보 발굴 완료 · 중복 제거 ${result.unique}개 · Redis 저장 ${result.results?.length || 0}개 · GitHub ${result.sharedStorage?.status || "미확인"}${result.errors?.length ? ` · 실패 ${result.errors.length}개` : ""}`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "소재 조사 실패"); }
    finally { setBusy(false); }
  };
  const selectTop = async () => {
    setBusy(true); setMessage("Opportunity Score 상위 100개 선정 중");
    try { const response = await fetch("/api/blog/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "select-top-100" }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "선정 실패"); setMessage(`Redis 저장 ${result.selected?.length || 0}개 · GitHub 미러링 ${result.sharedStorage?.status || "미확인"}`); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "상위 100개 선정 실패"); }
    finally { setBusy(false); }
  };
  const itemAction = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    try { const response = await fetch("/api/blog/research", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "작업 실패"); setMessage(action === "approve" ? "주제를 승인했습니다." : "주제를 보류했습니다."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "작업 실패"); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="p-4 text-xs text-zinc-500">소재 조사 저장소를 불러오는 중입니다.</div>;
  return <div className="flex flex-col gap-3">
    <div className="rounded border border-violet-900 bg-violet-950/20 p-3 text-[11px] text-zinc-300"><div className="font-bold text-violet-300">소재 조사원 · Naver DataLab/Search</div><div className="mt-1">검색수요·추세·공급·콘텐츠 공백·블로그 적합도를 분석해 MASTER TOPIC이 포함된 글 주제 100개를 공용 저장소에 저장합니다. 글 작성과 READY 적재는 회장님이 진행합니다.</div></div>
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-zinc-200">NAVER API HUB 연결</span><span className={configured ? "text-[10px] text-emerald-300" : "text-[10px] text-amber-300"}>{configured ? "암호화 저장됨" : "저장 대기"}</span></div><div className="mb-2 text-[10px] leading-5 text-amber-300">NAVER Cloud Console의 NAVER API HUB → Application → 인증 정보에서 복사한 Client ID와 Client Secret을 입력하세요. 네이버 로그인 아이디가 아닙니다.</div><a href="https://console.ncloud.com/naver-api-hub/application" target="_blank" rel="noopener noreferrer" className="mb-2 inline-block text-[10px] text-cyan-300 underline">NAVER API HUB Application 열기</a><input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="NAVER API HUB Client ID" autoComplete="off" className={`${inputClass} mb-2`} /><input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="NAVER API HUB Client Secret" type="password" autoComplete="new-password" className={`${inputClass} mb-2`} /><button disabled={busy} onClick={() => void saveCredentials()} className="border border-violet-700 px-3 py-2 text-[11px] text-violet-300 disabled:opacity-40">연결 테스트 · 암호화 저장</button><div className="mt-2 border border-zinc-800 p-2 text-[10px] text-zinc-500">{message}</div><div className="mt-1 text-[9px] text-zinc-600">Secret은 localStorage·응답·로그에 저장하지 않으며 서버 Redis AES-256-GCM namespace에만 저장합니다.</div></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[["전체", data.counts.total], ["후보", data.counts.candidate], ["승인/작성대상", data.counts.approved], ["READY 전달", data.counts.used], ["보류", data.counts.rejected]].map(([label, count]) => <div key={String(label)} className="rounded border border-zinc-800 bg-zinc-900/60 p-2"><div className="text-[10px] text-zinc-500">{label}</div><div className="text-lg font-bold text-zinc-100">{count}</div></div>)}</div>
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><div className="mb-2 text-xs font-bold text-zinc-200">소재 조사원 자동 발굴</div><div className="text-[10px] leading-5 text-zinc-400">키워드를 직접 입력하지 않습니다. 소재 조사원이 블로그 프로필 기반 주제 풀을 자동 확장한 뒤 Naver 검색어 트렌드·블로그 검색량을 비교해 후보를 발굴합니다.</div><div className="mt-2 text-[10px] text-zinc-500">자동 후보 최대 200개 · 중복 제거 · 상대 검색수요 · 추세 · 공급량 · 콘텐츠 공백 분석</div><div className="mt-2 flex flex-wrap gap-2"><button disabled={busy || !configured} onClick={() => void collect()} className="border border-cyan-700 px-3 py-1.5 text-[11px] text-cyan-300 disabled:opacity-40">소재 자동 발굴 실행</button><button disabled={busy || !data.items.length} onClick={() => void selectTop()} className="border border-amber-700 px-3 py-1.5 text-[11px] text-amber-300 disabled:opacity-40">상위 100개 글 작성 대상 선정</button></div></div>
    <div className="max-h-[42vh] overflow-y-auto">{data.items.map((item) => <div key={item.id} className="mb-2 border border-zinc-800 bg-zinc-900/40 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-bold text-zinc-100">{item.masterTopic}</div><div className="mt-1 text-[10px] text-zinc-500">{item.mainKeyword} · {item.searchIntent}</div></div><div className="text-right"><div className="text-lg font-bold text-violet-300">{item.opportunityScore}</div><div className="text-[9px] text-zinc-600">OPPORTUNITY</div></div></div><div className="mt-2 grid grid-cols-5 gap-1 text-[9px] text-zinc-500"><span>수요 {item.demandScore}</span><span>추세 {item.trendScore}</span><span>공급 {item.supplyScore}</span><span>공백 {item.contentGapScore}</span><span>적합 {item.fitScore}</span></div>{item.notes && <div className="mt-2 text-[10px] text-zinc-400">{item.notes}</div>}<div className="mt-2 flex flex-wrap gap-2"><span className="border border-zinc-700 px-2 py-1 text-[10px] text-cyan-300">{item.status.toUpperCase()}</span>{item.status === "candidate" && <><button disabled={busy} onClick={() => void itemAction(item.id, "approve")} className="border border-emerald-700 px-2 py-1 text-[10px] text-emerald-300">승인</button><button disabled={busy} onClick={() => void itemAction(item.id, "reject")} className="border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400">보류</button></>}</div></div>)}{!data.items.length && <div className="py-6 text-center text-xs text-zinc-600">등록된 소재 후보가 없습니다.</div>}</div>
  </div>;
}
