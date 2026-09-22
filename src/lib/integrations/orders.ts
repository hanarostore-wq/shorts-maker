import { COUPANG_ORDER_STATUS, COUPANG_PATHS, NAVER_PATHS } from "./endpoints";
import { coupangRequest, getCoupangCredentials, isCoupangConfigured } from "./coupangAuth";
import { naverRequest, isNaverConfigured } from "./naverAuth";

// 쿠팡과 네이버의 주문을 같은 모양으로 맞춰서 관제실에 넘긴다.
// 관제실 화면은 어느 쇼핑몰에서 온 주문인지 신경 쓰지 않아도 된다.

export type Marketplace = "coupang" | "naver";

export interface NormalizedOrder {
  marketplace: Marketplace;
  /** 발주 확인에 쓰는 식별자 (쿠팡: shipmentBoxId, 네이버: productOrderId) */
  id: string;
  orderedAt: string;
  buyerName: string | null;
  productName: string;
  quantity: number;
  amountKrw: number | null;
  status: string;
  /** 아직 발주 확인을 하지 않은 주문인지 */
  needsAcknowledgement: boolean;
}

function toIsoOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value;
}

function toNumberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** 'YYYY-MM-DD' (Asia/Seoul) */
function seoulDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// ─────────────────────────── 쿠팡 ───────────────────────────

interface CoupangOrderItem {
  sellerProductName?: string;
  vendorItemName?: string;
  shippingCount?: number;
  orderPrice?: number;
}

interface CoupangOrderSheet {
  shipmentBoxId?: number | string;
  orderId?: number | string;
  orderedAt?: string;
  status?: string;
  orderer?: { name?: string };
  orderItems?: CoupangOrderItem[];
}

export async function fetchCoupangOrders(options: {
  /** 조회 시작일 'YYYY-MM-DD'. 기본: 7일 전 */
  from?: string;
  to?: string;
  /** 기본은 결제완료(=아직 발주 확인 전) */
  status?: string;
}): Promise<NormalizedOrder[]> {
  const { vendorId } = getCoupangCredentials();
  const from = options.from ?? seoulDate(-7);
  const to = options.to ?? seoulDate(0);
  const status = options.status ?? COUPANG_ORDER_STATUS.결제완료;

  const path = COUPANG_PATHS.ordersheets(vendorId);
  const query = `createdAtFrom=${from}&createdAtTo=${to}&status=${status}&maxPerPage=50`;

  const data = await coupangRequest<{ data?: CoupangOrderSheet[] }>({
    method: "GET",
    path,
    query,
    label: "쿠팡 주문 조회",
  });

  return (data.data ?? []).map((sheet) => {
    const items = sheet.orderItems ?? [];
    const quantity = items.reduce((sum, i) => sum + (i.shippingCount ?? 0), 0);
    const amount = items.reduce((sum, i) => sum + (i.orderPrice ?? 0), 0);
    const firstName = items[0]?.sellerProductName ?? items[0]?.vendorItemName ?? "상품명 확인 불가";

    return {
      marketplace: "coupang" as const,
      id: String(sheet.shipmentBoxId ?? sheet.orderId ?? ""),
      orderedAt: toIsoOrEmpty(sheet.orderedAt),
      buyerName: sheet.orderer?.name ?? null,
      productName: items.length > 1 ? `${firstName} 외 ${items.length - 1}건` : firstName,
      quantity: quantity || items.length || 1,
      amountKrw: amount > 0 ? amount : null,
      status: sheet.status ?? status,
      // ACCEPT(결제완료)가 아직 발주 확인 전 상태다.
      needsAcknowledgement: (sheet.status ?? status) === COUPANG_ORDER_STATUS.결제완료,
    };
  });
}

// ─────────────────────────── 네이버 ───────────────────────────

interface NaverProductOrder {
  productOrderId?: string;
  productOrderStatus?: string;
  productName?: string;
  quantity?: number;
  totalPaymentAmount?: number;
}

interface NaverOrderWrapper {
  productOrder?: NaverProductOrder;
  order?: { ordererName?: string; orderDate?: string };
}

export async function fetchNaverOrders(options: {
  from?: string;
  to?: string;
}): Promise<NormalizedOrder[]> {
  const from = options.from ?? seoulDate(-7);
  const to = options.to ?? seoulDate(0);

  const data = await naverRequest<{ data?: NaverOrderWrapper[] }>({
    method: "POST",
    path: NAVER_PATHS.productOrders,
    body: { from: `${from}T00:00:00.000+09:00`, to: `${to}T23:59:59.999+09:00` },
    label: "네이버 주문 조회",
  });

  return (data.data ?? []).map((row) => {
    const po = row.productOrder ?? {};
    const status = po.productOrderStatus ?? "UNKNOWN";
    return {
      marketplace: "naver" as const,
      id: String(po.productOrderId ?? ""),
      orderedAt: toIsoOrEmpty(row.order?.orderDate),
      buyerName: row.order?.ordererName ?? null,
      productName: po.productName ?? "상품명 확인 불가",
      quantity: po.quantity ?? 1,
      amountKrw: toNumberOrNull(po.totalPaymentAmount),
      status,
      // PAYED(결제완료)가 아직 발주 확인 전 상태다.
      needsAcknowledgement: status === "PAYED",
    };
  });
}

/**
 * 설정된 쇼핑몰의 주문을 모두 모아온다.
 *
 * 한쪽이 실패해도 다른 쪽 결과는 살린다. 쿠팡이 잠깐 막혔다고 네이버 주문까지
 * 못 보게 되면 관제실이 멈춰버리기 때문이다.
 */
export async function fetchAllOrders(options: { from?: string; to?: string } = {}): Promise<{
  orders: NormalizedOrder[];
  errors: string[];
}> {
  const tasks: Array<Promise<NormalizedOrder[]>> = [];
  const names: string[] = [];

  if (isCoupangConfigured()) {
    tasks.push(fetchCoupangOrders(options));
    names.push("쿠팡");
  }
  if (isNaverConfigured()) {
    tasks.push(fetchNaverOrders(options));
    names.push("네이버");
  }

  const settled = await Promise.allSettled(tasks);
  const orders: NormalizedOrder[] = [];
  const errors: string[] = [];

  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      orders.push(...result.value);
    } else {
      const reason = result.reason;
      errors.push(`${names[i]}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  });

  // 최근 주문이 위로 오게 한다.
  orders.sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
  return { orders, errors };
}
