import type { Agent, Department } from "@/lib/types";
import type { LogEntry } from "@/lib/store";
import { AgentSeat } from "./AgentSeat";
import { getAgentPlatforms } from "@/lib/agentIntegrations";

export function DepartmentFloor({
  department,
  log,
  onAgentClick,
}: {
  department: Department;
  log: LogEntry[];
  onAgentClick: (agent: Agent) => void;
}) {
  const activeCount = department.agents.filter((a) => a.status === "active").length;
  const utilization = Math.round((activeCount / department.agents.length) * 100);
  const deptLog = log.filter((entry) => entry.departmentId === department.id).slice(0, 5);
  const anomalyCount = department.agents.filter((a) => a.task.startsWith("⚠")).length;

  return (
    <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3">
      <div className="flex items-center justify-between border-b-2 border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{department.icon}</span>
          <span className="text-sm font-bold text-zinc-100">{department.name}</span>
        </div>
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

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {department.agents.map((agent) => {
          const clickable = getAgentPlatforms(agent.id).length > 0;
          return (
            <AgentSeat
              key={agent.id}
              agent={agent}
              onClick={clickable ? () => onAgentClick(agent) : undefined}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t-2 border-zinc-800 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-zinc-400">부서 현황</span>
          {anomalyCount > 0 && (
            <span className="text-[11px] font-bold text-rose-400">
              ⚠ 이상 {anomalyCount}건
            </span>
          )}
        </div>
        {deptLog.length === 0 ? (
          <span className="text-[11px] text-zinc-600">아직 처리한 작업이 없습니다.</span>
        ) : (
          deptLog.map((entry) => (
            <div key={entry.id} className="flex items-baseline gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-zinc-600">{entry.time}</span>
              <span
                className={`shrink-0 font-bold ${
                  entry.message.startsWith("⚠") ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {entry.agentName}
              </span>
              <span className="truncate text-zinc-300">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
