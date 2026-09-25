import { MarketActivity } from "./market-activity.mjs";
import { strategySignals } from "./strategy.mjs";
import { candlePath, fromRest, updateCandles } from "./candles.mjs";
import WebSocket from "./web-socket.mjs";
import { randomUUID } from "./web-crypto.mjs";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export class MarketFeed {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.symbol = "KRW-BTC";
    this.markets = [];
    this.tickers = {};
    this.activity = new MarketActivity();
    this.book = null;
    this.bookHistory = [];
    this.trades = [];
    this.candles = [];
    this.signalCandles = [];
    this.status = "연결 대기";
    this.lastMessage = 0;
    this.generation = 0;
    this.closed = false;
    this.restBlockedUntil = 0;
    this.units = 1;
    this.ws = null;
    this.restQueue = Promise.resolve();
    this.clockSamples = [];
    this.clockOffsetMs = 0;
    this.clockVerified = false;
  }
  rest(path) {
    const job = this.restQueue.then(async () => {
      if (Date.now() < this.restBlockedUntil)
        throw Error("업비트 요청 제한 대기");
      await pause(150);
      const started = Date.now();
      const r = await fetch("/api/coin/terminal/market?path=" + encodeURIComponent(path), {
        signal: AbortSignal.timeout(8000),
      });
      if ([429, 418].includes(r.status))
        this.restBlockedUntil = Date.now() + 60000;
      if (!r.ok) throw Error("업비트 시세 HTTP " + r.status);
      const serverTime = Date.parse(r.headers.get("date"));
      const finished = Date.now();
      if (Number.isFinite(serverTime) && finished - started < 2000) {
        this.clockSamples.push((started + finished) / 2 - serverTime);
        this.clockSamples = this.clockSamples.slice(-7);
        this.clockOffsetMs = [...this.clockSamples].sort((a, b) => a - b)[
          Math.floor(this.clockSamples.length / 2)
        ];
        this.clockVerified =
          this.clockSamples.length >= 2 &&
          Math.abs(this.clockOffsetMs) < 600000;
      }
      return r.json();
    });
    this.restQueue = job.catch(() => {});
    return job;
  }
  async init() {
    try {
      this.markets = (await this.rest("/v1/market/all?is_details=true")).filter(
        (x) => x.market.startsWith("KRW-"),
      );
      const rows = await this.rest("/v1/ticker/all?quote_currencies=KRW");
      for (const x of rows) { this.tickers[x.market] = x; this.activity.observe(x); }
      await this.select(this.symbol);
      this.refreshTimer = setInterval(() => this.refreshTickers(), 30000);
    } catch (e) {
      this.status = e.message;
      this.onChange();
      this.retry = setTimeout(() => this.init(), 10000);
    }
  }
  async refreshTickers() {
    try {
      for (const x of await this.rest("/v1/ticker/all?quote_currencies=KRW"))
        if (
          !this.tickers[x.market] ||
          x.timestamp >= this.tickers[x.market].timestamp
        )
          { this.tickers[x.market] = x; this.activity.observe(x); }
      this.onChange();
    } catch (e) {
      this.status = e.message;
    }
  }
  async select(symbol) {
    if (!this.markets.some((m) => m.market === symbol))
      throw Error("지원하지 않는 원화 마켓");
    this.symbol = symbol;
    this.generation++;
    const gen = this.generation;
    this.book = null;
    this.bookHistory = [];
    this.trades = [];
    this.candles = [];
    this.signalCandles = [];
    this.ws?.terminate();
    clearTimeout(this.retry);
    this.status = "시세 연결 중";
    this.onChange();
    this.connect(gen);
    await Promise.all([this.loadCandles(this.units), this.loadSignalCandles()]);
    try {
      const ticks = await this.rest(
        "/v1/trades/ticks?market=" + symbol + "&count=200",
      );
      if (gen === this.generation) {
        const combined = [
          ...this.trades,
          ...ticks.map((t) => ({
            ...t,
            code: symbol,
            sourceTradeTimestamp: t.timestamp,
            trade_timestamp: t.timestamp + this.clockOffsetMs,
          })),
        ];
        this.trades = [
          ...new Map(
            combined.map((t) => [String(t.sequential_id), t]),
          ).values(),
        ]
          .sort((a, b) => a.trade_timestamp - b.trade_timestamp)
          .slice(-3000);
      }
    } catch (e) {
      this.status = e.message;
    }
    this.onChange();
  }
  async loadCandles(units) {
    const route = candlePath(units),
      symbol = this.symbol;
    const request = (this.candleRequest || 0) + 1;
    this.candleRequest = request;
    const data = await this.rest(route + "?market=" + symbol + "&count=200");
    if (this.symbol === symbol && this.candleRequest === request) {
      this.units = units;
      this.candles = fromRest(data, this.trades, units);
      this.onChange();
    }
  }
  async loadSignalCandles() {
    const symbol = this.symbol;
    const data = await this.rest(
      candlePath(1) + "?market=" + symbol + "&count=200",
    );
    if (this.symbol === symbol) {
      this.signalCandles = fromRest(data, this.trades, 1);
      this.onChange();
    }
  }
  connect(gen) {
    if (this.closed || gen !== this.generation) return;
    const ws = (this.ws = new WebSocket("wss://api.upbit.com/websocket/v1"));
    let alive = Date.now();
    ws.on("open", () => {
      ws.send(
        JSON.stringify([
          { ticket: randomUUID() },
          { type: "ticker", codes: this.markets.map((x) => x.market) },
          { type: "trade", codes: [this.symbol] },
          { type: "orderbook", codes: [this.symbol] },
        ]),
      );
      this.status = "실시간 연결";
      this.onChange();
    });
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.error) throw Error(m.error.name);
        if (gen !== this.generation) return;
        alive = Date.now();
        if (m.type === "ticker") {
          this.activity.observe(m);
          this.tickers[m.code] = { ...m, market: m.code };
          this.onChange();
          if (m.code !== this.symbol) return;
        }
        if (m.code !== this.symbol) return;
        this.lastMessage = alive;
        this.status = "실시간 연결";
        if (m.type === "ticker")
          this.tickers[m.code] = { ...m, market: m.code };
        if (m.type === "orderbook") {
          m.sourceTimestamp = m.timestamp;
          m.timestamp += this.clockOffsetMs;
          m.receivedAt = Date.now();
          if (!this.book || m.timestamp >= this.book.timestamp) {
            this.book = m;
            const rows = m.orderbook_units.slice(0, 10);
            this.bookHistory.push({at:m.timestamp,
              bidDepth:rows.reduce((s,x)=>s+x.bid_price*x.bid_size,0),
              askDepth:rows.reduce((s,x)=>s+x.ask_price*x.ask_size,0)});
            this.bookHistory = this.bookHistory.filter(x=>x.at>=Date.now()-15000).slice(-300);
          }
        }
        if (m.type === "trade") {
          m.sourceTradeTimestamp = m.trade_timestamp;
          m.trade_timestamp += this.clockOffsetMs;
          const isNewTrade = !this.trades.some(
            (t) => t.sequential_id === m.sequential_id,
          );
          if (isNewTrade) {
            this.trades.push(m);
            this.trades.sort((a, b) => a.trade_timestamp - b.trade_timestamp);
            this.trades = this.trades
              .filter((t) => t.trade_timestamp > Date.now() - 300000)
              .slice(-3000);
          }
          if (isNewTrade) {
            updateCandles(this.candles, m, this.units);
            updateCandles(this.signalCandles, m, 1);
          }
        }
        if (m.type === "orderbook" || m.type === "trade") this.onRiskChange?.();
        this.onChange();
      } catch {
        this.status = "시세 메시지 오류";
      }
    });
    ws.on("error", () => {
      this.status = "시세 연결 실패 / 재연결 대기";
      this.onChange();
    });
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        if (Date.now() - alive > 15000) ws.terminate();
      }
    }, 5000);
    ws.on("close", () => {
      clearInterval(heartbeat);
      if (gen === this.generation && !this.closed) {
        this.status = "시세 연결 끊김 / 주문 중단";
        this.onChange();
        this.retry = setTimeout(() => this.connect(gen), 3000);
      }
    });
  }
  stop() {
    this.closed = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.retry);
    this.ws?.close();
  }
  snapshot() {
    return {
      symbol: this.symbol,
      units: this.units,
      status: this.status,
      lastMessage: this.lastMessage,
      clockOffsetMs: this.clockOffsetMs,
      clockVerified: this.clockVerified,
      book: this.book,
      trades: this.trades.slice(-40).reverse(),
      candles: this.candles,
      markets: this.markets.map((m) => ({
        ...m,
        ticker: this.tickers[m.market] || null,
        activity: this.activity.snapshot(m.market),
      })),
      ticker: this.tickers[this.symbol] || null,
    };
  }
}
export function features(feed, now = Date.now()) {
  const b = feed.book?.orderbook_units;
  if (!b?.length) return null;
  const best = b[0],
    mid = (best.ask_price + best.bid_price) / 2;
  const recent = feed.trades.filter(
    (t) => now - t.trade_timestamp <= 60000 && t.trade_timestamp <= now + 1000,
  );
  const fastWindow = (seconds) => {
    const trades = recent.filter(
      (t) => now - t.trade_timestamp <= seconds * 1000,
    );
    const volume = trades.reduce((sum, t) => sum + t.trade_volume, 0);
    return {
      seconds,
      count: trades.length,
      buyVolumeShare: volume
        ? trades
            .filter((t) => t.ask_bid === "BID")
            .reduce((sum, t) => sum + t.trade_volume, 0) / volume
        : null,
      returnBps:
        trades.length > 1
          ? (trades.at(-1).trade_price / trades[0].trade_price - 1) * 10000
          : null,
    };
  };
  const total = recent.reduce((s, t) => s + t.trade_volume, 0);
  const buy = recent
    .filter((t) => t.ask_bid === "BID")
    .reduce((s, t) => s + t.trade_volume, 0);
  const bidDepth = b
      .slice(0, 10)
      .reduce((s, x) => s + x.bid_price * x.bid_size, 0),
    askDepth = b.slice(0, 10).reduce((s, x) => s + x.ask_price * x.ask_size, 0);
  const closes = (feed.signalCandles || feed.candles).map((x) => x.close);
  const ema = (n) =>
    closes.reduce(
      (v, x, i) => (i === 0 ? x : (x * 2) / (n + 1) + v * (1 - 2 / (n + 1))),
      0,
    );
  let gains = 0,
    losses = 0;
  for (let i = Math.max(1, closes.length - 14); i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains += Math.max(0, d);
    losses += Math.max(0, -d);
  }
  const rets = recent
    .slice(1)
    .map((t, i) => Math.log(t.trade_price / recent[i].trade_price));
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const result = {
    market: feed.symbol,
    asOf: now,
    bookTimestamp: feed.book.timestamp,
    bookAgeMs: Math.max(0, now - feed.book.timestamp),
    quoteClockUncertaintyMs: 1000,
    receivedAgeMs: Math.max(0, now - (feed.book.receivedAt || now)),
    fastFlow: [fastWindow(1), fastWindow(5)],
    bid: best.bid_price,
    ask: best.ask_price,
    mid,
    spreadBps: ((best.ask_price - best.bid_price) / mid) * 10000,
    microprice:
      (best.ask_price * best.bid_size + best.bid_price * best.ask_size) /
      (best.bid_size + best.ask_size),
    bidDepthKrw: bidDepth,
    askDepthKrw: askDepth,
    imbalance: (bidDepth - askDepth) / (bidDepth + askDepth),
    buyVolumeShare: total ? buy / total : null,
    vwap60s: total
      ? recent.reduce((s, t) => s + t.trade_price * t.trade_volume, 0) / total
      : null,
    return60sBps:
      recent.length > 1
        ? (recent.at(-1).trade_price / recent[0].trade_price - 1) * 10000
        : null,
    realizedVolBps: rets.length
      ? Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length) *
        10000
      : null,
    tradeCount60s: recent.length,
    tradeWindowSeconds: recent.length
      ? (now - recent[0].trade_timestamp) / 1000
      : 0,
    rsi14:
      closes.length < 15
        ? null
        : gains + losses === 0
          ? 50
          : (100 * gains) / (gains + losses),
    ema9: closes.length >= 9 ? ema(9) : null,
    ema21: closes.length >= 21 ? ema(21) : null,
    candleMinutes: 1,
    warm:
      feed.clockVerified &&
      closes.length >= 21 &&
      recent.length >= 10 &&
      now - feed.book.timestamp <= 3000 && feed.book.timestamp <= now + 2000,
  };
  result.strategy = strategySignals(feed, result, now);
  return result;
}
