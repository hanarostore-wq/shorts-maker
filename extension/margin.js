// 마진 계산 (웹 앱의 src/lib/margin.ts와 같은 공식).
// 확장앱은 번들러 없이 돌아가므로 같은 계산을 여기에 따로 둔다.

const CHANNEL_PRESETS = [
  { id: "smartstore", name: "스마트스토어", feeRate: 0.0585 },
  { id: "coupang", name: "쿠팡", feeRate: 0.108 },
  { id: "custom", name: "직접", feeRate: 0.1 },
];

function parsePriceToNumber(text) {
  if (!text) return null;
  const match = String(text).replace(/\s/g, "").match(/\d[\d,]*/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function calcMargin({ cost, extraCost, outboundShipping, feeRate, sellPrice }) {
  const price = Math.max(0, sellPrice);
  const fee = price * feeRate;
  const totalCost = cost + extraCost + outboundShipping;
  const profit = price - fee - totalCost;
  return {
    fee,
    totalCost,
    profit,
    marginRate: price > 0 ? profit / price : 0,
  };
}

function sellPriceForTargetMargin({ cost, extraCost, outboundShipping, feeRate }, targetMarginRate) {
  const denominator = 1 - feeRate - targetMarginRate;
  if (denominator <= 0) return null;
  const totalCost = cost + extraCost + outboundShipping;
  return Math.ceil(totalCost / denominator / 10) * 10;
}

function unitsForGoal(profitPerUnit, goal) {
  if (profitPerUnit <= 0 || goal <= 0) return null;
  return Math.ceil(goal / profitPerUnit);
}

function formatKRW(value) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}
