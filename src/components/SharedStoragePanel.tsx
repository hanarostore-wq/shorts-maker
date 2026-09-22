"use client";

import { useEffect, useState } from "react";

interface StorageState {
  sharedStorageConfigured?: boolean;
  log?: Array<{
    id: string;
    time: string;
    agentId: string;
    agentName: string;
    message: string;
  }>;
  departments?: Array<{
    id: string;
    agents: Array<{ id: string; status: string; task: string }>;
  }>;
}

export function SharedStoragePanel() {
  const [state, setState] = useState<StorageState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = (await res.json()) as StorageState;
        if (!cancelled) setState(data);
      } catch {
        // 다음 주기에 재시도
      }
    };

    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const configured = state?.sharedStorageConfigured === true;
  const agent = state?.departments
    ?.find((department) => department.id === "ops")
    ?.agents.find((item) => item.id === "o5");
  const logs = (state?.log ?? []).filter((item) => item.agentId === "o5").slice(0, 8);

  return (
    <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="text-sm font-bold text-zinc-300">공유 저장소 상태</span>
        <span className={configured ? "text-[11px] font-bold text-emerald-400" : "text-[11px] font-bold text-rose-400"}>
          {configured ? "연결 정상" : "미연결"}
        </span>
      </div>

      <div className="flex flex-col gap-2 text-[11px]">
        <div className="flex items-center justify-between border border-zinc-800 bg-zinc-900 px-2 py-1.5">
          <span className="text-zinc-500">공유 Redis</span>
          <span className={configured ? "text-emerald-400" : "text-rose-400"}>
            {configured ? "Upstash 연결됨" : "환경변수 확인 필요"}
          </span>
        </div>
        <div className="flex items-center justify-between border border-zinc-800 bg-zinc-900 px-2 py-1.5">
          <span className="text-zinc-500">현재 직원 상태</span>
          <span className="text-zinc-300">{agent?.task ?? "상태 확인 중..."}</span>
        </div>
        <div className="flex items-center justify-between border border-zinc-800 bg-zinc-900 px-2 py-1.5">
          <span className="text-zinc-500">승인·작업 동기화</span>
          <span className={configured ? "text-emerald-400" : "text-amber-400"}>
            {configured ? "실시간 공유" : "메모리 폴백"}
          </span>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-600">
        이 저장소가 승인 대기함·작업 큐·일일 사용량을 여러 워커에 공유합니다.
        연결이 끊기면 결제·발주 같은 쓰기 동작은 자동으로 차단됩니다.
      </p>

      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-2">
        <span className="text-[11px] font-bold text-zinc-400">최근 작업 로그</span>
        {logs.length === 0 ? (
          <span className="text-[10px] text-zinc-600">아직 기록된 공유저장소 작업이 없습니다.</span>
        ) : (
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {logs.map((item) => (
              <div key={item.id} className="border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px]">
                <span className="text-zinc-600">{item.time}</span>{" "}
                <span className="text-zinc-300">{item.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
