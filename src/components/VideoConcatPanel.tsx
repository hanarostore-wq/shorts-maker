"use client";

import { useEffect, useRef, useState } from "react";

type JobStatus = "queued" | "working" | "completed" | "failed" | "canceled";
type ProcessingMode = "copy" | "normalize";
type Job = { id: string; status: JobStatus; processingMode: ProcessingMode; outputName?: string; sourceBytes?: number; outputBytes?: number; progress?: number; etaSeconds?: number; stage?: string; error?: string };
type SavedJob = { id: string; token: string };
type NotificationConfig = { configured: boolean; host: string | null };

const STORAGE_KEY = "moneyos.concat.latest-job";
const BROWSER_NOTIFY_KEY = "moneyos.concat.browser-notify";
const labels: Record<JobStatus, string> = { queued: "대기중", working: "작업중", completed: "제작완료", failed: "제작실패", canceled: "작업취소" };

function bytes(value?: number) {
  if (!value || value <= 0) return null;
  return value < 1024 * 1024 ? `${Math.round(value / 1024)}KB` : `${(value / (1024 * 1024)).toFixed(1)}MB`;
}
function eta(value?: number) {
  if (!value || value < 1) return null;
  const second = Math.round(value); const minute = Math.floor(second / 60);
  return minute ? `약 ${minute}:${String(second % 60).padStart(2, "0")} 남음` : `약 ${second}초 남음`;
}

