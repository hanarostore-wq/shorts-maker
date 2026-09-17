import type { Agent } from "@/lib/types";

const dotByStatus: Record<Agent["status"], string> = {
  active: "bg-emerald-400",
  standby: "bg-sky-400",
  idle: "bg-zinc-500",
  offline: "bg-rose-500",
};

export function AgentTile({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotByStatus[agent.status]}`} />
        <span className="truncate text-xs font-medium text-zinc-200">{agent.name}</span>
      </div>
      <span className="truncate text-[11px] text-zinc-500">{agent.task}</span>
    </div>
  );
}
