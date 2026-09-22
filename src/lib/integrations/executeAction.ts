import type { AgentAction } from "@/lib/agent/types";
import { acknowledgeOrders, updatePrice, type FulfillmentResult } from "./fulfillment";
import type { Marketplace } from "./orders";

// 관문을 통과한 동작을 실제로 실행한다.
//
// 자동 통과된 경우(/api/agent/fulfill)와 사람이 승인한 경우
// (/api/agent/approvals) 모두 이 함수를 거친다. 두 경로가 갈라지면
// 한쪽만 고쳐져 동작이 달라지는 일이 생기기 때문이다.

function isMarketplace(value: string): value is Marketplace {
  return value === "coupang" || value === "naver";
}

/**
 * 실행할 수 있는 동작이면 실행하고 결과를 돌려준다.
 * 이 파일이 다루지 않는 종류면 null을 돌려준다 (예: 브라우저로 하는 수집).
 */
export async function executeGatedAction(
  action: AgentAction,
): Promise<FulfillmentResult | null> {
  if (!isMarketplace(action.site)) return null;

  const payload = action.payload ?? {};

  if (action.kind === "order_place") {
    const orderIds = Array.isArray(payload.orderIds)
      ? (payload.orderIds as unknown[]).map(String).filter(Boolean)
      : [];
    if (orderIds.length === 0) return null;
    return acknowledgeOrders(action.site, orderIds);
  }

  if (action.kind === "listing_update") {
    const productId = payload.productId ? String(payload.productId) : "";
    const priceKrw = Number(payload.priceKrw);
    if (!productId || !Number.isFinite(priceKrw)) return null;
    return updatePrice(action.site, productId, priceKrw);
  }

  return null;
}
