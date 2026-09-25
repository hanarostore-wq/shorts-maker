"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Article = { id: string; blogId: string; title: string; body: string; status: string; selected: boolean; autoPublishEligible: boolean; publishedUrl?: string | null; error?: string | null };
type Dashboard = { articles: Article[]; counts: { total: number; ready: number; selectedReady: number; todayPublished: number; failed: number; byBlog: Record<string, number>; byStatus: Record<string, number> }; schedules: Array<{ blogId: string; slots: string[]; timezone: string }> };

const DEFAULT_SLOTS = ["09:00", "15:00", "21:00"];

export function BlogReadyPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [blogId] = useState("b_naver_main");
  const [slots, setSlots] = useState(DEFAULT_SLOTS);
  const [filter, setFilter] = useState("ready");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/blog/naver", { cache: "no-store" });
    const next = await response.json() as Dashboard;
    setData(next);
    const saved = next.schedules.find((x) => x.blogId === blogId);
    if (saved) setSlots([...saved.slots, ...DEFAULT_SLOTS].slice(0, 3));
  }, [blogId]);
  // 초기 원격 저장소 동기화는 외부 데이터 구독의 결과를 화면 상태에 반영한다.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const articles = useMemo(() => (data?.articles || []).filter((article) => filter === "all" || article.status === filter), [data, filter]);
  const setSelection = async (id: string, selected: boolean) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/blog/naver", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "select", selected }) });
      if (!response.ok) throw new Error("선택 상태 저장에 실패했습니다.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "선택 상태 저장 실패"); }
    finally { setBusy(false); }
  };
  const saveSchedule = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/blog/naver", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-schedule", blogId, slots, timezone: "Asia/Seoul" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "슬롯 저장에 실패했습니다.");
      setMessage("하루 3회 발행 슬롯을 저장했습니다."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "슬롯 저장 실패"); }
    finally { setBusy(false); }
  };
  const runDueSlots = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/blog/naver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run-due-slots" }) });
      const result = await response.json();
      setMessage(response.ok ? `현재 시각 대상 ${result.claimed?.length || 0}건을 자동 발행 큐에 넣었습니다.` : result.error || "슬롯 실행 실패"); await load();
    } finally { setBusy(false); }
  };

  if (!data) return <div className="p-4 text-xs text-zinc-500">READY 저장소를 불러오는 중입니다.</div>;
  return <div className="flex flex-col gap-3">
    <div className="rounded border border-amber-900 bg-amber-950/20 p-3 text-[11px] text-zinc-300">
      <div className="font-bold text-amber-300">READY 관리자</div>
      <div className="mt-1">GPT 무료 웹에서 수동 생성한 글을 적재하고, 수량·체크·블로그 배정·자동 발행 슬롯을 관리합니다.</div>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {[['전체', data.counts.total], ['READY', data.counts.ready], ['선택 READY', data.counts.selectedReady], ['오늘 발행', data.counts.todayPublished], ['실패', data.counts.failed]].map(([label, count]) => <div key={String(label)} className="rounded border border-zinc-800 bg-zinc-900/60 p-2"><div className="text-[10px] text-zinc-500">{label}</div><div className="text-lg font-bold text-zinc-100">{count}</div></div>)}
    </div>
    <div className="flex flex-wrap gap-2 text-[10px]">
      {['ready', 'queued', 'publishing', 'failed', 'all'].map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded border px-2 py-1 ${filter === value ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-500'}`}>{value.toUpperCase()} ({value === 'all' ? data.counts.total : data.counts.byStatus[value] || 0})</button>)}
    </div>
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-zinc-200">하루 3회 자동 발행 슬롯</span><button disabled={busy} onClick={runDueSlots} className="border border-cyan-700 px-2 py-1 text-[10px] text-cyan-300 disabled:opacity-40">현재 슬롯 실행</button></div>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((slot, index) => <input key={index} type="time" value={slot} onChange={(event) => setSlots((previous) => previous.map((value, i) => i === index ? event.target.value : value))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200" />)}
      </div>
      <button disabled={busy} onClick={saveSchedule} className="mt-2 border border-amber-700 px-3 py-1.5 text-[11px] font-bold text-amber-300 disabled:opacity-40">슬롯 저장</button>
    </div>
    {message && <div className="text-[11px] text-amber-300">{message}</div>}
    <div className="max-h-[48vh] overflow-y-auto">
      {articles.map((article) => <div key={article.id} className="mb-2 border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex items-start gap-2"><input type="checkbox" checked={article.selected} disabled={busy || !['ready', 'failed'].includes(article.status)} onChange={(event) => void setSelection(article.id, event.target.checked)} className="mt-1 accent-amber-500" /><div className="min-w-0 flex-1"><div className="text-xs font-bold text-zinc-100">{article.title}</div><div className="mt-1 text-[10px] text-zinc-600">{article.id} · {article.blogId}</div></div><span className="text-[10px] text-cyan-300">{article.status.toUpperCase()}</span></div>
        <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] text-zinc-400">{article.body}</div>
        {article.error && <div className="mt-2 text-[10px] text-red-400">{article.error}</div>}
      </div>)}
      {!articles.length && <div className="py-6 text-center text-xs text-zinc-600">표시할 글이 없습니다.</div>}
    </div>
  </div>;
}
