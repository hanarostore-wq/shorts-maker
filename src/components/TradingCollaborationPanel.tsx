"use client";

import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@/lib/types";

type LogItem = { id: string; at: string; agentId?: string; actor: string; kind: "trade" | "command" | "sync"; message: string };
type Commit = { branch: "trading-events" | "trading-slot-commands"; hash: string; at: string; message: string };
type Snapshot = {
  status: { phase: string; updatedAt: string; lastError?: string | null; pendingCommands?: number; exportedCount?: number };
  logs: LogItem[];
  commits: Commit[];
};

const managers = new Set(["c_gemini", "c_claude", "c_grok", "c_manus", "c_gpt"]);
const time = (value: string) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));

export function TradingCollaborationPanel({ agent }: { agent: Agent }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const isManager = managers.has(agent.id);

  useEffect(() => {
    const source = new EventSource("/api/coin/collaboration/stream");
    source.onmessage = (event) => {
      try { setSnapshot(JSON.parse(event.data) as Snapshot); setConnection("live"); }
      catch { setConnection("offline"); }
    };
    source.onerror = () => setConnection("offline");
    return () => source.close();
  }, []);

  const logs = useMemo(() => {
    const all = snapshot?.logs ?? [];
    if (agent.id === "c_trade_analyst") return all;
    return all.filter((log) => log.agentId === agent.id || log.kind === "sync" && log.agentId === agent.id);
  }, [agent.id, snapshot]);

  return (
    <div className="flex flex-col gap-3 text-white">
      <section className="control-room-panel grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="flex items-center gap-2"><span className="text-xs font-bold text-[var(--control-cyan)]">GitHub 자동 동기화</span><span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${connection === "live" && snapshot?.status.phase === "healthy" ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300" : "border-amber-500/50 bg-amber-950/40 text-amber-300"}`}>{connection === "live" && snapshot?.status.phase === "healthy" ? "실시간 연결" : "연결 확인 중"}</span></div>
          <p className="mt-1 text-[11px] text-zinc-300">{agent.task}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-[10px] text-zinc-400"><span>전송 {snapshot?.status.exportedCount ?? "-"}건</span><span>명령 {snapshot?.status.pendingCommands ?? "-"}건</span><span className="col-span-2">상태 갱신 {snapshot ? time(snapshot.status.updatedAt) : "-"}</span></div>
      </section>

      <section className="control-room-panel overflow-hidden p-0">
        <div className="border-b border-[var(--control-line)] px-3 py-2 text-xs font-bold text-zinc-100">실시간 작업 로그</div>
        <div className="max-h-64 overflow-y-auto px-3 py-1">
          {logs.length ? logs.map((log) => <div key={log.id} className="grid grid-cols-[60px_72px_minmax(0,1fr)] gap-2 border-b border-zinc-900/80 py-2 text-[10px] leading-4 last:border-0"><span className="text-zinc-500">{time(log.at)}</span><span className={log.kind === "trade" ? "font-bold text-emerald-400" : log.kind === "command" ? "font-bold text-sky-300" : "font-bold text-zinc-400"}>{log.actor}</span><span className="break-words text-zinc-200">{log.message}</span></div>) : <div className="py-6 text-center text-[11px] text-zinc-500">이 직원의 최근 실행 기록이 없습니다</div>}
        </div>
      </section>

      <section className="control-room-panel overflow-hidden p-0">
        <div className="border-b border-[var(--control-line)] px-3 py-2 text-xs font-bold text-zinc-100">최근 GitHub 커밋</div>
        <div className="max-h-44 overflow-y-auto px-3 py-1">
          {(snapshot?.commits ?? []).slice(0, 6).map((commit) => <a key={`${commit.branch}-${commit.hash}`} href={`https://github.com/hanarostore-wq/obsidian-main/commit/${commit.hash}`} target="_blank" rel="noreferrer" className="grid grid-cols-[60px_66px_minmax(0,1fr)] gap-2 border-b border-zinc-900/80 py-2 text-[10px] leading-4 last:border-0 hover:bg-zinc-900/60"><span className="text-zinc-500">{time(commit.at)}</span><span className={commit.branch === "trading-events" ? "font-bold text-emerald-400" : "font-bold text-sky-300"}>{commit.hash}</span><span className="break-words text-zinc-200">{commit.message}</span></a>)}
          {!snapshot?.commits.length && <div className="py-6 text-center text-[11px] text-zinc-500">커밋 이력을 불러오는 중입니다</div>}
        </div>
      </section>

      {isManager ? (
        <div className="grid gap-2 text-[11px] sm:grid-cols-2">
          <a className="rounded border border-sky-500/40 bg-sky-950/20 px-3 py-2 text-center font-bold text-sky-200 hover:bg-sky-900/40" href="https://github.com/hanarostore-wq/obsidian-main/tree/trading-slot-commands/slot-commands/pending" target="_blank" rel="noreferrer">슬롯 명령 대기열</a>
          <a className="rounded border border-emerald-500/40 bg-emerald-950/20 px-3 py-2 text-center font-bold text-emerald-200 hover:bg-emerald-900/40" href="https://github.com/hanarostore-wq/obsidian-main/tree/trading-events/slot-command-results" target="_blank" rel="noreferrer">명령 처리 결과</a>
        </div>
      ) : <a className="rounded border border-emerald-500/40 bg-emerald-950/20 px-3 py-2 text-center text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40" href="https://github.com/hanarostore-wq/obsidian-main/tree/trading-events/trading-events" target="_blank" rel="noreferrer">자동 체결·차트 패키지</a>}

      <p className="px-1 text-[10px] leading-5 text-zinc-500">PAPER 전용 자동화입니다. LIVE 전환·실주문·비밀정보 전송은 포함되지 않습니다.</p>
    </div>
  );
}
