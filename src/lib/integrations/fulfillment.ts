import { COUPANG_PATHS, NAVER_PATHS } from "./endpoints";
import { coupangRequest, getCoupangCredentials } from "./coupangAuth";
import { naverRequest } from "./naverAuth";
import type { Marketplace } from "./orders";

// 외부에 흔적이 남는 동작들. 이 파일의 함수는 반드시 승인 관문
// (src/lib/agent/store.ts의 gateAction)을 통과한 뒤에만 불러야 한다.
// 관문을 건너뛰고 직접 부르지 말 것.

export interface FulfillmentResult {
  ok: boolean;
  message: string;
}

/**
 * 발주 확인 (= 상품준비중 처리).
 *
 * 주문을 실제로 접수 처리하는 동작이라 되돌리기 어렵다.
 */
export async function acknowledgeOrders(
  marketplace: Marketplace,
  orderIds: string[],
): Promise<FulfillmentResult> {
  if (orderIds.length === 0) {
    return { ok: false, message: "발주 확인할 주문이 없습니다." };
  }

  if (marketplace === "coupang") {
    const { vendorId } = getCoupangCredentials();
    await coupangRequest({
      method: "PUT",
      path: COUPANG_PATHS.acknowledgement(vendorId),
      body: {
        vendorId,
        // 쿠팡은 주문서 묶음 단위(shipmentBoxId)로 발주 확인을 받는다.
        shipmentBoxIds: orderIds.map((id) => Number(id)).filter(Number.isFinite),
      },
      label: "쿠팡 발주 확인",
    });
    return { ok: true, message: `쿠팡 발주 확인 ${orderIds.length}건 완료` };
  }

  await naverRequest({
    method: "POST",
    path: NAVER_PATHS.confirmOrders,
    body: { productOrderIds: orderIds },
    label: "네이버 발주 확인",
  });
  return { ok: true, message: `스마트스토어 발주 확인 ${orderIds.length}건 완료` };
}

/**
 * 판매가 변경.
 *
 * 쿠팡은 경로에 가격을 담아 PUT하고, 네이버는 원상품을 수정한다.
 */
export async function updatePrice(
  marketplace: Marketplace,
  productId: string,
  priceKrw: number,
): Promise<FulfillmentResult> {
  if (!Number.isFinite(priceKrw) || priceKrw <= 0) {
    return { ok: false, message: `판매가가 올바르지 않습니다: ${priceKrw}` };
  }

  if (marketplace === "coupang") {
    await coupangRequest({
      method: "PUT",
      path: COUPANG_PATHS.price(productId, Math.round(priceKrw)),
      label: "쿠팡 판매가 변경",
    });
    return {
      ok: true,
      message: `쿠팡 상품 ${productId} 판매가 ${priceKrw.toLocaleString("ko-KR")}원으로 변경`,
    };
  }

  await naverRequest({
    method: "PUT",
    path: NAVER_PATHS.originProduct(productId),
    body: { originProduct: { salePrice: Math.round(priceKrw) } },
    label: "네이버 판매가 변경",
  });
  return {
    ok: true,
    message: `스마트스토어 상품 ${productId} 판매가 ${priceKrw.toLocaleString("ko-KR")}원으로 변경`,
  };
}
