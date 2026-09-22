"use client";

import { useEffect, useState } from "react";
import type { NormalizedOrder } from "@/lib/integrations/orders";

const MARKET_LABEL: Record<string, string> = {
  coupang: "쿠팡",
  naver: "스마트스토어",
};

function krw(amount: number | null): string {
  return amount === null ? "금액 미확인" : `${amount.toLocaleString("ko-KR")}원`;
}

export function OrderPanel() {
  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/agent/orders", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        // API 키가 없으면 패널 자체를 숨긴다 (설정 안 한 곳에서 빈 상자만
        // 계속 보이지 않도록).
        if (res.status === 400) {
          setConfigured(false);
          return;
        }
        setConfigured(true);
        setOrders(data.orders ?? []);
        setErrors(data.errors ?? []);
      } catch {
        // 다음 주기에 재시도
      }
    };

    load();
    // 주문은 외부 API를 호출하므로 대시보드보다 느리게 갱신한다.
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshTick]);

  if (!configured) return null;

  const pending = orders.filter((o) => o.needsAcknowledgement);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const acknowledge = async (marketplace: string) => {
    const ids = pending
      .filter((o) => o.marketplace === marketplace && selected.has(o.id))
      .map((o) => o.id);
    if (ids.length === 0) {
      setNotice(`${MARKET_LABEL[marketplace]} 주문을 선택해 주세요.`);
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      // 누가 무엇을 처리했는지 남도록 작업으로 만들어 두고 실행한다.
      const taskRes = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: "store",
          agentId: "s6",
          instruction: `관제실에서 ${MARKET_LABEL[marketplace]} 발주 확인 ${ids.length}건`,
        }),
      });
      const { task } = await taskRes.json();

      const res = await fetch("/api/agent/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          kind: "order_place",
          marketplace,
          orderIds: ids,
        }),
      });
      const data = await res.json();

      if (data.executed) {
        setNotice(`✅ ${data.message}`);
        setSelected(new Set());
      } else if (data.approvalId) {
        // 관문이 막았다는 뜻. 승인 대기함에 올라가 있다.
        setNotice(`승인 대기함으로 넘어갔습니다 — ${data.reason}`);
      } else {
        setNotice(`❌ ${data.error ?? "처리하지 못했습니다."}`);
      }
    } catch {
      setNotice("❌ 요청이 실패했습니다.");
    } finally {
      setBusy(false);
      setRefreshTick((n) => n + 1);
    }
  };

  const markets = Array.from(new Set(pending.map((o) => o.marketplace)));

  return (
    <div className="flex flex-col gap-3 border-2 border-sky-800 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-sky-300">발주 확인 대기</span>
          <span className="border border-sky-800 px-1.5 py-0.5 font-mono text-[11px] font-bold text-sky-300">
            {String(pending.length).padStart(2, "0")}
          </span>
        </div>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          className="border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          새로고침
        </button>
      </div>

      {errors.map((e) => (
        <span key={e} className="text-[10px] text-rose-400">
          ⚠ {e}
        </span>
      ))}
      {notice && <span className="text-[11px] text-zinc-300">{notice}</span>}

      {pending.length === 0 && (
        <span className="text-[11px] text-zinc-600">
          발주 확인을 기다리는 주문이 없습니다.
        </span>
      )}

      <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
        {pending.map((order) => (
          <label
            key={`${order.marketplace}-${order.id}`}
            className="flex cursor-pointer items-center gap-2 border border-zinc-800 bg-zinc-900 p-2 hover:border-zinc-700"
          >
            <input
              type="checkbox"
              checked={selected.has(order.id)}
              onChange={() => toggle(order.id)}
              className="accent-sky-500"
            />
            <span className="shrink-0 border border-zinc-700 px-1 text-[10px] text-zinc-400">
              {MARKET_LABEL[order.marketplace] ?? order.marketplace}
            </span>
            <span className="flex-1 truncate text-[11px] text-zinc-200">
              {order.productName}
            </span>
            <span className="shrink-0 text-[10px] text-zinc-500">{order.quantity}개</span>
            <span className="shrink-0 font-mono text-[10px] text-zinc-300">
              {krw(order.amountKrw)}
            </span>
          </label>
        ))}
      </div>

      {markets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {markets.map((m) => (
            <button
              key={m}
              onClick={() => acknowledge(m)}
              disabled={busy}
              className="border border-sky-600 px-3 py-1 text-[11px] font-bold text-sky-300 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
            >
              {busy ? "처리 중..." : `${MARKET_LABEL[m] ?? m} 발주 확인`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
