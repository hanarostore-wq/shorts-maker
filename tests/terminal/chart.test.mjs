import test from "node:test";
import assert from "node:assert/strict";
import { ema, sma, bands, rsi, macd } from "../../public/trading/indicators.js";
import {
  candleStart,
  candlePath,
  fromRest,
  updateCandles,
} from "../../public/trading/core/candles.mjs";
import { features } from "../../public/trading/core/market.mjs";
test("averages and bands stay flat for a constant price, with warmup gaps", () => {
  const v = Array(80).fill(10);
  assert.equal(ema(v, 9)[7], null);
  assert.equal(ema(v, 9)[8], 10);
  assert.equal(sma(v, 20)[19], 10);
  assert.deepEqual(bands(v)[19], { middle: 10, upper: 10, lower: 10 });
  assert.equal(rsi(v).at(-1), 50);
  assert.deepEqual(macd(v).at(-1), { value: 0, signal: 0, histogram: 0 });
});
test("RSI distinguishes strictly rising and falling prices", () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1)).at(-1), 100);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 30 - i)).at(-1), 0);
});
test("second/day/month/year candles use exact UTC exchange boundaries", () => {
  const ms = Date.parse("2026-09-24T08:41:15.678Z");
  assert.equal(candleStart(ms, 1 / 60), Date.parse("2026-09-24T08:41:15Z"));
  assert.equal(candleStart(ms, 1440), Date.parse("2026-09-24T00:00:00Z"));
  assert.equal(candleStart(ms, 43200), Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(candleStart(ms, 525600), Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(candlePath(1 / 60), "/v1/candles/seconds");
  assert.throws(() => candlePath(2));
});
test("REST seed volume is not counted again when a covered WebSocket trade is replayed", () => {
  const ms = Date.parse("2026-09-24T08:41:10Z"),
    list = fromRest(
      [
        {
          candle_date_time_utc: "2026-09-24T08:41:00",
          opening_price: 10,
          high_price: 11,
          low_price: 9,
          trade_price: 10,
          candle_acc_trade_volume: 30,
          timestamp: ms,
        },
      ],
      [],
      1,
    );
  updateCandles(
    list,
    { sourceTradeTimestamp: ms, trade_price: 10, trade_volume: 8 },
    1,
  );
  assert.equal(list[0].volume, 30);
  updateCandles(
    list,
    { sourceTradeTimestamp: ms + 1, trade_price: 12, trade_volume: 2 },
    1,
  );
  assert.equal(list[0].volume, 32);
  assert.equal(list[0].high, 12);
});
test("display timeframe never changes the one-minute data used for trading judgments", () => {
  const feed = {
    symbol: "KRW-BTC",
    units: 525600,
    clockVerified: true,
    book: {
      timestamp: Date.now(),
      receivedAt: Date.now(),
      orderbook_units: [
        { ask_price: 10, bid_price: 9.99, ask_size: 10, bid_size: 10 },
      ],
    },
    candles: [{ close: 999999 }],
    signalCandles: Array(30).fill({ close: 10 }),
    trades: Array.from({ length: 12 }, () => ({
      trade_timestamp: Date.now(),
      trade_price: 10,
      trade_volume: 1,
      ask_bid: "BID",
    })),
  };
  const f = features(feed);
  assert.equal(f.ema9, 10);
  assert.equal(f.candleMinutes, 1);
  assert.equal(f.warm, true);
  assert.equal(f.fastFlow[0].count, 12);
});
