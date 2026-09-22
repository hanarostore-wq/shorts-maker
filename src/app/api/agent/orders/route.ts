import { NextResponse } from "next/server";
import { fetchAllOrders } from "@/lib/integrations/orders";
import { isCoupangConfigured } from "@/lib/integrations/coupangAuth";
import { isNaverConfigured } from "@/lib/integrations/naverAuth";

// 주문 조회는 읽기 전용이라 승인 관문을 거치지 않는다.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCoupangConfigured() && !isNaverConfigured()) {
    return NextResponse.json(
      { error: "쿠팡·네이버 API 키가 모두 설정되지 않았습니다." },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const { orders, errors } = await fetchAllOrders({ from, to });

  // 한쪽 쇼핑몰이 실패해도 다른 쪽 주문은 보여준다. 실패 사실은 함께 알린다.
  return NextResponse.json({
    orders,
    pendingCount: orders.filter((o) => o.needsAcknowledgement).length,
    errors,
  });
}
