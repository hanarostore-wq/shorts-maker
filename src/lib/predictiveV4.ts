export type MarketRegime = "RISK_ON" | "TREND_UP" | "MIXED" | "RANGE" | "RISK_OFF" | "PANIC";
export type LiquidityClass = "ULTRA" | "HIGH" | "MEDIUM" | "LOW";
export type StrategyType = "PRE_BREAKOUT" | "PULLBACK_REACCEL" | "TREND_CONTINUATION";
export type CandidateState = "MONITOR" | "WATCHLIST" | "PRE_SETUP" | "SETUP" | "ENTRY_READY" | "POSITION" | "EXTENDED" | "REJECTED" | "COOLDOWN";

export type PredictiveSnapshot = {
  market: string;
  asOf: number;
  price: number;
  return5s?: number;
  return30s?: number;
  return2m?: number;
  return5m?: number;
  return15m?: number;
  turnoverAcceleration?: number;
  turnoverPercentile?: number;
  buyFlowPercentile?: number;
  buyFlowDelta?: number;
  orderFlowImbalance?: number;
  spreadPercentile?: number;
  spreadBps?: number;
  depthImbalance?: number;
  vwapDistancePct?: number;
  volatilityCompression?: number;
  relativeStrength?: number;
  btcReturn?: number;
  marketBreadth?: number;
  recentRisePct?: number;
  recent5sRisePct?: number;
  upperWickPct?: number;
  turnoverDeceleration?: number;
  pullbackDepthPct?: number;
  breakoutDistancePct?: number;
  liquidityPercentile?: number;
  state?: CandidateState;
  strategyType?: StrategyType;
};

export type CostEstimate = { feePct: number; spreadPct: number; slippagePct: number; riskMarginPct: number; expectedGrossMovePct: number; expectedNetEdgePct: number; allowed: boolean };
export type CandidateAssessment = PredictiveSnapshot & { scannerVersion: 4; strategyVersion: "predictive-v4"; regime: MarketRegime; liquidityClass: LiquidityClass; strategyType: StrategyType; state: CandidateState; opportunityScore: number; chaseRisk: number; cost: CostEstimate; gates: Record<string, boolean>; shadowEligible: boolean };

const n = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export function classifyRegime(input: Pick<PredictiveSnapshot, "btcReturn" | "marketBreadth" | "return5m" | "spreadPercentile" | "volatilityCompression">): MarketRegime {
  const btc = n(input.btcReturn), breadth = n(input.marketBreadth), trend = n(input.return5m), spread = n(input.spreadPercentile), compression = n(input.volatilityCompression);
  if (breadth < 15 || btc < -2 || spread > 92) return "PANIC";
  if (breadth < 35 || btc < -0.8) return "RISK_OFF";
  if (breadth > 65 && btc > 0.8 && trend > 0.4) return "TREND_UP";
  if (breadth > 72 && btc > 0.2) return "RISK_ON";
  if (compression > 70 && Math.abs(trend) < 0.5) return "RANGE";
  return "MIXED";
}

export function classifyLiquidity(input: Pick<PredictiveSnapshot, "liquidityPercentile" | "spreadPercentile" | "spreadBps">): LiquidityClass {
  const percentile = n(input.liquidityPercentile), spread = n(input.spreadPercentile), bps = n(input.spreadBps);
  if (percentile >= 85 && spread <= 35 && bps <= 8) return "ULTRA";
  if (percentile >= 60 && spread <= 65 && bps <= 20) return "HIGH";
  if (percentile >= 30 && spread <= 85 && bps <= 45) return "MEDIUM";
  return "LOW";
}

export function chooseStrategy(input: PredictiveSnapshot): StrategyType {
  const pullback = n(input.pullbackDepthPct), rise = n(input.recentRisePct), accel = n(input.buyFlowDelta);
  if (pullback > 0.15 && pullback < 3.5 && accel > 0) return "PULLBACK_REACCEL";
  if (n(input.volatilityCompression) > 55 && n(input.turnoverAcceleration) > 0 && rise < 3.5) return "PRE_BREAKOUT";
  return "TREND_CONTINUATION";
}

export function computeOpportunity(input: PredictiveSnapshot, strategy: StrategyType): number {
  const earlyFlow = average([n(input.turnoverPercentile), n(input.buyFlowPercentile), (n(input.orderFlowImbalance) + 1) * 50, (n(input.depthImbalance) + 1) * 50]);
  const structure = strategy === "PRE_BREAKOUT"
    ? average([n(input.volatilityCompression), n(input.relativeStrength), 100 - Math.abs(n(input.vwapDistancePct)) * 20])
    : strategy === "PULLBACK_REACCEL"
      ? average([n(input.relativeStrength), 100 - Math.abs(n(input.pullbackDepthPct) - 1.2) * 20, n(input.buyFlowPercentile)])
      : average([n(input.relativeStrength), n(input.return5m) * 10 + 50, n(input.buyFlowPercentile)]);
  return Math.round(clamp(earlyFlow * 0.62 + structure * 0.38));
}

