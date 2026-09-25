"use client";

import {DepartmentFinance,useTradingFinance} from "./DepartmentFinance";
import { useState, type DragEvent } from "react";
import type { Agent, Department } from "@/lib/types";
import { AgentSeat } from "./AgentSeat";
import { isAgentClickable } from "@/lib/agentIntegrations";

export function DepartmentFloor({
  department,
  onAgentClick,
  onReorder,
  onMoveAgent,
}: {
  department: Department;
  onAgentClick: (agent: Agent) => void;
  onReorder: (departmentId: string, agentIds: string[]) => void;
  onMoveAgent: (agentId: string, toDepartmentId: string, beforeAgentId?: string | null) => void;
}) {
  const finance=useTradingFinance(department.id);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const runtime=department.id==='coin'?finance.data?.runtime:null;
  const activeCount = department.agents.filter((a) => {
    if (department.id==='coin' && a.id==='c7') return runtime?.mode==='paper' && Boolean(runtime.running);
    if (department.id==='coin' && a.id==='c13') return runtime?.mode==='live' && Boolean(runtime.running);
    if (a.id.endsWith("_analytics")) return finance.data?.status?.state === "업무중" || Boolean(runtime?.running);
    return a.status === "active";
  }).length;
  const utilization = Math.round((activeCount / department.agents.length) * 100);

  const handleDrop = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedId = event.dataTransfer.getData("text/plain") || draggingId;
    if (!droppedId || droppedId === targetId) return;
    const ids = department.agents.map((a) => a.id);
    const from = ids.indexOf(droppedId);
    const to = ids.indexOf(targetId);
    if (from === -1) {
      onMoveAgent(droppedId, department.id, targetId);
      setDraggingId(null);
      setIsDropTarget(false);
      return;
    }
    if (to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, droppedId);
    onReorder(department.id, ids);
    setDraggingId(null);
    setIsDropTarget(false);
  };

  const handleFloorDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedId = event.dataTransfer.getData("text/plain") || draggingId;
    if (droppedId) onMoveAgent(droppedId, department.id, null);
    setDraggingId(null);
    setIsDropTarget(false);
  };

  return (
    <div
      className={`flex min-h-[280px] flex-col gap-2 border-2 bg-zinc-950 p-3 transition-colors ${isDropTarget ? "border-cyan-400 bg-cyan-950/10" : "border-zinc-700"}`}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDragEnter={() => setIsDropTarget(true)}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDropTarget(false); }}
      onDrop={handleFloorDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-y-2 border-b-2 border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{department.icon}</span>
          <span className="text-sm font-bold text-zinc-100">{department.name}</span>
        </div>
        <DepartmentFinance asset={department.id} data={finance.data} message={finance.message}/>
        <div className="flex items-center gap-2">
          <span className="hidden text-[9px] text-zinc-600 xl:inline">직원 카드를 드래그해 자리 이동</span>
          <span className="font-mono text-sm font-bold text-emerald-400">
            {department.agents.length}명 근무
          </span>
        </div>
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
          const isTradingStaff=agent.id==='c7'||agent.id==='c13';
          const isTradingAnalytics=agent.id==='c_analytics';
          const runtimeAgent=isTradingStaff||isTradingAnalytics;
          const runtimeStatus=runtimeAgent
            ? isTradingAnalytics
              ? (runtime?.running?'active':'standby')
              : (runtime?.mode===(agent.id==='c7'?'paper':'live')&&runtime.running?'active':'standby')
            : null;
          const runtimeTask=runtimeAgent
            ? isTradingAnalytics
              ? (runtime?.running?'자동매매 거래 근거·시장 자료·손익 분석 업무중':'자동매매 정지 · 매매분석 대기')
              : agent.id==='c7'
                ? (runtime?.mode==='paper'&&runtime.running?'모의 자동매매 업무중':'모의 자동매매 대기')
                : (runtime?.mode==='live'&&runtime.running?'실전 자동매매 업무중':'실전 자동매매 대기')
            : null;
          const displayAgent=runtimeStatus
            ? {...agent,status:runtimeStatus as Agent["status"],task:runtimeTask||agent.task}
            : agent.id.endsWith('_analytics')
              ? {...agent,status:(finance.data?.status?.error?'standby':finance.data?.status?.state==='업무중'?'active':'standby') as Agent["status"],task:finance.data?.status?.error?'⚠ '+finance.data.status.error:finance.data?.status?.task||'거래 근거·시장 자료·손익 분석 대기'}
              : agent;
          return (
            <div
              key={agent.id}
              draggable
              onDragStart={(event) => {
                setDraggingId(agent.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", agent.id);
              }}
              onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
              onDrop={(event) => handleDrop(agent.id, event)}
              onDragEnd={() => { setDraggingId(null); setIsDropTarget(false); }}
              className={`cursor-grab select-none ${draggingId === agent.id ? "opacity-40" : ""}`}
            >
              <AgentSeat
                agent={displayAgent}
                onClick={clickable ? () => onAgentClick(agent) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
