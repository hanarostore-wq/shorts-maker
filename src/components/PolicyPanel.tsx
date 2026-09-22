"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionKind, ActionPolicy, DailyUsage, PolicyConfig } from "@/lib/agent/types";
import { ACTION_LABELS, WRITE_ACTIONS } from "@/lib/agent/types";

function krw(amount: number | null): string {
  if (amount === null) return "-";
  return amount.toLocaleString("ko-KR");
}

/** 숫자 입력칸. 비우면 null(= 그 기준을 쓰지 않음)로 본다. */
function NumberCell({
  value,
  onCommit,
  suffix,
}: {
  value: number | null;
  onCommit: (next: number | null) => void;
  suffix: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // 비제어 입력으로 두고, 서버 값이 바뀌면(다른 담당자가 수정) DOM을 직접
  // 갱신한다. 단 지금 입력 중인 칸은 건드리지 않는다.
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    el.value = value === null ? "" : String(value);
  }, [value]);

  return (
    <span className="flex items-center gap-1">
      <input
        ref={ref}
        defaultValue={value === null ? "" : String(value)}
        onChange={(e) => {
          e.target.value = e.target.value.replace(/[^\d]/g, "");
        }}
        onBlur={(e) => onCommit(e.target.value === "" ? null : Number(e.target.value))}
        placeholder="제한없음"
        className="w-20 border border-zinc-700 bg-black px-1 py-0.5 text-right font-mono text-[10px] text-zinc-200 outline-none focus:border-emerald-600"
      />
      <span className="text-[10px] text-zinc-600">{suffix}</span>
    </span>
  );
}

export function PolicyPanel() {
  const [policy, setPolicy] = useState<PolicyConfig | null>(null);
  const [usage, setUsage] = useState<DailyUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/agent/policy", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setPolicy(data.policy);
        setUsage(data.usage);
      } catch {
        // 다음 주기에 재시도
      }
    };

    load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshTick]);

  const patch = async (kind: ActionKind, change: Partial<ActionPolicy>) => {
    if (!policy) return;
    // 화면에 먼저 반영하고 저장은 뒤에서 진행한다 (기존 관제실과 같은 방식).
    setPolicy({ ...policy, [kind]: { ...policy[kind], ...change } });
    setSaving(true);
    try {
      await fetch("/api/agent/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [kind]: { ...policy[kind], ...change } }),
      });
    } finally {
      setSaving(false);
      setRefreshTick((n) => n + 1);
    }
  };

  if (!policy) {
    return (
      <div className="border-2 border-zinc-700 bg-zinc-950 p-3 text-[11px] text-zinc-600">
        승인 정책 불러오는 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-zinc-300">자동 승인 정책</span>
        <span className="text-[10px] text-zinc-600">
          {saving ? "저장 중..." : `오늘 기준 ${usage?.date ?? "-"}`}
        </span>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-500">
        되돌리기 어려운 동작만 여기 나옵니다. 자동 승인을 꺼두면 임계값과 무관하게
        전부 승인 대기함으로 올라갑니다. 일일 상한에 도달하면 그 뒤로는 금액이
        작아도 자동 실행되지 않습니다.
      </p>

      <div className="flex flex-col gap-2">
        {WRITE_ACTIONS.map((kind) => {
          const rule = policy[kind];
          const usedAmount = usage?.amountKrw[kind] ?? 0;
          const usedCount = usage?.count[kind] ?? 0;
          // 일일 상한에 도달했으면 자동 승인이 켜져 있어도 실제론 멈춘 상태다.
          const amountCapped =
            rule.dailyAmountCapKrw !== null && usedAmount >= rule.dailyAmountCapKrw;
          const countCapped =
            rule.dailyCountCap !== null && usedCount >= rule.dailyCountCap;
          const halted = rule.autoApprove && (amountCapped || countCapped);

          return (
            <div
              key={kind}
              className="flex flex-col gap-2 border border-zinc-800 bg-zinc-900 p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => patch(kind, { autoApprove: !rule.autoApprove })}
                  className={`border px-2 py-0.5 text-[10px] font-bold ${
                    rule.autoApprove
                      ? "border-emerald-600 text-emerald-400"
                      : "border-zinc-600 text-zinc-500"
                  }`}
                >
                  {rule.autoApprove ? "자동 ON" : "자동 OFF"}
                </button>
                <span className="text-[11px] font-bold text-zinc-200">
                  {ACTION_LABELS[kind]}
                </span>
                {halted && (
                  <span className="border border-amber-700 px-1.5 text-[10px] font-bold text-amber-300">
                    일일 상한 도달 · 전부 승인 대기
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  건당 최대
                  <NumberCell
                    value={rule.maxAmountKrw}
                    suffix="원"
                    onCommit={(v) => patch(kind, { maxAmountKrw: v })}
                  />
                </label>
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  1회 최대
                  <NumberCell
                    value={rule.maxItemCount}
                    suffix="건"
                    onCommit={(v) => patch(kind, { maxItemCount: v ?? 1 })}
                  />
                </label>
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  일일 상한
                  <NumberCell
                    value={rule.dailyAmountCapKrw}
                    suffix="원"
                    onCommit={(v) => patch(kind, { dailyAmountCapKrw: v })}
                  />
                </label>
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  일일 건수
                  <NumberCell
                    value={rule.dailyCountCap}
                    suffix="건"
                    onCommit={(v) => patch(kind, { dailyCountCap: v })}
                  />
                </label>
              </div>

              {/* 오늘 자동으로 얼마가 나갔는지 항상 보이게 한다. */}
              <div className="flex flex-wrap gap-x-4 text-[10px]">
                <span className="text-zinc-600">
                  오늘 자동 집행{" "}
                  <span className={amountCapped ? "text-amber-300" : "text-zinc-300"}>
                    {krw(usedAmount)}원
                  </span>
                  {rule.dailyAmountCapKrw !== null && (
                    <span className="text-zinc-700"> / {krw(rule.dailyAmountCapKrw)}원</span>
                  )}
                </span>
                <span className="text-zinc-600">
                  건수{" "}
                  <span className={countCapped ? "text-amber-300" : "text-zinc-300"}>
                    {usedCount}건
                  </span>
                  {rule.dailyCountCap !== null && (
                    <span className="text-zinc-700"> / {rule.dailyCountCap}건</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
