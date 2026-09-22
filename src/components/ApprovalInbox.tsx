"use client";

import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "@/lib/agent/types";
import { ACTION_LABELS } from "@/lib/agent/types";

// 승인자 이름은 이 PC에 기억해 둔다. 누가 승인했는지 기록에 남기기 위한
// 것이라, 매번 입력하게 하면 아무도 안 쓰게 된다.
const NAME_KEY = "unyoung:approver";

function formatKrw(amount: number | null): string {
  if (amount === null) return "금액 미확인";
  return `${amount.toLocaleString("ko-KR")}원`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function ApprovalInbox() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 값을 바꾸면 아래 effect가 다시 돌면서 즉시 한 번 더 불러온다.
  const [refreshTick, setRefreshTick] = useState(0);

  // 승인자 이름 칸은 비제어 입력으로 둔다. 저장된 이름을 서버 렌더링
  // 단계에서는 알 수 없으므로, 화면이 붙은 뒤 DOM에 직접 채워 넣는다.
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved && nameRef.current) nameRef.current.value = saved;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/agent/approvals?state=pending", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setApprovals(data.approvals ?? []);
      } catch {
        // 다음 주기에 재시도
      }
    };

    load();
    // 관제실 대시보드와 같은 4초 주기로 맞춘다.
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshTick]);

  const decide = async (approvalId: string, approve: boolean) => {
    const name = nameRef.current?.value.trim() ?? "";
    if (!name) {
      setNotice("승인자 이름을 먼저 입력해 주세요.");
      return;
    }
    localStorage.setItem(NAME_KEY, name);
    setBusyId(approvalId);
    setNotice(null);
    try {
      const res = await fetch("/api/agent/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, approve, decidedBy: name }),
      });
      const data = await res.json();
      // 다른 담당자가 먼저 처리한 경우 서버가 409로 막아준다.
      if (!res.ok) setNotice(data.error ?? "처리하지 못했습니다.");
    } catch {
      setNotice("요청이 실패했습니다. 잠시 후 다시 눌러주세요.");
    } finally {
      setBusyId(null);
      setRefreshTick((n) => n + 1);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-2 border-amber-700 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-300">승인 대기함</span>
          <span className="border border-amber-700 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-300">
            {String(approvals.length).padStart(2, "0")}
          </span>
        </div>
        <input
          ref={nameRef}
          onBlur={(e) => localStorage.setItem(NAME_KEY, e.target.value.trim())}
          placeholder="승인자 이름"
          className="w-32 border border-zinc-700 bg-black px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-amber-600"
        />
      </div>

      {notice && <span className="text-[11px] text-rose-400">{notice}</span>}

      {approvals.length === 0 && (
        <span className="text-[11px] text-zinc-600">
          승인을 기다리는 작업이 없습니다. 임계값을 넘는 발주·결제·발송이 생기면
          여기에 올라옵니다.
        </span>
      )}

      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {approvals.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-2 border border-zinc-800 bg-zinc-900 p-2"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="border border-amber-700 px-1.5 text-[10px] font-bold text-amber-300">
                {ACTION_LABELS[item.action.kind] ?? item.action.kind}
              </span>
              <span className="font-mono text-[10px] text-zinc-600">
                {formatTime(item.createdAt)}
              </span>
              <span className="text-[11px] text-zinc-200">{item.action.summary}</span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
              <span>
                금액 <span className="text-zinc-300">{formatKrw(item.action.amountKrw)}</span>
              </span>
              <span>
                건수 <span className="text-zinc-300">{item.action.itemCount}건</span>
              </span>
              <span>
                사이트 <span className="text-zinc-300">{item.action.site}</span>
              </span>
            </div>

            {/* 왜 사람에게 올라왔는지 반드시 보여준다. 이유를 모르면
                승인 버튼은 그냥 통과 버튼이 된다. */}
            <span className="text-[11px] text-amber-400">↑ {item.reason}</span>

            {item.action.url && (
              <span className="truncate font-mono text-[10px] text-zinc-600">
                {item.action.url}
              </span>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => decide(item.id, true)}
                disabled={busyId === item.id}
                className="border border-emerald-600 px-3 py-1 text-[11px] font-bold text-emerald-400 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
              >
                {busyId === item.id ? "처리 중..." : "승인"}
              </button>
              <button
                onClick={() => decide(item.id, false)}
                disabled={busyId === item.id}
                className="border border-rose-700 px-3 py-1 text-[11px] font-bold text-rose-400 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
              >
                거부
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
