import type { Department } from "@/lib/types";
import { AgentSeat } from "./AgentSeat";

export function DepartmentFloor({ department }: { department: Department }) {
  const activeCount = department.agents.filter((a) => a.status === "active").length;
  const utilization = Math.round((activeCount / department.agents.length) * 100);

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
        {department.agents.map((agent) => (
          <AgentSeat key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
