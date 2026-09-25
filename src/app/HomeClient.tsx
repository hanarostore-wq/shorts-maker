"use client";

import { useEffect, useState } from "react";
import { StatCounter } from "@/components/StatCounter";
import { DepartmentFloor } from "@/components/DepartmentFloor";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoSync } from "@/components/AutoSync";
import { UpbitTerminalModal } from "@/components/UpbitTerminalModal";
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

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setState(data);
      } catch {
        // 다음 주기에 재시도
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

  if (!state) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black font-mono text-zinc-500">
        불러오는 중...
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

  const isShortsAgentSelected = Boolean(liveSelectedAgent && liveSelectedAgent.id.startsWith("v"));
  const shortsStep = liveSelectedAgent?.id ? (SHORTS_AGENT_STEP_MAP[liveSelectedAgent.id] || "search") : "search";

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
              onAgentClick={setSelectedAgent}
              onReorder={handleReorder}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <ActivityLog log={state.log} />
      </section>

      {/* 업비트 터미널 모달 */}
      <UpbitTerminalModal mode={liveSelectedAgent?.id === "c7" ? "paper" : liveSelectedAgent?.id === "c13" ? "live" : null} onClose={() => setSelectedAgent(null)} />
      
      {/* 쇼츠부서 남다른AI Shorts 분석기 모달 (선택된 직원의 전용 단계로 즉시 오픈) */}
      <ShortsStudioModal
        isOpen={isShortsAgentSelected}
        initialStep={shortsStep}
        targetAgentId={liveSelectedAgent?.id}
        targetAgentName={liveSelectedAgent?.name}
        targetAgentTask={liveSelectedAgent?.task}
        onClose={() => setSelectedAgent(null)}
      />

      {/* 기타 일반 직원 상세 모달 */}
      {liveSelectedAgent && !["c7", "c13"].includes(liveSelectedAgent.id) && !liveSelectedAgent.id.startsWith("v") && (
        <AgentDetailModal
          agent={liveSelectedAgent}
          departments={state.departments}
          onClose={() => setSelectedAgent(null)}
        />
      )}

      {selectedStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 font-mono" onClick={() => setSelectedStatus(null)}>
          <div className="flex max-h-[70vh] w-full max-w-xl flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b-2 border-zinc-800 pb-2"><span className="text-sm font-bold text-zinc-100">{selectedStatus} 목록</span><button type="button" onClick={() => setSelectedStatus(null)} className="text-xs text-zinc-500">✕ 닫기</button></div>
            <div className="overflow-y-auto">{statusItems.length ? statusItems.map((item, index) => <div key={`${item.title}-${index}`} className="grid grid-cols-[120px_1fr_90px] gap-2 border-b border-zinc-900 py-2 text-[11px]"><span className="font-bold text-zinc-200">{item.title}</span><span className="text-zinc-400">{item.detail}</span><span className="text-right text-zinc-600">{item.meta}</span></div>) : <div className="py-8 text-center text-zinc-600">표시할 항목이 없습니다</div>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
