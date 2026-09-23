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

const personByStatus: Record<Agent["status"], string> = {
  active: "🙂",
  standby: "🙂",
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
  const isOffline = agent.status === "offline";
  const isAnomaly = agent.task.startsWith("⚠");

  return (
    <div
      onClick={onClick}
      title={`${agent.name} · ${agent.task}`}
      className={`flex h-[76px] flex-col items-center justify-center gap-0.5 overflow-hidden border p-1 ${
        isAnomaly
          ? "border-rose-600 bg-rose-950/40"
          : "border-zinc-700 bg-zinc-900"
      } ${onClick ? "cursor-pointer hover:border-zinc-500" : ""}`}
    >
      <div className="relative flex h-5 w-7 shrink-0 items-center justify-center">
        <div className="h-full w-full border border-zinc-600 bg-zinc-950 p-0.5">
          <div className={`relative h-full w-full overflow-hidden ${screenColorByStatus[agent.status]}`}>
            {isActive && (
              <div className="agent-screen-active absolute left-0 h-0.5 w-full bg-emerald-400/60" />
            )}
          </div>
        </div>
        <span className="absolute -bottom-1 -right-1 text-[10px] leading-none">
          {isAnomaly
            ? "😱"
            : isOffline
              ? "🪑"
              : (
                  <span
                    className={
                      isActive
                        ? "agent-avatar-active"
                        : agent.status === "idle"
                          ? "agent-avatar-idle"
                          : ""
                    }
                  >
                    {personByStatus[agent.status]}
                  </span>
                )}
        </span>
      </div>

      <span className="w-full truncate text-center text-[9px] font-bold text-zinc-100">
        {agent.name}
      </span>

      <div className="flex items-center gap-1">
        <span
          className={`h-1 w-1 shrink-0 ${isAnomaly ? "bg-rose-500" : dotByStatus[agent.status]}`}
        />
        <span
          className={`text-[8px] font-bold ${isAnomaly ? "text-rose-400" : "text-zinc-400"}`}
        >
          {isAnomaly ? "이상발생" : labelByStatus[agent.status]}
        </span>
      </div>
      <span className="agent-task-marquee w-full min-w-0 overflow-hidden px-0.5 text-[8px] leading-[10px] text-white" title={agent.task}>
        <span className="agent-task-marquee-text"><span>{agent.task}</span><span aria-hidden="true">{agent.task}</span></span>
      </span>
    </div>
  );
}
