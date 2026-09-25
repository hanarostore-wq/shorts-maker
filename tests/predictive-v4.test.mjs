import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidate, classifyLiquidity, classifyRegime, createShadowTrade, labelFuturePrices } from '../src/lib/predictiveV4.ts';

const base = (overrides = {}) => ({ market: 'KRW-BTC', asOf: Date.now(), price: 100, btcReturn: 0.4, marketBreadth: 62, return5m: 0.2, spreadPercentile: 20, spreadBps: 4, volatilityCompression: 72, liquidityPercentile: 90, turnoverAcceleration: 0.6, turnoverPercentile: 78, buyFlowPercentile: 75, buyFlowDelta: 0.3, orderFlowImbalance: 0.35, depthImbalance: 0.3, relativeStrength: 70, ...overrides });

test('classifies market regime without using candidate future data', () => {
  assert.equal(classifyRegime({ btcReturn: 1, marketBreadth: 80, return5m: 1, spreadPercentile: 20, volatilityCompression: 20 }), 'TREND_UP');
  assert.equal(classifyRegime({ btcReturn: -3, marketBreadth: 10, return5m: -2, spreadPercentile: 95, volatilityCompression: 20 }), 'PANIC');
});

test('classifies liquidity by relative percentiles', () => {
  assert.equal(classifyLiquidity({ liquidityPercentile: 90, spreadPercentile: 20, spreadBps: 3 }), 'ULTRA');
  assert.equal(classifyLiquidity({ liquidityPercentile: 10, spreadPercentile: 90, spreadBps: 60 }), 'LOW');
});

test('blocks an extended chase even when opportunity is high', () => {
  const result = assessCandidate(base({ recentRisePct: 7, recent5sRisePct: 2.5, vwapDistancePct: 4, upperWickPct: 3, breakoutDistancePct: 4, buyFlowPercentile: 20, turnoverDeceleration: 0.8 }), { now: Date.now() });
  assert.ok(result.opportunityScore > 0);
  assert.ok(result.chaseRisk >= 60);
  assert.equal(result.shadowEligible, false);
  assert.ok(['EXTENDED', 'REJECTED'].includes(result.state));
});

test('creates shadow trade only after all deterministic gates pass', () => {
  const result = assessCandidate(base({ marketBreadth: 80, btcReturn: 1, return5m: 1, recentRisePct: 0.3, recent5sRisePct: 0.02, pullbackDepthPct: 1, buyFlowDelta: 0.5 }), { previousState: 'SETUP', now: Date.now() });
  assert.equal(result.strategyVersion, 'predictive-v4');
  assert.equal(result.state, 'ENTRY_READY');
  assert.ok(result.shadowEligible);
  assert.equal(createShadowTrade(result)?.mode, 'shadow');
});

test('future labels are generated after entry and do not alter assessment', () => {
  const result = assessCandidate(base(), { now: Date.now() });
  const before = result.opportunityScore;
  const labels = labelFuturePrices(100, { '5': 101, '15': 99, '60': 102 });
  assert.equal(result.opportunityScore, before);
  assert.equal(labels.mfe, 2);
  assert.equal(labels.mae, -1);
  assert.equal(labels.firstThresholdSeconds, 5);
});
