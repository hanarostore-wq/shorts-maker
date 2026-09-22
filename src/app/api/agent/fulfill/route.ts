import { NextResponse } from "next/server";
import { gateAction } from "@/lib/agent/store";
import type { AgentAction } from "@/lib/agent/types";
import { fetchAllOrders, type Marketplace } from "@/lib/integrations/orders";
import { executeGatedAction } from "@/lib/integrations/executeAction";

// 발주 확인·판매가 변경처럼 외부에 흔적이 남는 동작을 실행한다.
// 실행 전에 반드시 승인 관문을 통과해야 한다.
export const maxDuration = 60;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isMarketplace(value: unknown): value is Marketplace {
  return value === "coupang" || value === "naver";
}

/**
 * 관문을 통과한 동작을 실행한다. 사람이 승인한 경로(/api/agent/approvals)와
 * 같은 실행기를 쓴다 — 두 경로가 갈라지면 한쪽만 고쳐지기 때문이다.
 */
async function runAction(action: AgentAction) {
  try {
    const result = await executeGatedAction(action);
    if (!result) {
      return NextResponse.json(
        { executed: false, error: "이 서버가 실행할 수 있는 동작이 아닙니다." },
        { status: 400 },
      );
    }
    return NextResponse.json({ executed: result.ok, message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ executed: false, error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { taskId, kind, marketplace } = body ?? {};

  if (!taskId || !isMarketplace(marketplace)) {
    return NextResponse.json(
      { error: "taskId와 marketplace(coupang|naver)는 필수입니다." },
      { status: 400 },
    );
  }

  // ── 발주 확인 ──────────────────────────────────────────────
  if (kind === "order_place") {
    const orderIds: string[] = Array.isArray(body.orderIds)
      ? body.orderIds.map(String).filter(Boolean)
      : [];
    if (orderIds.length === 0) {
      return NextResponse.json({ error: "orderIds가 필요합니다." }, { status: 400 });
    }

    // 금액은 호출한 쪽이 보낸 값을 믿지 않고 실제 주문에서 다시 계산한다.
    // 금액을 속여 임계값을 통과하는 일이 없어야 하기 때문이다.
    const { orders } = await fetchAllOrders({});
    const matched = orders.filter(
      (o) => o.marketplace === marketplace && orderIds.includes(o.id),
    );

    // 주문을 하나라도 확인하지 못했으면 금액을 알 수 없는 것으로 둔다.
    // 정책 엔진은 이를 임계값 초과와 같게 취급해 사람에게 올린다.
    const allFound = matched.length === orderIds.length;
    const amountKrw =
      allFound && matched.every((o) => o.amountKrw !== null)
        ? matched.reduce((sum, o) => sum + (o.amountKrw ?? 0), 0)
        : null;

    const action: AgentAction = {
      id: newId(),
      kind: "order_place",
      site: marketplace,
      url: "",
      summary: `발주 확인 ${orderIds.length}건 (${marketplace === "coupang" ? "쿠팡" : "스마트스토어"})`,
      amountKrw,
      itemCount: orderIds.length,
      payload: { orderIds },
    };

    const gate = await gateAction(taskId, action);
    if (!gate.allowed) {
      return NextResponse.json({
        executed: false,
        reason: gate.approval.reason,
        approvalId: gate.approval.id,
      });
    }

    return runAction(action);
  }

  // ── 판매가 변경 ────────────────────────────────────────────
  if (kind === "listing_update") {
    const productId = body.productId ? String(body.productId) : "";
    const priceKrw = Number(body.priceKrw);
    if (!productId || !Number.isFinite(priceKrw) || priceKrw <= 0) {
      return NextResponse.json(
        { error: "productId와 0보다 큰 priceKrw가 필요합니다." },
        { status: 400 },
      );
    }

    const action: AgentAction = {
      id: newId(),
      kind: "listing_update",
      site: marketplace,
      url: "",
      summary: `판매가 변경 — 상품 ${productId} → ${priceKrw.toLocaleString("ko-KR")}원`,
      // 판매가 변경은 돈이 빠져나가는 동작이 아니므로 금액 기준을 쓰지 않는다.
      // 건수 기준과 일일 상한으로만 통제한다.
      amountKrw: null,
      itemCount: 1,
      payload: { productId, priceKrw },
    };

    const gate = await gateAction(taskId, action);
    if (!gate.allowed) {
      return NextResponse.json({
        executed: false,
        reason: gate.approval.reason,
        approvalId: gate.approval.id,
      });
    }

    return runAction(action);
  }

  return NextResponse.json(
    { error: "kind는 order_place 또는 listing_update여야 합니다." },
    { status: 400 },
  );
}
