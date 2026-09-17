"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatCounter } from "@/components/StatCounter";
import { DepartmentFloor } from "@/components/DepartmentFloor";
import { ProjectGrid } from "@/components/ProjectGrid";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoSync } from "@/components/AutoSync";
import type { Department, Project } from "@/lib/types";
import type { LogEntry } from "@/lib/store";

interface State {
  departments: Department[];
  projects: Project[];
  log: LogEntry[];
  completedToday: number;
}

export default function Home() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onmessage = (event) => {
      setState(JSON.parse(event.data));
    };
    return () => source.close();
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
    active: allAgents.filter((a) => a.status === "active").length,
    standby: allAgents.filter((a) => a.status === "standby").length,
    idle: allAgents.filter((a) => a.status === "idle").length,
    offline: allAgents.filter((a) => a.status === "offline").length,
  };

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
            <StatCounter label="퇴근" value={counts.offline} tone="red" />
            <StatCounter label="오늘 완료" value={state.completedToday} tone="green" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            {state.departments.length}개 부서 · {allAgents.length}명 직원 실시간 운영 중
          </p>
          <Link
            href="/settings"
            className="border-2 border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            ⚙ 설정
          </Link>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-zinc-300">진행 프로젝트</h2>
        <ProjectGrid projects={state.projects} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-zinc-300">부서 관제 · 전체 층</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {state.departments.map((department) => (
            <DepartmentFloor key={department.id} department={department} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <ActivityLog log={state.log} />
      </section>
    </div>
  );
}