export function VideoConcatPanel() {
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("normalize");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notification, setNotification] = useState<NotificationConfig>({ configured: false, host: null });
  const [notifyBrowser, setNotifyBrowser] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(BROWSER_NOTIFY_KEY) === "true");
  const previousStatus = useRef<JobStatus | null>(null);

  useEffect(() => {
    void fetch("/api/concat/notifications", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((config: NotificationConfig | null) => { if (config) setNotification(config); });
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
    const timer = window.setInterval(() => void sync(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (job?.status === "completed" && previousStatus.current && previousStatus.current !== "completed" && notifyBrowser && "Notification" in window && Notification.permission === "granted") {
      new Notification("이어붙이기 제작완료", { body: job.outputName ?? "로컬 MP4 제작이 완료됐습니다." });
    }
    previousStatus.current = job?.status ?? null;
  }, [job, notifyBrowser]);

  const start = async () => {
    if (starting || job?.status === "queued" || job?.status === "working") return;
    setStarting(true);
    try {
      const response = await fetch("/api/concat/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ processingMode }) });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(errorBody?.error ?? `작업 등록에 실패했습니다. (HTTP ${response.status})`);
      }
      const payload = await response.json() as { job: Job; token: string };
      const saved = { id: payload.job.id, token: payload.token };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      setJob(payload.job);
      window.location.href = `clipjoin://run?job=${encodeURIComponent(saved.id)}&token=${encodeURIComponent(saved.token)}&mode=${processingMode}`;
    } catch (error) { setJob({ id: "local-error", status: "failed", processingMode, error: error instanceof Error ? error.message : "작업 등록에 실패했습니다. 새로고침 후 다시 시도하세요." }); }
    finally { setStarting(false); }
  };

  const saveWebhook = async (clear = false) => {
    const response = await fetch("/api/concat/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl: clear ? null : webhookUrl }) });
    if (!response.ok) return;
    const config = await response.json() as NotificationConfig;
    setNotification(config);
    if (clear) setWebhookUrl("");
  };

  const enableBrowserNotification = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    setNotifyBrowser(enabled);
    window.localStorage.setItem(BROWSER_NOTIFY_KEY, String(enabled));
  };

  const busy = job?.status === "queued" || job?.status === "working";
  const statusText = job ? [labels[job.status], job.status === "working" && Number.isFinite(job.progress) ? `${Math.round((job.progress ?? 0) * 100)}%` : null, job.status === "working" ? eta(job.etaSeconds) : null, job.status === "working" && bytes(job.sourceBytes) ? `원본 ${bytes(job.sourceBytes)}` : null, job.status === "completed" ? job.outputName : null, job.status === "completed" && bytes(job.outputBytes) ? bytes(job.outputBytes) : null].filter(Boolean).join(" · ") : "대기중";

  return (
    <div className="flex flex-col gap-4 text-xs">
      <section className="control-room-panel border-l-2 border-l-[var(--control-cyan)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-mono text-[10px] tracking-[.16em] text-[var(--control-cyan)]">MONEYOS // LOCAL MP4 WORKER</p><h3 className="mt-1 text-sm font-bold text-zinc-100">이어붙이기</h3></div><span className={`border px-2 py-1 font-mono text-[10px] ${job?.status === "completed" ? "border-emerald-600/70 bg-emerald-950/20 text-emerald-300" : busy ? "border-cyan-600/70 bg-cyan-950/20 text-cyan-200" : "border-[var(--control-line-strong)] bg-[var(--control-surface-raised)] text-zinc-300"}`}>{statusText}</span></div>
        {job?.status === "working" && <div className="mt-3 h-1 overflow-hidden bg-zinc-800"><div className="h-full bg-[var(--control-cyan)] transition-all" style={{ width: `${Math.max(2, Math.round((job.progress ?? 0) * 100))}%` }} /></div>}
        <p className="mt-3 leading-5 text-[var(--control-muted)]">영상 파일은 PC를 벗어나지 않습니다. 원본 유지 또는 자동 규격 맞춤 처리만 로컬 FFmpeg가 수행하고 웹은 작업 상태만 표시합니다.</p>
      </section>

      <section className="control-room-panel flex flex-col gap-2 p-4"><label className="font-mono text-[10px] text-zinc-500">처리 방식</label><select className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2 text-xs text-zinc-100 outline-none" value={processingMode} disabled={busy} onChange={(event) => setProcessingMode(event.target.value as ProcessingMode)}><option value="copy">원본 그대로 MP4 · 같은 규격만 · 용량 유지</option><option value="normalize">자동 규격 맞춤 MP4 · 코덱·해상도 달라도 처리</option></select><p className="text-[10px] leading-5 text-zinc-500">자동 규격 맞춤은 최대 해상도 기준으로 검은 여백만 추가하고, 원본 음성·효과음은 유지한 채 MP4 규격만 통일합니다.</p></section>

      <section className="control-room-panel flex flex-col gap-2 p-4"><div className="flex items-center justify-between gap-2"><div><h4 className="font-bold text-zinc-100">완료 알림</h4><p className="mt-1 text-[10px] text-zinc-500">웹훅은 브라우저를 닫아도 완료 시 전송됩니다</p></div>{notification.configured && <span className="font-mono text-[10px] text-emerald-300">연결됨 · {notification.host}</span>}</div><div className="flex gap-2"><input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} type="url" placeholder="https://discord.com/api/webhooks/..." className="min-w-0 flex-1 border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2 text-xs text-zinc-100 outline-none" /><button type="button" className="control-room-button px-3 py-2 text-xs" onClick={() => void saveWebhook()}>웹훅 저장</button></div>{notification.configured && <button type="button" className="self-start text-[10px] text-zinc-500 underline" onClick={() => void saveWebhook(true)}>웹훅 해제</button>}<button type="button" className="self-start border border-[var(--control-line)] px-3 py-2 text-[10px] text-zinc-200" onClick={() => void enableBrowserNotification()}>{notifyBrowser ? "브라우저 알림 허용됨" : "이 브라우저 알림 허용"}</button></section>

      <section className="control-room-panel flex flex-col gap-3 p-4"><div><h4 className="font-bold text-zinc-100">내 PC에서 이어붙이기 시작</h4><p className="mt-1 text-[10px] leading-5 text-zinc-500">브라우저·작업 창을 닫아도 시작된 작업은 계속됩니다. 완료 팝업 대신 이 직원 상태와 설정한 웹훅으로 결과를 확인합니다.</p></div><button type="button" className="control-room-button px-3 py-2 text-center text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || starting} onClick={() => void start()}>{busy ? statusText : processingMode === "normalize" ? "자동 규격 맞춤으로 선택" : "원본 MP4 여러 개 선택"}</button>{job?.stage && job.status === "working" && <p className="text-[10px] text-zinc-500">{job.stage}</p>}{job?.status === "failed" && <p className="text-[10px] leading-5 text-red-300">{job.error ?? "작업에 실패했습니다."}</p>}</section>
    </div>
  );
}
