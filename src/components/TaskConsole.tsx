"use client";

import { useEffect, useState } from "react";
import type { Department } from "@/lib/types";
import type { AgentTask, TaskStatus } from "@/lib/agent/types";

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "대기",
  running: "실행 중",
  waiting_approval: "승인 대기",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
};

const STATUS_TONE: Record<TaskStatus, string> = {
  queued: "border-zinc-600 text-zinc-400",
  running: "border-sky-600 text-sky-400",
  waiting_approval: "border-amber-700 text-amber-300",
  done: "border-emerald-600 text-emerald-400",
  failed: "border-rose-700 text-rose-400",
  cancelled: "border-zinc-700 text-zinc-600",
};

export function TaskConsole({ departments }: { departments: Department[] }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // 부서/직원 선택값은 "부서id:직원id" 한 문자열로 다룬다.
  const options = departments.flatMap((d) =>
    d.agents.map((a) => ({ value: `${d.id}:${a.id}`, label: `${d.name} · ${a.name}` })),
  );

  // 아직 아무도 고르지 않았으면 첫 번째 직원을 쓴다. 기본값을 state에
  // 넣어두면 부서 목록이 나중에 도착했을 때 어긋나므로 매번 계산한다.
  const effectiveTarget = target || options[0]?.value || "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/agent/tasks", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setTasks(data.tasks ?? []);
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
  }, [refreshTick]);

  const send = async () => {
    const text = instruction.trim();
    const [departmentId, agentId] = effectiveTarget.split(":");
    if (!text || !departmentId || !agentId) {
      setNotice("담당 직원과 지시 내용을 입력해 주세요.");
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId, agentId, instruction: text }),
      });
      if (!res.ok) {
        const data = await res.json();
        setNotice(data.error ?? "지시를 등록하지 못했습니다.");
        return;
      }
      setInstruction("");
    } catch {
      setNotice("요청이 실패했습니다.");
    } finally {
      setSending(false);
      setRefreshTick((n) => n + 1);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3">
      <span className="text-sm font-bold text-zinc-300">업무 지시</span>

      <div className="flex flex-wrap gap-2">
        <select
          value={effectiveTarget}
          onChange={(e) => setTarget(e.target.value)}
          className="border border-zinc-700 bg-black px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sending) send();
          }}
          placeholder="예) 나이키 운동화 신상품 20개 수집해줘"
          className="min-w-48 flex-1 border border-zinc-700 bg-black px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
        />
        <button
          onClick={send}
          disabled={sending}
          className="border border-emerald-600 px-3 py-1 text-[11px] font-bold text-emerald-400 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
        >
          {sending ? "등록 중..." : "지시"}
        </button>
      </div>

      {notice && <span className="text-[11px] text-rose-400">{notice}</span>}

      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {tasks.length === 0 && (
          <span className="text-[11px] text-zinc-600">
            아직 내린 지시가 없습니다. 데스크톱 앱이 켜져 있어야 실행됩니다.
          </span>
        )}
        {tasks.map((task) => (
          <div key={task.id} className="flex flex-col gap-1 border border-zinc-800 bg-zinc-900 p-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className={`shrink-0 border px-1.5 text-[10px] font-bold ${STATUS_TONE[task.status]}`}
              >
                {STATUS_LABEL[task.status]}
              </span>
              <span className="text-[11px] text-zinc-200">{task.instruction}</span>
            </div>
            {task.error && <span className="text-[10px] text-rose-400">⚠ {task.error}</span>}
            {task.steps.length > 0 && (
              <div className="flex flex-col gap-0.5 border-l border-zinc-800 pl-2">
                {task.steps.slice(-4).map((step, i) => (
                  <span key={i} className="text-[10px] text-zinc-500">
                    <span className={step.ok ? "text-emerald-500" : "text-rose-500"}>
                      {step.ok ? "✓" : "✕"}
                    </span>{" "}
                    {step.summary}
                    {step.decision === "manual" && (
                      <span className="text-amber-500"> (사람 승인)</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
