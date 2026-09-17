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
  offline: "bg-zinc-600",
};

const badgeByStatus: Record<Agent["status"], string> = {
  active: "🟢",
  standby: "🔵",
  idle: "😴",
  offline: "",
};

const screenColorByStatus: Record<Agent["status"], string> = {
  active: "bg-emerald-950",
  standby: "bg-zinc-800",
  idle: "bg-zinc-900",
  offline: "bg-zinc-950",
};

export function AgentSeat({
  agent,
  onClick,
}: {
  agent: Agent;
  onClick?: () => void;
}) {
  const isActive = agent.status === "active";
  const isAnomaly = agent.task.startsWith("⚠");

  return (
    <div
      onClick={onClick}
      className={`flex h-[124px] flex-col items-center gap-1 border-2 p-2 ${
        isAnomaly
          ? "border-rose-600 bg-rose-950/40"
          : "border-zinc-700 bg-zinc-900"
      } ${onClick ? "cursor-pointer hover:border-zinc-500" : ""}`}
    >
      {/* 모니터 한 줄, 상태는 오른쪽 아래에 작은 아이콘으로만 표시 */}
      <div className="relative flex h-9 w-11 shrink-0 items-center justify-center">
        <div className="h-7 w-11 border-2 border-zinc-600 bg-zinc-950 p-0.5">
          <div className={`relative h-full w-full overflow-hidden ${screenColorByStatus[agent.status]}`}>
            {isActive && (
              <div className="agent-screen-active absolute left-0 h-1 w-full bg-emerald-400/60" />
            )}
          </div>
        </div>
        <span className="absolute -bottom-1 -right-1 text-xs leading-none">
          {isAnomaly ? "⚠️" : badgeByStatus[agent.status]}
        </span>
      </div>

      <span className="w-full truncate text-center text-[11px] font-bold text-zinc-100">
        {agent.name}
      </span>
      <span
        className={`line-clamp-2 w-full text-center text-[10px] leading-tight ${
          isAnomaly ? "text-rose-400" : "text-zinc-500"
        }`}
      >
        {agent.task}
      </span>
      <div className="mt-auto flex items-center gap-1">
        <span
          className={`h-1.5 w-1.5 shrink-0 ${isAnomaly ? "bg-rose-500" : dotByStatus[agent.status]}`}
        />
        <span
          className={`text-[10px] font-bold ${isAnomaly ? "text-rose-400" : "text-zinc-400"}`}
        >
          {isAnomaly ? "이상발생" : labelByStatus[agent.status]}
        </span>
      </div>
    </div>
  );
}
