import type { LogEntry } from "@/lib/store";

export function ActivityLog({ log }: { log: LogEntry[] }) {
  return (
    <div className="flex flex-col gap-2 border-2 border-zinc-700 bg-zinc-950 p-3">
      <span className="text-sm font-bold text-zinc-300">실시간 작업 로그</span>
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {log.length === 0 && (
          <span className="text-[11px] text-zinc-600">
            아직 완료 보고가 없습니다. 작업이 끝나면 여기에 바로 표시됩니다.
          </span>
        )}
        {log.map((entry) => (
          <div key={entry.id} className="flex items-baseline gap-2 text-[11px]">
            <span className="shrink-0 font-mono text-zinc-600">{entry.time}</span>
            <span className="shrink-0 font-bold text-emerald-400">{entry.agentName}</span>
            <span className="truncate text-zinc-300">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
