export type PaperAction = "BUY" | "SELL" | "HOLD" | "PULL_QUOTES" | "KILL";
export type FallbackRung = "RUN" | "REDUCE" | "HOLD_LATE" | "RULES_ONLY" | "KILL";

export type PaperMarket = {
  price: number;
  prices: number[];
  bestAsk?: number;
  bestBid?: number;
  askSize?: number;
  bidSize?: number;
  dataAgeMs?: number;
  websocketHealthy?: boolean;
};

export type SevenJudgments = {
  regime: string;
  direction: string;
  toxicFlow: string;
  liquidityStress: string;
  quoteEnvironment: string;
  inventoryPressure: string;
  executionHealth: string;
};

export type PaperDecision = {
  action: PaperAction;
  fallback: FallbackRung;
  provider: "JEV" | "RULES_ONLY";
  reason: string;
  state: { mid: number; spreadBps: number; imbalance: number; vwap: number; rsi: number | null; smaFast: number | null; smaSlow: number | null };
  judgments: SevenJudgments;
  risk: { allowed: boolean; code: string; message: string };
};

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const sma = (values: number[], period: number) => values.length >= period ? average(values.slice(-period)) : null;
const rsi = (values: number[]) => {
  if (values.length < 15) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]).slice(-14);
  const gains = average(changes.filter((value) => value > 0));
  const losses = average(changes.filter((value) => value < 0).map((value) => Math.abs(value)));
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
};

export function decidePaper(market: PaperMarket, positionKrw = 0, dailyPnl = 0): PaperDecision {
  const price = Number(market.price);
  const prices = market.prices.filter(Number.isFinite);
  const bid = Number(market.bestBid ?? price);
  const ask = Number(market.bestAsk ?? price);
  const mid = (bid + ask) / 2;
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : 9999;
  const imbalance = Number.isFinite(market.bidSize) && Number.isFinite(market.askSize) && (Number(market.bidSize) + Number(market.askSize)) > 0
    ? (Number(market.bidSize) - Number(market.askSize)) / (Number(market.bidSize) + Number(market.askSize)) : 0;
  const vwap = average(prices);
  const smaFast = sma(prices, 5);
  const smaSlow = sma(prices, 20);
  const currentRsi = rsi(prices);
  const stale = (market.dataAgeMs ?? 0) > 3000;
  const unhealthy = market.websocketHealthy === false;
  const risk = stale || unhealthy || spreadBps > 50 || dailyPnl <= -20000 || positionKrw > 50000
    ? { allowed: false, code: stale ? "PAPER_DATA_STALE" : unhealthy ? "PAPER_STREAM_DOWN" : spreadBps > 50 ? "PAPER_SPREAD_BLOCKED" : dailyPnl <= -20000 ? "PAPER_DAILY_LOSS_BLOCKED" : "PAPER_POSITION_LIMIT_BLOCKED", message: "하드 리스크 규칙이 주문을 차단했습니다" }
    : { allowed: true, code: "PAPER_RISK_CLEAR", message: "모든 하드 리스크 규칙을 통과했습니다" };
  const fallback: FallbackRung = unhealthy ? "KILL" : stale ? "HOLD_LATE" : "RULES_ONLY";
  const judgments: SevenJudgments = {
    regime: smaFast !== null && smaSlow !== null ? (smaFast > smaSlow ? "상승 추세" : "하락 추세") : "판단 데이터 부족",
    direction: imbalance > 0.15 ? "매수 우세" : imbalance < -0.15 ? "매도 우세" : "방향 중립",
    toxicFlow: Math.abs(imbalance) > 0.7 ? "독성 흐름 주의" : "이상 흐름 낮음",
    liquidityStress: spreadBps > 30 ? "유동성 스트레스" : "유동성 양호",
    quoteEnvironment: spreadBps <= 10 ? "호가 양호" : "호가 간격 확대",
    inventoryPressure: positionKrw > 40000 ? "보유량 축소 필요" : "재고 압력 낮음",
    executionHealth: unhealthy || stale ? "실행 상태 불량" : "실행 상태 양호",
  };
  let action: PaperAction = "HOLD";
  let reason = "전략 조건이 충족되지 않아 관망합니다";
  if (!risk.allowed) { action = unhealthy ? "KILL" : "PULL_QUOTES"; reason = risk.message; }
  else if (smaFast !== null && smaSlow !== null && currentRsi !== null && smaFast > smaSlow && currentRsi < 70 && imbalance > 0.05) { action = "BUY"; reason = "짧은 평균선이 긴 평균선보다 높고 매수 흐름이 확인됐습니다"; }
  else if (smaFast !== null && smaSlow !== null && currentRsi !== null && smaFast < smaSlow && currentRsi > 30 && imbalance < -0.05) { action = "SELL"; reason = "짧은 평균선이 긴 평균선보다 낮고 매도 흐름이 확인됐습니다"; }
  return { action, fallback, provider: "RULES_ONLY", reason, state: { mid, spreadBps, imbalance, vwap, rsi: currentRsi, smaFast, smaSlow }, judgments, risk };
}
