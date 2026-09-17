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

const personByStatus: Record<Agent["status"], string> = {
  active: "🧑‍💻",
  standby: "🧍",
  idle: "😴",
  offline: "",
};

const screenColorByStatus: Record<Agent["status"], string> = {
  active: "bg-emerald-950",
  standby: "bg-zinc-800",
  idle: "bg-zinc-900",
  offline: "bg-zinc-950",
};

export function AgentSeat({ agent }: { agent: Agent }) {
  const isActive = agent.status === "active";
  const isOffline = agent.status === "offline";

  return (
    <div className="flex flex-col items-center gap-1 border-2 border-zinc-700 bg-zinc-900 p-2">
      {/* 데스크 장면: 모니터가 위, 캐릭터가 그 아래에서 책상을 보고 앉아있음 */}
      <div className="flex h-16 w-14 flex-col items-center justify-end">
        {/* 모니터 */}
        <div className="h-6 w-9 border-2 border-zinc-600 bg-zinc-950 p-0.5">
          <div className={`relative h-full w-full overflow-hidden ${screenColorByStatus[agent.status]}`}>
            {isActive && (
              <div className="agent-screen-active absolute left-0 h-1 w-full bg-emerald-400/60" />
            )}
            {agent.status === "standby" && (
              <span className="agent-cursor-blink absolute bottom-0.5 left-0.5 h-2 w-1 bg-sky-400" />
            )}
          </div>
        </div>
        {/* 모니터 받침대 */}
        <div className="h-1 w-2 bg-zinc-700" />
        {/* 캐릭터 (책상 앞에 앉음) */}
        <div className="flex h-6 items-end justify-center">
          {!isOffline ? (
            <span
              className={`text-xl leading-none ${
                isActive
                  ? "agent-avatar-active"
                  : agent.status === "idle"
                    ? "agent-avatar-idle"
                    : ""
              }`}
            >
              {personByStatus[agent.status]}
            </span>
          ) : (
            <span className="text-lg leading-none opacity-40">🪑</span>
          )}
        </div>
        {/* 책상 */}
        <div className="h-1 w-14 bg-zinc-700" />
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
