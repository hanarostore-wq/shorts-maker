"use client";

import { useEffect, useState } from "react";

type JobStatus = "queued" | "working" | "completed" | "failed" | "canceled";
type Job = { id: string; status: JobStatus; outputName?: string; error?: string };
type SavedJob = { id: string; token: string };

const STORAGE_KEY = "moneyos.concat.latest-job";
const labels: Record<JobStatus, string> = { queued: "대기중", working: "작업중", completed: "제작완료", failed: "제작실패", canceled: "작업취소" };

export function VideoConcatPanel() {
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const savedText = window.localStorage.getItem(STORAGE_KEY);
    if (!savedText) return;
    let saved: SavedJob;
    try { saved = JSON.parse(savedText) as SavedJob; } catch { return; }
    let active = true;
    const sync = async () => {
      const response = await fetch(`/api/concat/jobs/${encodeURIComponent(saved.id)}?token=${encodeURIComponent(saved.token)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { job: Job };
      if (active) setJob(payload.job);
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 1800);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const start = async () => {
    if (starting || job?.status === "queued" || job?.status === "working") return;
    setStarting(true);
    try {
      const response = await fetch("/api/concat/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outputFormat: "mp4" }) });
      if (!response.ok) throw new Error("작업 등록에 실패했습니다.");
      const payload = await response.json() as { job: Job; token: string };
      const saved = { id: payload.job.id, token: payload.token };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      setJob(payload.job);
      window.location.href = `clipjoin://run?job=${encodeURIComponent(saved.id)}&token=${encodeURIComponent(saved.token)}&format=mp4`;
    } catch {
      setJob({ id: "local-error", status: "failed", error: "작업 등록에 실패했습니다. 새로고침 후 다시 시도하세요." });
    } finally {
      setStarting(false);
    }
  };

  const busy = job?.status === "queued" || job?.status === "working";
  const statusText = job ? `${labels[job.status]}${job.outputName ? ` · ${job.outputName}` : ""}` : "대기중";

  return (
    <div className="flex flex-col gap-4 text-xs">
      <section className="control-room-panel border-l-2 border-l-[var(--control-cyan)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-mono text-[10px] tracking-[.16em] text-[var(--control-cyan)]">MONEYOS // WEB TRIGGER · LOCAL WORKER</p><h3 className="mt-1 text-sm font-bold text-zinc-100">이어붙이기</h3></div>
          <span className={`border px-2 py-1 font-mono text-[10px] ${job?.status === "completed" ? "border-emerald-600/70 bg-emerald-950/20 text-emerald-300" : busy ? "border-cyan-600/70 bg-cyan-950/20 text-cyan-200" : "border-[var(--control-line-strong)] bg-[var(--control-surface-raised)] text-zinc-300"}`}>{statusText}</span>
        </div>
        <p className="mt-3 leading-5 text-[var(--control-muted)]">영상은 웹으로 올라가지 않습니다. PC에서 같은 규격의 MP4 원본을 선택하면 재인코딩 없이 그대로 이어붙여 원본 화질과 용량을 유지합니다.</p>
      </section>

      <section className="control-room-panel grid gap-2 p-4 text-[11px] leading-5 text-zinc-300 sm:grid-cols-2">
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">출력: 원본 스트림 그대로 MP4 · 용량 급증 없음</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">해상도·코덱·음성 규격이 같은 MP4끼리만 실행</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">브라우저·모달을 닫아도 이미 시작한 PC 작업은 계속 완료</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">완료 팝업 없음 · 직원 하단 상태가 대기중 → 작업중 → 제작완료</div>
      </section>

      <section className="control-room-panel flex flex-col gap-3 p-4">
        <div><h4 className="font-bold text-zinc-100">내 PC에서 이어붙이기 시작</h4><p className="mt-1 text-[10px] leading-5 text-zinc-500">원본은 키프레임 기준으로 앞뒤 1초에 가장 가깝게 절단됩니다. 최초 한 번 PC의 install-concat-worker.ps1로 로컬 작업자를 등록하세요.</p></div>
        <button type="button" className="control-room-button px-3 py-2 text-center text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || starting} onClick={() => void start()}>{busy ? statusText : "원본 MP4 여러 개 선택"}</button>
        {job?.status === "failed" && <p className="text-[10px] leading-5 text-red-300">{job.error ?? "원본 규격이 다른 MP4는 그대로 이어붙일 수 없습니다."}</p>}
      </section>
    </div>
  );
}
