"use client";

import { useEffect, useState } from "react";
import { StatCounter } from "@/components/StatCounter";
import { DepartmentFloor } from "@/components/DepartmentFloor";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoSync } from "@/components/AutoSync";
import { UpbitTerminalModal } from "@/components/UpbitTerminalModal";
import { YuJinTradersModal } from "@/components/YuJinTradersModal";
import { BinanceTerminalModal } from "@/components/BinanceTerminalModal";
import { AgentDetailModal } from "@/components/AgentDetailModal";
import { ShortsStudioModal } from "@/components/ShortsStudioModal";
import { SHORTS_AGENT_STEP_MAP } from "@/lib/agentIntegrations";
import type { Agent, Department, Project } from "@/lib/types";
import type { LogEntry } from "@/lib/store";

interface State {
  departments: Department[];
  projects: Project[];
  log: LogEntry[];
  completedToday: number;
  sharedStorageConfigured?: boolean;
}

declare global {
  interface Window {
    __BLACK_CONTROL_INITIAL_STATE__?: State;
  }
}

const UPBIT_MODAL_AGENT_IDS = new Set(["c_yujin", "c7", "c13"]);
const BINANCE_MODAL_AGENT_IDS = new Set(["c_binance_spot", "c_binance_futures"]);
const UPBIT_MODAL_STORAGE_KEY = "control-room-upbit-modal-agent";
const isUpbitModalAgent = (agentId: string | null | undefined) => Boolean(agentId && UPBIT_MODAL_AGENT_IDS.has(agentId));
const isBinanceModalAgent = (agentId: string | null | undefined) => Boolean(agentId && BINANCE_MODAL_AGENT_IDS.has(agentId));
function restoredUpbitModalAgent(): Agent | null {
  if (typeof window === "undefined") return null;
  const id = window.localStorage.getItem(UPBIT_MODAL_STORAGE_KEY);
  if (!id || (!isUpbitModalAgent(id) && !isBinanceModalAgent(id))) return null;
  const name = id === "c_binance_spot" ? "바이낸스 현물" : id === "c_binance_futures" ? "바이낸스 선물" : "업비트";
  return { id, name, task: "관제실 화면 복원 중", status: "active" };
}

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(restoredUpbitModalAgent);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const initialState = window.__BLACK_CONTROL_INITIAL_STATE__;
    if (initialState && Array.isArray(initialState.departments)) setState(initialState);

    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`상태 조회 HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !Array.isArray(data.departments)) throw new Error("관제실 상태 형식 오류");
        if (!cancelled) {
          setState(data);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };

    load();
    const timer = setInterval(load, 4000);

    // 다른 탭/창을 보다가 돌아왔을 때 새로고침 없이 바로 최신 상태를 보여준다.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // 일반 직원 상세창·상태 목록·모든 네이티브 모달의 Esc 닫기 흐름을 한 곳에 맞춘다.
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedStatus) {
        event.preventDefault();
        setSelectedStatus(null);
        return;
      }
      if (selectedAgent) {
        event.preventDefault();
        window.localStorage.removeItem(UPBIT_MODAL_STORAGE_KEY);
        setSelectedAgent(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedAgent, selectedStatus]);

  if (!state) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-black font-mono text-zinc-500">
        <span>{loadError ? "관제실 상태를 다시 연결하는 중..." : "불러오는 중..."}</span>
        {loadError && <span className="text-xs text-zinc-600">잠시 뒤 자동으로 다시 시도합니다</span>}
      </div>
    );
  }

  const allAgents = state.departments.flatMap((d) => d.agents);
  const counts = {
    active: allAgents.filter((a) => a.status === "active" && !a.task.startsWith("⚠")).length,
    standby: allAgents.filter((a) => a.status === "standby").length,
    idle: allAgents.filter((a) => a.status === "idle").length,
    offline: allAgents.filter((a) => a.status === "offline" && !a.task.startsWith("⚠")).length,
    anomaly: allAgents.filter((a) => a.task.startsWith("⚠")).length,
  };

  // 모달이 열려 있는 동안에도 최신 상태를 따라가도록 매 렌더링마다 다시 찾는다.
  const liveSelectedAgent = selectedAgent
    ? allAgents.find((a) => a.id === selectedAgent.id) ?? selectedAgent
    : null;
  const closeAgentModal = () => {
    window.localStorage.removeItem(UPBIT_MODAL_STORAGE_KEY);
    setSelectedAgent(null);
  };
  const handleAgentClick = (agent: Agent) => {
    if (isUpbitModalAgent(agent.id) || isBinanceModalAgent(agent.id)) window.localStorage.setItem(UPBIT_MODAL_STORAGE_KEY, agent.id);
    else window.localStorage.removeItem(UPBIT_MODAL_STORAGE_KEY);
    setSelectedAgent(agent);
  };
  const completedEntries = state.log.filter((entry) => /완료|성공|정상|조회/.test(entry.message)).filter((entry, index, entries) => entries.findIndex((candidate) => candidate.agentId === entry.agentId && candidate.message === entry.message) === index);
  const statusItems = selectedStatus === "오늘 완료"
    ? completedEntries.slice(0, 100).map((entry) => ({ title: entry.agentName, detail: entry.message, meta: entry.time }))
    : allAgents.filter((agent) => selectedStatus === "이상발생" ? agent.task.startsWith("⚠") : selectedStatus === "업무중" ? agent.status === "active" : selectedStatus === "대기" ? agent.status === "standby" : selectedStatus === "휴면" ? agent.status === "idle" : agent.status === "offline").map((agent) => ({ title: agent.name, detail: agent.task, meta: agent.status }));

  const handleReorder = (departmentId: string, agentIds: string[]) => {
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        departments: prev.departments.map((department) => {
          if (department.id !== departmentId) return department;
          const byId = new Map(department.agents.map((a) => [a.id, a]));
          const reordered = agentIds
            .map((id) => byId.get(id))
            .filter((a): a is Agent => Boolean(a));
          return { ...department, agents: reordered };
        }),
      };
    });

    fetch("/api/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId, agentIds }),
    }).catch(() => null);
  };

  const handleMoveAgent = (agentId: string, toDepartmentId: string, beforeAgentId?: string | null) => {
    const fromDepartment = state.departments.find((department) => department.agents.some((agent) => agent.id === agentId));
    if (!fromDepartment || fromDepartment.id === toDepartmentId && !beforeAgentId) return;
    const sourceAgent = fromDepartment.agents.find((agent) => agent.id === agentId);
    if (!sourceAgent) return;

    setState((previous) => {
      if (!previous) return previous;
      const moved = previous.departments.map((department) => ({ ...department, agents: [...department.agents] }));
      const source = moved.find((department) => department.id === fromDepartment.id);
      const target = moved.find((department) => department.id === toDepartmentId);
      if (!source || !target) return previous;
      const index = source.agents.findIndex((agent) => agent.id === agentId);
      if (index === -1) return previous;
      const [agent] = source.agents.splice(index, 1);
      const targetIndex = target.agents.findIndex((candidate) => candidate.id === beforeAgentId);
      if (targetIndex === -1) target.agents.push(agent);
      else target.agents.splice(targetIndex, 0, agent);
      return { ...previous, departments: moved };
    });

    fetch("/api/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromDepartmentId: fromDepartment.id, toDepartmentId, agentId, beforeAgentId: beforeAgentId ?? null }),
    }).catch(() => null);
  };

  const isShortsStudioAgent = Boolean(liveSelectedAgent?.id && SHORTS_AGENT_STEP_MAP[liveSelectedAgent.id]);
  const shortsStep = liveSelectedAgent?.id ? (SHORTS_AGENT_STEP_MAP[liveSelectedAgent.id] || "search") : "search";
  const shortsAgents = allAgents.filter((agent) => Boolean(SHORTS_AGENT_STEP_MAP[agent.id]));
  const handleNextShortsAgent = () => {
    if (!liveSelectedAgent || shortsAgents.length < 2) return;
    const currentIndex = shortsAgents.findIndex((agent) => agent.id === liveSelectedAgent.id);
    const nextAgent = shortsAgents[(currentIndex + 1) % shortsAgents.length];
    if (nextAgent) handleAgentClick(nextAgent);
  };

  return (
    <div className="flex flex-1 flex-col gap-3 bg-black px-4 py-6 font-mono sm:px-8">
      <AutoSync />
      {state.sharedStorageConfigured === false && (
        <div className="border border-red-700 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          ⚠ 공유저장소 미연결 · Redis 환경변수를 확인하세요
        </div>
      )}
      <header className="flex flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏢</span>
            <h1 className="text-lg font-bold tracking-wide text-zinc-50">
              운영본부 관제실
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatCounter label="업무중" value={counts.active} tone="green" onClick={() => setSelectedStatus("업무중")} />
            <StatCounter label="대기" value={counts.standby} tone="blue" onClick={() => setSelectedStatus("대기")} />
            <StatCounter label="휴면" value={counts.idle} tone="gray" onClick={() => setSelectedStatus("휴면")} />
            <StatCounter label="퇴근" value={counts.offline} tone="gray" onClick={() => setSelectedStatus("퇴근")} />
            <StatCounter label="이상발생" value={counts.anomaly} tone="red" onClick={() => setSelectedStatus("이상발생")} />
            <StatCounter label="오늘 완료" value={completedEntries.length} tone="green" onClick={() => setSelectedStatus("오늘 완료")} />
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {state.departments.map((department) => (
            <DepartmentFloor
              key={department.id}
              department={department}
              onAgentClick={handleAgentClick}
              onReorder={handleReorder}
              onMoveAgent={handleMoveAgent}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <ActivityLog log={state.log} />
      </section>

      {/* 업비트 터미널 모달 */}
      <UpbitTerminalModal mode={liveSelectedAgent?.id === "c7" ? "paper" : liveSelectedAgent?.id === "c13" ? "live" : null} onClose={closeAgentModal} />
      <YuJinTradersModal isOpen={liveSelectedAgent?.id === "c_yujin"} onClose={closeAgentModal} />
      <BinanceTerminalModal kind={liveSelectedAgent?.id === "c_binance_spot" ? "spot" : liveSelectedAgent?.id === "c_binance_futures" ? "futures" : null} onClose={closeAgentModal} />
      
      {/* 쇼츠부서 남다른AI Shorts 분석기 모달 (선택된 직원의 전용 단계로 즉시 오픈) */}
      <ShortsStudioModal
        isOpen={isShortsStudioAgent}
        initialStep={shortsStep}
        targetAgentId={liveSelectedAgent?.id}
        targetAgentName={liveSelectedAgent?.name}
        targetAgentTask={liveSelectedAgent?.task}
        onNextAgent={handleNextShortsAgent}
        onClose={closeAgentModal}
      />

      {/* 기타 일반 직원 상세 모달 */}
      {liveSelectedAgent && !["c7", "c13", "c_binance_spot", "c_binance_futures"].includes(liveSelectedAgent.id) && !isShortsStudioAgent && (
        <AgentDetailModal
          agent={liveSelectedAgent}
          departments={state.departments}
          onClose={closeAgentModal}
        />
      )}

      {selectedStatus && (
        <div className="fixed inset-0 z-50 bg-transparent font-mono" onClick={() => setSelectedStatus(null)}>
          <div className="pointer-events-auto absolute left-3 top-14 flex max-h-[calc(100dvh-4.5rem)] min-h-0 w-[min(48rem,calc(100vw-1.5rem))] flex-col gap-3 overflow-hidden border-2 border-zinc-700 bg-zinc-950 p-3 shadow-2xl shadow-black/60 sm:left-8 sm:top-16 sm:max-h-[calc(100vh-5rem)] sm:p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b-2 border-zinc-800 pb-2"><span className="text-sm font-bold text-zinc-100">{selectedStatus} 목록</span><button type="button" onClick={() => setSelectedStatus(null)} className="shrink-0 text-xs text-zinc-500 hover:text-zinc-200">✕ 닫기</button></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">{statusItems.length ? statusItems.map((item, index) => <div key={`${item.title}-${index}`} className="grid grid-cols-[minmax(96px,120px)_minmax(0,1fr)_auto] gap-2 border-b border-zinc-900 py-2 text-[11px]"><span className="min-w-0 break-words font-bold text-zinc-200">{item.title}</span><span className="min-w-0 break-words text-zinc-400">{item.detail}</span><span className="whitespace-nowrap text-right text-zinc-600">{item.meta}</span></div>) : <div className="py-8 text-center text-zinc-600">표시할 항목이 없습니다</div>}</div>
          </div>
        </div>
      )}

    </div>
  );
}