export function computeChaseRisk(input: PredictiveSnapshot): number {
  const risk = average([
    clamp(Math.abs(n(input.recentRisePct)) * 14),
    clamp(Math.abs(n(input.vwapDistancePct)) * 20),
    clamp(Math.abs(n(input.recent5sRisePct)) * 30),
    clamp(n(input.upperWickPct) * 18),
    clamp(n(input.turnoverDeceleration) * 100),
    clamp((50 - n(input.buyFlowPercentile)) * 1.3),
    clamp(n(input.breakoutDistancePct) * 16),
  ]);
  return Math.round(clamp(risk));
}

export function nextCandidateState(input: { previous?: CandidateState; opportunityScore: number; chaseRisk: number; regime: MarketRegime; dataFresh: boolean; liquidityClass: LiquidityClass }): CandidateState {
  const { previous = "MONITOR", opportunityScore, chaseRisk, regime, dataFresh, liquidityClass } = input;
  if (!dataFresh || regime === "PANIC") return "REJECTED";
  if (liquidityClass === "LOW") return "WATCHLIST";
  if (chaseRisk >= 70) return "EXTENDED";
  if (opportunityScore >= 72 && chaseRisk <= 35) return previous === "SETUP" || previous === "ENTRY_READY" ? "ENTRY_READY" : "SETUP";
  if (opportunityScore >= 55) return previous === "MONITOR" ? "WATCHLIST" : "PRE_SETUP";
  return previous === "COOLDOWN" ? "COOLDOWN" : "MONITOR";
}

export function estimateCosts(input: PredictiveSnapshot, opportunityScore: number, liquidityClass: LiquidityClass): CostEstimate {
  const feePct = 0.1;
  const spreadPct = n(input.spreadBps) / 100;
  const slippagePct = liquidityClass === "ULTRA" ? 0.03 : liquidityClass === "HIGH" ? 0.07 : liquidityClass === "MEDIUM" ? 0.15 : 0.3;
  const riskMarginPct = 0.12;
  const expectedGrossMovePct = Math.max(0, (opportunityScore - 50) * 0.045);
  const expectedNetEdgePct = expectedGrossMovePct - feePct - spreadPct - slippagePct - riskMarginPct;
  return { feePct, spreadPct, slippagePct, riskMarginPct, expectedGrossMovePct, expectedNetEdgePct, allowed: expectedNetEdgePct > 0 };
}

export function assessCandidate(input: PredictiveSnapshot, options: { previousState?: CandidateState; hasPosition?: boolean; hasPendingOrder?: boolean; now?: number } = {}): CandidateAssessment {
  const now = options.now ?? Date.now();
  const regime = classifyRegime(input);
  const liquidityClass = classifyLiquidity(input);
  const strategyType = input.strategyType || chooseStrategy(input);
  const opportunityScore = computeOpportunity(input, strategyType);
  const chaseRisk = computeChaseRisk(input);
  const dataFresh = Number.isFinite(input.asOf) && Math.abs(now - input.asOf) <= 10000;
  const state = nextCandidateState({ previous: options.previousState, opportunityScore, chaseRisk, regime, dataFresh, liquidityClass });
  const cost = estimateCosts(input, opportunityScore, liquidityClass);
  const gates = {
    dataFresh,
    regimeAllowed: regime !== "RISK_OFF" && regime !== "PANIC",
    liquiditySufficient: liquidityClass !== "LOW",
    entryState: state === "ENTRY_READY",
    chaseRiskAllowed: chaseRisk < 60,
    expectedNetEdge: cost.allowed,
    noPosition: !options.hasPosition,
    noPendingOrder: !options.hasPendingOrder,
  };
  const shadowEligible = Object.values(gates).every(Boolean);
  return { ...input, scannerVersion: 4, strategyVersion: "predictive-v4", regime, liquidityClass, strategyType, state, opportunityScore, chaseRisk, cost, gates, shadowEligible };
}

export function createShadowTrade(assessment: CandidateAssessment) {
  if (!assessment.shadowEligible) return null;
  return {
    scannerVersion: 4,
    strategyVersion: "predictive-v4" as const,
    mode: "shadow" as const,
    market: assessment.market,
    shadowEntryPrice: assessment.price,
    shadowEntryAt: assessment.asOf,
    shadowReason: `${assessment.strategyType}; opportunity=${assessment.opportunityScore}; chaseRisk=${assessment.chaseRisk}`,
    regime: assessment.regime,
    liquidityClass: assessment.liquidityClass,
    expectedNetEdgePct: assessment.cost.expectedNetEdgePct,
  };
}

export function labelFuturePrices(entryPrice: number, futurePrices: Record<string, number>) {
  const horizons = [5, 15, 30, 60, 120, 300];
  const returns = Object.fromEntries(horizons.map((seconds) => [seconds, futurePrices[String(seconds)] == null ? null : Number(((n(futurePrices[String(seconds)]) / entryPrice - 1) * 100).toFixed(6))]));
  const values = horizons.map((seconds) => returns[seconds]).filter((value): value is number => typeof value === "number");
  const mfe = values.length ? Math.max(...values) : null;
  const mae = values.length ? Math.min(...values) : null;
  const firstThreshold = values.findIndex((value) => Math.abs(value) >= 0.3);
  return { returns, mfe, mae, firstThresholdSeconds: firstThreshold < 0 ? null : horizons[firstThreshold] };
}
