import type { Department } from "@/lib/types";
import { AgentTile } from "./AgentTile";

export function DepartmentCard({ department }: { department: Department }) {
  const activeCount = department.agents.filter((a) => a.status === "active").length;
  const utilization = Math.round((activeCount / department.agents.length) * 100);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{department.icon}</span>
          <span className="text-sm font-semibold text-zinc-100">{department.name}</span>
        </div>
        <span className="font-mono text-sm font-bold text-emerald-400">
          {department.agents.length}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${utilization}%` }}
        />
      </div>
      <span className="text-[11px] text-zinc-500">가동률 {utilization}%</span>

      <div className="grid grid-cols-1 gap-1.5">
        {department.agents.map((agent) => (
          <AgentTile key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
