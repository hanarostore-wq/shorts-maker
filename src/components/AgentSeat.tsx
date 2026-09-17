import type { Agent } from "@/lib/types";

const labelByStatus: Record<Agent["status"], string> = {
  active: "업무중",
  standby: "대기",
  idle: "휴면",
  offline: "퇴근",
};

const dotByStatus: Record<Agent["status"], string> = {
  active: "bg-emerald-400",
  standby: "bg-sky-400",
  idle: "bg-zinc-500",
  offline: "bg-rose-500",
};

const avatarByStatus: Record<Agent["status"], string> = {
  active: "🧑‍💻",
  standby: "🧍",
  idle: "😴",
  offline: "🚫",
};

export function AgentSeat({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col items-center gap-1 border-2 border-zinc-700 bg-zinc-900 p-2">
      <div className="flex h-9 w-9 items-center justify-center border-2 border-zinc-700 bg-zinc-950 text-base">
        {avatarByStatus[agent.status]}
      </div>
      <span className="w-full truncate text-center text-[11px] font-bold text-zinc-100">
        {agent.name}
      </span>
      <span className="w-full truncate text-center text-[10px] text-zinc-500">
        {agent.task}
      </span>
      <div className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 ${dotByStatus[agent.status]}`} />
        <span className="text-[10px] font-bold text-zinc-400">
          {labelByStatus[agent.status]}
        </span>
      </div>
    </div>
  );
}
