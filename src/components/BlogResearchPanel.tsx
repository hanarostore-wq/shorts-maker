"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ResearchItem = { id: string; keyword: string; mainKeyword: string; keywordCluster: string[]; masterTopic: string; searchIntent: string; sourceUrl?: string | null; sourceTitle?: string | null; notes?: string | null; demandScore: number; trendScore: number; supplyScore: number; contentGapScore: number; fitScore: number; opportunityScore: number; selectionReason: string; status: "candidate" | "approved" | "used" | "rejected" };
type Dashboard = { items: ResearchItem[]; counts: Record<string, number> };
const inputClass = "control-room-input w-full text-xs";

export function BlogResearchPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [configured, setConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [keywords, setKeywords] = useState("");
  const [profileKeywords, setProfileKeywords] = useState("생활정보\n실용정보\n비교추천");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("저장 대기");
  const [filter, setFilter] = useState<"all" | "candidate" | "approved" | "used" | "rejected">("all");
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
    const list = keywords.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    if (!configured) return setMessage("먼저 Naver Client ID/Secret 연결 테스트·암호화 저장을 실행하세요.");
    if (list.length < 1) return setMessage("조사할 키워드를 한 줄에 하나씩 입력하세요.");
    if (list.length > 200) return setMessage("한 번에 최대 200개까지 조사할 수 있습니다.");
    setBusy(true); setMessage(`DataLab·Blog Search 조사 중 · ${list.length}개`);
    try {
      const response = await fetch("/api/blog/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "collect", blogId: "b_naver_main", keywords: list, profileKeywords: profileKeywords.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(`[${result.code || "NAVER_RESEARCH_ERROR"}] ${result.error || "소재 조사 실패"}`);
      setMessage(`조사 완료 · 중복 제거 ${result.unique}개 · 저장 ${result.results?.length || 0}개${result.errors?.length ? ` · 실패 ${result.errors.length}개` : ""}`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "소재 조사 실패"); }
    finally { setBusy(false); }
  };
  const selectTop = async () => {
    setBusy(true); setMessage("Opportunity Score 상위 100개 선정 중");
    try { const response = await fetch("/api/blog/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "select-top-100" }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "선정 실패"); setMessage(`글 작성 대상 ${result.selected?.length || 0}개를 승인했습니다.`); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "상위 100개 선정 실패"); }
    finally { setBusy(false); }
  };
  const itemAction = async (id: string, action: "approve" | "reject" | "send-to-ready") => {
    setBusy(true);
    try { const response = await fetch("/api/blog/research", { method: action === "send-to-ready" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "작업 실패"); if (action === "send-to-ready" && result.brief) await navigator.clipboard?.writeText(result.brief); setMessage(action === "send-to-ready" ? "READY 관리자 큐에 브리프를 전달했습니다." : action === "approve" ? "소재를 승인했습니다." : "소재를 보류했습니다."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "작업 실패"); }
    finally { setBusy(false); }
  };
  const removeItem = async (id: string) => {
    setBusy(true);
    try { const response = await fetch("/api/blog/research", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "삭제 실패"); setMessage("승인 후보를 삭제했습니다."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "삭제 실패"); }
    finally { setBusy(false); }
  };

  const visibleItems = useMemo(() => filter === "all" ? data?.items ?? [] : (data?.items ?? []).filter((item) => item.status === filter), [data, filter]);

  if (!data) return <div className="p-4 text-xs text-zinc-500">소재 조사 저장소를 불러오는 중입니다.</div>;
  return <div className="flex flex-col gap-3">
    <div className="rounded border border-violet-900 bg-violet-950/20 p-3 text-[11px] text-zinc-300"><div className="font-bold text-violet-300">소재 조사원 · Naver DataLab/Search</div><div className="mt-1">글을 생성하지 않습니다. 실제 상대 검색수요·30/90일 추세·Blog Search 공급량을 수집해 GPT 무료 웹에 넘길 상위 주제를 선정합니다.</div></div>
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-zinc-200">Naver API 연결</span><span className={configured ? "text-[10px] text-emerald-300" : "text-[10px] text-amber-300"}>{configured ? "암호화 저장됨" : "저장 대기"}</span></div><div className="mb-2 text-[10px] leading-5 text-amber-300">주의: 여기에 네이버 로그인 아이디를 넣는 것이 아닙니다. 개발자센터에서 발급된 Client ID를 입력하세요.</div><a href="https://developers.naver.com/apps/#/list" target="_blank" rel="noopener noreferrer" className="mb-2 inline-block text-[10px] text-cyan-300 underline">개발자센터 내 애플리케이션 열기</a><input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="개발자센터 Client ID (로그인 ID 아님)" autoComplete="off" className={`${inputClass} mb-2`} /><input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="개발자센터 Client Secret" type="password" autoComplete="new-password" className={`${inputClass} mb-2`} /><button disabled={busy} onClick={() => void saveCredentials()} className="border border-violet-700 px-3 py-2 text-[11px] text-violet-300 disabled:opacity-40">연결 테스트 · 암호화 저장</button><div className="mt-2 border border-zinc-800 p-2 text-[10px] text-zinc-500">{message}</div><div className="mt-1 text-[9px] text-zinc-600">Secret은 localStorage·응답·로그에 저장하지 않으며 서버 Redis AES-256-GCM namespace에만 저장합니다.</div></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{([["all", "전체", data.counts.total], ["candidate", "후보", data.counts.candidate], ["approved", "승인/작성대상", data.counts.approved], ["used", "READY 전달", data.counts.used], ["rejected", "보류", data.counts.rejected]] as const).map(([key, label, count]) => <button type="button" key={key} onClick={() => setFilter(key)} className={`rounded border p-2 text-left ${filter === key ? "border-cyan-600 bg-cyan-950/30" : "border-zinc-800 bg-zinc-900/60"}`}><div className="text-[10px] text-zinc-500">{label}</div><div className="text-lg font-bold text-zinc-100">{count}</div></button>)}</div>
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><div className="mb-2 text-xs font-bold text-zinc-200">150~200개 후보 조사</div><textarea value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="키워드 150~200개를 한 줄에 하나씩 입력" className={`${inputClass} min-h-28`} /><input value={profileKeywords} onChange={(event) => setProfileKeywords(event.target.value)} placeholder="BlogProfile 적합 키워드" className={`${inputClass} mt-2`} /><div className="mt-2 flex flex-wrap gap-2"><button disabled={busy || !configured} onClick={() => void collect()} className="border border-cyan-700 px-3 py-1.5 text-[11px] text-cyan-300 disabled:opacity-40">실제 소재 조사 실행</button><button disabled={busy || !data.items.length} onClick={() => void selectTop()} className="border border-amber-700 px-3 py-1.5 text-[11px] text-amber-300 disabled:opacity-40">상위 100개 글 작성 대상 선정</button></div></div>
    <div className="max-h-[42vh] overflow-y-auto">{visibleItems.map((item) => <div key={item.id} className="mb-2 border border-zinc-800 bg-zinc-900/40 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-bold text-zinc-100">{item.masterTopic}</div><div className="mt-1 text-[10px] text-zinc-500">{item.mainKeyword} · {item.searchIntent}</div></div><div className="flex items-start gap-2 text-right"><div><div className="text-lg font-bold text-violet-300">{item.opportunityScore}</div><div className="text-[9px] text-zinc-600">OPPORTUNITY</div></div><button type="button" aria-label={`${item.masterTopic} 삭제`} title="이 후보 삭제" disabled={busy} onClick={() => void removeItem(item.id)} className="text-sm font-bold text-zinc-500 hover:text-rose-300 disabled:opacity-40">×</button></div></div><div className="mt-2 grid grid-cols-5 gap-1 text-[9px] text-zinc-500"><span>수요 {item.demandScore}</span><span>추세 {item.trendScore}</span><span>공급 {item.supplyScore}</span><span>공백 {item.contentGapScore}</span><span>적합 {item.fitScore}</span></div>{item.notes && <div className="mt-2 text-[10px] text-zinc-400">{item.notes}</div>}<div className="mt-2 flex flex-wrap gap-2"><span className="border border-zinc-700 px-2 py-1 text-[10px] text-cyan-300">{item.status.toUpperCase()}</span>{item.status === "candidate" && <><button disabled={busy} onClick={() => void itemAction(item.id, "approve")} className="border border-emerald-700 px-2 py-1 text-[10px] text-emerald-300">승인</button><button disabled={busy} onClick={() => void itemAction(item.id, "reject")} className="border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400">보류</button></>}{item.status === "approved" && <button disabled={busy} onClick={() => void itemAction(item.id, "send-to-ready")} className="border border-amber-700 px-2 py-1 text-[10px] text-amber-300">GPT용 브리프 전달</button>}</div></div>)}{!visibleItems.length && <div className="py-6 text-center text-xs text-zinc-600">선택한 상태의 소재가 없습니다.</div>}</div>
  </div>;
}
