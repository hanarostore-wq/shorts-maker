import test from 'node:test';
import assert from 'node:assert/strict';
import { PredictiveUniverseEngine, marketBreadth, windowFeatures } from '../../services/trading/core/predictive-universe.mjs';

function state(symbol, start, slope = 1) {
  const buckets = [], trades = [];
  for (let i = 0; i < 130; i += 1) {
    const at = start + i * 1000;
    const price = 10000 + i * slope;
    buckets.push({ at, open: price, close: price, high: price + 1, low: price - 1, volume: 5, funds: price * 5, buy: price * 4, count: 2 });
    trades.push({ trade_timestamp: at, trade_price: price, trade_volume: 5, ask_bid: 'BID', sequential_id: `${symbol}-${i}` });
  }
  return { symbol, name: symbol, buckets, trades, book: { timestamp: start + 129000, receivedAt: start + 129000, orderbook_units: [{ ask_price: 10130, bid_price: 10129, ask_size: 2, bid_size: 20 }] } };
}

test('breadth uses observed market returns rather than a fixed placeholder', () => {
  const rows = [{ market: 'KRW-A', features: { stale: false, returns: { '30s': 10 }, turnover: 100 } }, { market: 'KRW-B', features: { stale: false, returns: { '30s': -5 }, turnover: 50 } }];
  const result = marketBreadth(rows, 1000);
  assert.equal(result.observed, 2);
  assert.equal(result.upRatio, 0.5);
  assert.equal(result.totalTurnover, 150);
  assert.equal(result.riskOn, 'MIXED');
});

test('predictive engine calculates percentiles, states, and future labels without lookahead', () => {
  let now = 1800000000000;
  const engine = new PredictiveUniverseEngine({ clock: () => now });
  const states = new Map([['KRW-A', state('KRW-A', now - 129000, 2)], ['KRW-B', state('KRW-B', now - 129000, -1)]]);
  assert.ok(windowFeatures(states.get('KRW-A'), now));
  engine.update(states, now);
  const event = engine.events.find(x => x.kind === 'candidate');
  assert.ok(event);
  assert.ok(Number.isFinite(event.features.turnoverPercentile));
  assert.ok(Number.isFinite(event.features.futureOpportunity));
  const label = [...engine.labels.values()][0];
  assert.equal(label.labels[5].returnPct, null);
  now += 5000;
  engine.update(states, now);
  assert.notEqual(label.labels[5].returnPct, null);
  assert.ok(engine.datasets.length >= 1);
  assert.equal(engine.snapshot().shadows.every(x => x.status === 'OPEN' || x.status === 'CLOSED'), true);
});

test('future label never changes the feature snapshot used at candidate time', () => {
  let now = 1900000000000;
  const engine = new PredictiveUniverseEngine({ clock: () => now });
  const states = new Map([['KRW-A', state('KRW-A', now - 129000, 3)], ['KRW-B', state('KRW-B', now - 129000, 0.1)]]);
  engine.update(states, now);
  const label = [...engine.labels.values()][0];
  const original = JSON.stringify(label.features);
  now += 300000;
  engine.update(states, now);
  assert.equal(JSON.stringify(label.features), original);
});
