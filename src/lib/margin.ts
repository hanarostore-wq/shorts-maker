// 소싱한 상품이 "얼마에 팔아야 남는 장사인지"를 계산한다.
// 화면(클라이언트)에서도 그대로 쓰기 때문에 서버 전용 코드는 넣지 않는다.

export interface ChannelPreset {
  id: string;
  name: string;
  /** 판매가 대비 떼이는 수수료 비율 (0.108 = 10.8%) */
  feeRate: number;
  note: string;
}

// 수수료는 카테고리/계약에 따라 달라지므로 어디까지나 "기본값"이다.
// 화면에서 직접 고칠 수 있게 해두고, 실제 정산서와 한 번은 맞춰보는 것을 권장.
export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: "smartstore", name: "스마트스토어", feeRate: 0.0585, note: "주문관리 2% + 매출연동 2% + 결제 수수료 가정" },
  { id: "coupang", name: "쿠팡 마켓플레이스", feeRate: 0.108, note: "카테고리별 판매 수수료 가정" },
  { id: "custom", name: "직접 입력", feeRate: 0.1, note: "채널 수수료를 직접 입력" },
];

export const DEFAULT_GOAL = 1_000_000;

/** "12,900원", "₩12,900", "12900원~15000원" 같은 문자열에서 첫 번째 금액만 숫자로 뽑는다. */
export function parsePriceToNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/\s/g, "").match(/\d[\d,]*/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface MarginInput {
  /** 상품 매입가 (1개 기준) */
  cost: number;
  /** 매입 배송비 등 1개당 들어가는 부대비용 */
  extraCost: number;
  /** 고객에게 보내는 택배비 중 내가 부담하는 금액 (무료배송이면 택배비 전액) */
  outboundShipping: number;
  /** 판매가 대비 수수료 비율 (0.108 = 10.8%) */
  feeRate: number;
  /** 판매가 */
  sellPrice: number;
}

export interface MarginResult {
  /** 판매가에서 떼이는 채널 수수료 */
  fee: number;
  /** 수수료를 제외하고 내 손에 들어오는 금액 */
  netRevenue: number;
  /** 매입가 + 부대비용 + 택배비 */
  totalCost: number;
  /** 1개 팔았을 때 남는 돈 */
  profit: number;
  /** 판매가 대비 순이익 비율 (0.2 = 20%) */
  marginRate: number;
}

export function calcMargin(input: MarginInput): MarginResult {
  const sellPrice = Math.max(0, input.sellPrice);
  const fee = sellPrice * input.feeRate;
  const netRevenue = sellPrice - fee;
  const totalCost = input.cost + input.extraCost + input.outboundShipping;
  const profit = netRevenue - totalCost;
  const marginRate = sellPrice > 0 ? profit / sellPrice : 0;
  return { fee, netRevenue, totalCost, profit, marginRate };
}

/**
 * 원하는 마진율을 맞추려면 얼마에 팔아야 하는지 역산한다.
 * 수수료율 + 목표 마진율이 100%를 넘으면 아무리 비싸게 팔아도 불가능해서 null.
 */
export function sellPriceForTargetMargin(
  input: Omit<MarginInput, "sellPrice">,
  targetMarginRate: number,
): number | null {
  const denominator = 1 - input.feeRate - targetMarginRate;
  if (denominator <= 0) return null;
  const totalCost = input.cost + input.extraCost + input.outboundShipping;
  const raw = totalCost / denominator;
  // 실제 판매가는 10원 단위로 올림 (목표 마진이 반올림 때문에 깎이지 않도록)
  return Math.ceil(raw / 10) * 10;
}

/** 목표 금액을 채우려면 몇 개를 팔아야 하는지. 남는 게 없으면 null. */
export function unitsForGoal(profitPerUnit: number, goal: number): number | null {
  if (profitPerUnit <= 0 || goal <= 0) return null;
  return Math.ceil(goal / profitPerUnit);
}

export function formatKRW(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
