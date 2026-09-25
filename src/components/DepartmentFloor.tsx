"use client";

import {DepartmentFinance,useTradingFinance} from "./DepartmentFinance";
import { useState } from "react";
import type { Agent, Department } from "@/lib/types";
import { AgentSeat } from "./AgentSeat";
import { isAgentClickable } from "@/lib/agentIntegrations";

export function DepartmentFloor({
  department,
  onAgentClick,
  onReorder,
}: {
  department: Department;
  onAgentClick: (agent: Agent) => void;
  onReorder: (departmentId: string, agentIds: string[]) => void;
}) {
  const finance=useTradingFinance(department.id);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeCount = department.agents.filter((a) => a.id.endsWith("_analytics") ? finance.data?.status?.state === "업무중" : a.status === "active").length;
  const utilization = Math.round((activeCount / department.agents.length) * 100);

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const ids = department.agents.map((a) => a.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, draggingId);
    onReorder(department.id, ids);
    setDraggingId(null);
  };

  return (
    <div className="flex min-h-[280px] flex-col gap-2 border-2 border-zinc-700 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-y-2 border-b-2 border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{department.icon}</span>
          <span className="text-sm font-bold text-zinc-100">{department.name}</span>
        </div>
        <DepartmentFinance asset={department.id} data={finance.data} message={finance.message}/>
        <span className="font-mono text-sm font-bold text-emerald-400">
          {department.agents.length}명 근무
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 border border-zinc-700 bg-zinc-900">
          <div
            className="h-full bg-emerald-400"
            style={{ width: `${utilization}%` }}
          />
        </div>
        <span className="text-[11px] font-bold text-zinc-500">가동률 {utilization}%</span>
      </div>

      <div className="grid content-start grid-cols-5 gap-1.5 sm:grid-cols-8">
        {department.agents.map((agent) => {
          const clickable = isAgentClickable(agent.id);
          return (
            <div
              key={agent.id}
              draggable
              onDragStart={() => setDraggingId(agent.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(agent.id)}
              onDragEnd={() => setDraggingId(null)}
              className={`cursor-grab select-none ${draggingId === agent.id ? "opacity-40" : ""}`}
            >
              <AgentSeat
                agent={agent.id.endsWith('_analytics')?{...agent,status:finance.data?.status?.error?'standby':finance.data?.status?.state==='업무중'?'active':'standby',task:finance.data?.status?.error?'⚠ '+finance.data.status.error:finance.data?.status?.task||'거래 근거·시장 자료·손익 분석 대기'}:agent}
                onClick={clickable ? () => onAgentClick(agent) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
