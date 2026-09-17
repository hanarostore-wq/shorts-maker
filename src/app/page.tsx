"use client";

import { useEffect, useState } from "react";
import { StatCounter } from "@/components/StatCounter";
import { DepartmentFloor } from "@/components/DepartmentFloor";
import { ProjectGrid } from "@/components/ProjectGrid";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoSync } from "@/components/AutoSync";
import { AgentDetailModal } from "@/components/AgentDetailModal";
import type { Agent, Department, Project } from "@/lib/types";
import type { LogEntry } from "@/lib/store";

interface State {
  departments: Department[];
  projects: Project[];
  log: LogEntry[];
  completedToday: number;
}

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

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
    return () => {
      cancelled = true;
      clearInterval(timer);
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

  return (
    <div className="flex flex-1 flex-col gap-6 bg-black px-4 py-6 font-mono sm:px-8">
      <AutoSync />
      <header className="flex flex-col gap-4 border-b-2 border-zinc-700 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏢</span>
            <h1 className="text-lg font-bold tracking-wide text-zinc-50">
              운영본부 관제실
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatCounter label="업무중" value={counts.active} tone="green" />
            <StatCounter label="대기" value={counts.standby} tone="blue" />
            <StatCounter label="휴면" value={counts.idle} tone="gray" />
            <StatCounter label="퇴근" value={counts.offline} tone="gray" />
            <StatCounter label="이상발생" value={counts.anomaly} tone="red" />
            <StatCounter label="오늘 완료" value={state.completedToday} tone="green" />
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          {state.departments.length}개 부서 · {allAgents.length}명 직원 실시간 운영 중 ·
          직원을 클릭하면 연동 상태를 조회할 수 있습니다
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-zinc-300">진행 프로젝트</h2>
        <ProjectGrid projects={state.projects} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-zinc-300">부서 관제 · 전체 층</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {state.departments.map((department) => (
            <DepartmentFloor
              key={department.id}
              department={department}
              log={state.log}
              onAgentClick={setSelectedAgent}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <ActivityLog log={state.log} />
      </section>

      {liveSelectedAgent && (
        <AgentDetailModal agent={liveSelectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
