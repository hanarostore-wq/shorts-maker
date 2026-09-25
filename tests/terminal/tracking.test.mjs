import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../public/trading/core/engine.mjs";
import { newLedger, D, decide } from "../../public/trading/core/core.mjs";
import { manualBuyingPower } from "../../public/trading/core/tracking.mjs";
import { percentValue } from "../../public/trading/order-math.js";
import { questions } from "../../src/lib/terminal/jev.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await sleep(5);
  }
  throw Error("test timeout");
}
function setup(t, mode = "paper", saved = null) {
  let persisted = saved;
  const store = {
    load: () => persisted,
    save: (s) => {
      persisted = structuredClone(s);
    },
    log: () => {},
  };
  const feed = {
    symbol: "KRW-BTC",
    units: 1,
    clockVerified: true,
    book: {
      timestamp: Date.now(),
      receivedAt: Date.now(),
      orderbook_units: [
        { ask_price: 10000, bid_price: 9999, ask_size: 100, bid_size: 100 },
      ],
    },
    candles: Array.from({ length: 25 }, () => ({ close: 10000 })),
    trades: Array.from({ length: 15 }, (_, i) => ({
      trade_timestamp: Date.now() - i * 200,
      trade_price: 10000,
      trade_volume: 1,
      ask_bid: "BID",
    })),
  };
  const e = new Engine(feed, store);
  clearInterval(e.timer);
  // These are legacy execution/scheduling regressions. New strategy has dedicated replay tests.
  e.config.strategyEnabled = 0;
  e.mode = mode;
  if (!saved) e[mode] = newLedger(100000, "KRW-BTC", mode);
  e.armed = mode === "live";
  e.broker.verified = mode === "live";
  e.chance = {
    bid_fee: ".0005",
    ask_fee: ".0005",
    bid_account: { balance: "100000" },
    ask_account: { balance: "10" },
    market: {
      state: "active",
      bid: { min_total: "5000" },
      ask: { min_total: "5000" },
    },
  };
  e.broker.chance = async () => e.chance;
  t.after(async () => {
    e.stop();
    await until(() => !e.tracker.busy);
  });
  return {
    e,
    feed,
    store,
    get saved() {
      return persisted;
    },
  };
}
const answer = () => ({
  id: "test-decision",
  at: Date.now(),
  stateAsOf: Date.now(),
  model: "test-only",
  market: "KRW-BTC",
  latencyMs: 1,
  usage: { input_tokens: 1 },
  answers: {
    regime: { choice: "trending" },
    direction: {
      probabilities: { up: 0.9, neutral: 0.09, down: 0.01 },
      confidence: 0.9,
    },
    toxic_flow: { noul: 0.1 },
    liquidity_stressed: { noul: 0.1 },
    execution_health: { score: 3 },
    inventory_pressure: { score: 0 },
  },
});
function terminal(params, funds, state = "cancel") {
  const price = 10000,
    quantity = String(funds / price);
  return {
    state,
    executed_volume: quantity,
    paid_fee: String(funds * 0.0005),
    trades: funds
      ? [{ price: String(price), volume: quantity, funds: String(funds) }]
      : [],
  };
}
test("percentage buttons are distinct and use fee/position adjusted buying power", (t) => {
  const { e, feed } = setup(t);
  const base = manualBuyingPower(e.paper, e.config, feed.book);
  assert.equal(base, 50000);
  assert.deepEqual(
    [10, 25, 50, 100].map((p) => percentValue(base, p)),
    [5000, 12500, 25000, 50000],
  );
  e.paper.cash = "10000";
  assert.equal(manualBuyingPower(e.paper, e.config, feed.book), 9995);
  e.paper.quantity = "4";
  e.paper.cash = "100000";
  assert.equal(manualBuyingPower(e.paper, e.config, feed.book), 10004);
});
test("live IOC partial cancel reprices only remaining budget immediately and retains side", async (t) => {
  const { e } = setup(t, "live");
  const sent = [];
  e.broker.send = async (p, guard) => {
    guard();
    sent.push(structuredClone(p));
    return { uuid: p.identifier };
  };
  e.broker.find = async () =>
    terminal(sent.at(-1), sent.length === 1 ? 4000 : 6000);
  e.tracker.start("buy", 10000);
  await until(() => !e.tracker.busy);
  assert.equal(sent.length, 2);
  assert.deepEqual(
    sent.map((p) => p.price),
    ["10000", "6000"],
  );
  assert.ok(
    sent.every(
      (p) =>
        p.side === "bid" && p.ord_type === "best" && p.time_in_force === "ioc",
    ),
  );
  assert.notEqual(sent[0].identifier, sent[1].identifier);
  assert.equal(e.tracker.state.funds, "10000");
  assert.equal(e.live.history.length, 2);
  assert.equal(e.live.pending, null);
});
test("zero fill confirmed cancellation keeps the entire amount for the next attempt", async (t) => {
  const { e } = setup(t, "live");
  let n = 0;
  e.broker.send = async (p, g) => {
    g();
    n++;
    return { uuid: p.identifier };
  };
  e.broker.find = async () => terminal(null, n === 1 ? 0 : 10000);
  e.tracker.start("buy", 10000);
  await until(() => !e.tracker.busy);
  assert.equal(n, 2);
  assert.equal(e.live.quantity, "1");
});
test("sell target is frozen at click and partial fills never recompute percentage", async (t) => {
  const { e } = setup(t, "live");
  e.live.quantity = "4";
  e.live.cost = "40000";
  const sent = [];
  e.broker.send = async (p, g) => {
    g();
    sent.push(structuredClone(p));
    return { uuid: p.identifier };
  };
  e.broker.find = async () => terminal(null, sent.length === 1 ? 2500 : 7500);
  e.tracker.start("sell", 0, "25");
  await until(() => !e.tracker.busy);
  assert.deepEqual(
    sent.map((p) => p.volume),
    ["1", ".75"].map((x) => D(x).toString()),
  );
  assert.ok(sent.every((p) => p.side === "ask" && !("price" in p)));
  assert.equal(e.live.quantity, "3");
});
test("unknown send result is persisted and never blindly resent", async (t) => {
  const { e } = setup(t, "live");
  let n = 0;
  e.broker.send = async () => {
    n++;
    throw Error("network timeout");
  };
  e.tracker.start("buy", 10000);
  await until(() => !e.tracker.busy);
  assert.equal(n, 1);
  assert.equal(e.live.pending.status, "unknown");
  assert.equal(e.tracker.state.active, false);
  assert.throws(() => e.tracker.start("buy", 10000));
});
test("stop during preflight fences the queued submission", async (t) => {
  const { e } = setup(t, "live");
  let release;
  e.broker.chance = () => new Promise((r) => (release = r));
  let sends = 0;
  e.broker.send = async () => sends++;
  e.tracker.start("buy", 10000);
  e.stop();
  release(e.chance);
  await until(() => !e.tracker.busy);
  assert.equal(sends, 0);
  assert.equal(e.live.pending, null);
});
test("nonterminal partial order cannot launch replacement until cancellation confirmed", async (t) => {
  const { e } = setup(t, "live");
  let sends = 0,
    queries = 0,
    cancels = 0;
  e.broker.send = async (p, g) => {
    g();
    sends++;
    return { uuid: p.identifier };
  };
  e.broker.find = async () => {
    queries++;
    if (queries === 1) {
      e.live.pending.at = Date.now() - 2000;
      return { state: "wait" };
    }
    return terminal(null, 10000);
  };
  e.broker.cancel = async () => {
    cancels++;
    assert.equal(sends, 1);
  };
  e.tracker.start("buy", 10000);
  await until(() => !e.tracker.busy);
  assert.equal(sends, 1);
  assert.equal(cancels, 1);
  assert.equal(e.live.quantity, "1");
});
test("paper tracking uses real book but never live broker; same book depth is not reused", async (t) => {
  const { e, feed } = setup(t);
  feed.book.orderbook_units[0].ask_size = 2;
  e.broker.send = () => {
    throw Error("NO LIVE CALL");
  };
  e.tracker.start("buy", 10000);
  await until(() => e.paper.history.length === 1);
  await sleep(180);
  assert.equal(e.paper.history.length, 1);
  assert.equal(e.paper.history[0].funds, "2000");
  e.stop();
  await until(() => !e.tracker.busy);
});
test("tracking finishes with explicit sub-minimum residual instead of overstating full fill", async (t) => {
  const { e } = setup(t, "live");
  e.broker.send = async (p, g) => {
    g();
    return { uuid: p.identifier };
  };
  e.broker.find = async () => terminal(null, 8000);
  e.tracker.start("buy", 10000);
  await until(() => !e.tracker.busy);
  assert.equal(e.tracker.snapshot().remaining, "2000");
  assert.match(e.tracker.state.phase, /최소/);
});
test("restart never resumes tracking but keeps unresolved identifier for reconciliation", async (t) => {
  const s = setup(t, "live");
  s.e.broker.send = async () => {
    throw Error("timeout");
  };
  s.e.tracker.start("buy", 10000);
  await until(() => !s.e.tracker.busy);
  const r = setup(t, "paper", s.saved);
  assert.equal(r.e.tracker.state.active, false);
  assert.equal(r.e.live.pending.identifier, s.e.live.pending.identifier);
});
test("start automatically verifies saved Jev key and enables both judgment and trading", async (t) => {
  const { e } = setup(t);
  e.jevKey = "test-only";
  let count = 0;
  e.askJev = async () => {
    count++;
    return answer();
  };
  await e.startConnected();
  assert.equal(count, 1);
  assert.equal(e.jevVerified, true);
  assert.equal(e.running, true);
  assert.equal(e.judgmentRunning, true);
  e.stop();
  assert.equal(e.judgmentRunning, false);
});
test("judgment-only ON produces decisions but never executes even a buy signal", async (t) => {
  const { e } = setup(t);
  e.jevKey = "test-only";
  e.askJev = async () => answer();
  let orders = 0;
  e.order = async () => orders++;
  await e.setJudgment(true);
  await e.tick();
  assert.equal(e.judgmentRunning, true);
  assert.equal(e.running, false);
  assert.equal(e.action.side, "buy");
  assert.equal(orders, 0);
  await e.setJudgment(false);
  assert.equal(e.judgmentRunning, false);
});
test("OFF during saved-key verification cannot start judgment or trading afterward", async (t) => {
  const { e } = setup(t);
  e.jevKey = "test-only";
  let release;
  e.askJev = () => new Promise((r) => (release = r));
  const task = e.startConnected();
  await e.setJudgment(false);
  release(answer());
  await assert.rejects(task, /OFF|정지/);
  assert.equal(e.running, false);
  assert.equal(e.judgmentRunning, false);
});
test("failed authentication cannot mark the key verified or activate trading", async (t) => {
  const { e } = setup(t);
  e.jevKey = "test-only";
  e.askJev = async () => {
    throw Error("TypeSafe HTTP 401");
  };
  await assert.rejects(e.startConnected(), /401/);
  assert.equal(e.jevVerified, false);
  assert.equal(e.running, false);
});
test("60 second default refresh preserves separately configurable direction horizon", (t) => {
  const { e } = setup(t);
  assert.equal(e.config.intervalSeconds, 60);
  assert.equal(e.config.horizonSeconds, 60);
  assert.match(
    questions("", 5).direction.instructions.question,
    /next 5 seconds/,
  );
  assert.match(
    questions("", 1).direction.instructions.question,
    /next 1 seconds/,
  );
});

test("sell KRW amount freezes target quantity, and rejects a sum above holdings", async (t) => {
  const { e, feed } = setup(t, "live");
  e.live.quantity = "4";
  e.live.cost = "40000";
  feed.book.orderbook_units[0].bid_price = 10000;
  feed.book.orderbook_units[0].ask_price = 10001;
  assert.throws(() => e.tracker.start("sell", 0, "100", 50000), /수량/);
  let sent;
  e.broker.send = async (p, g) => {
    g();
    sent = structuredClone(p);
    return { uuid: p.identifier };
  };
  e.broker.find = async () => terminal(null, 10000);
  e.tracker.start("sell", 0, "100", 10000);
  await until(() => !e.tracker.busy);
  assert.equal(sent.volume, "1");
  assert.equal(e.live.quantity, "3");
});
test("unlimited judgment mode never trips the local daily request counter", (t) => {
  const { e } = setup(t);
  e.calls = {
    day: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    count: 100001,
    inputTokens: 0,
  };
  assert.equal(e.config.maxCallsPerDay, 0);
  e.reserveCall();
  assert.equal(e.calls.count, 100002);
});

test('automatic buy and sell decisions reach paper fills while judgment-only cannot', async (t) => {
  const { e, feed } = setup(t);
  e.jevKey = 'test-only';
  e.askJev = async () => answer();
  await e.startConnected();
  await e.analyze();
  assert.equal(e.paper.history.length, 1);
  assert.equal(e.paper.history[0].side, 'buy');
  assert.ok(D(e.paper.quantity).gt(0));
  e.paper.lastOrderAt = 0;
  feed.book.timestamp = Date.now(); feed.book.receivedAt = Date.now();
  e.askJev = async () => {
    const a = answer();
    a.answers.direction.probabilities = {up: 0.01, neutral: 0.09, down: 0.9};
    return a;
  };
  await e.analyze();
  assert.equal(e.paper.history.length, 2);
  assert.equal(e.paper.history[1].side, 'sell');
  assert.equal(e.paper.quantity, '0');
});

test('81 percent rise with 1.68 model health permits a first paper buy', async (t) => {
 const {e} = setup(t);
 e.jevKey='test-only';
 e.askJev=async()=>{const a=answer();a.answers.direction.probabilities={up:.81,neutral:.14,down:.05};a.answers.direction.confidence=.73;a.answers.execution_health.score=1.68;return a;};
 await e.startConnected(); await e.analyze();
 assert.equal(e.paper.history.length,1); assert.equal(e.paper.history[0].side,'buy');
});
test('advisory model health does not bypass real pending order or cash checks', async(t)=>{
 const {e}=setup(t);e.jevKey='test-only';e.askJev=async()=>{const a=answer();a.answers.execution_health.score=1.68;return a;};
 await e.startConnected();e.paper.cash='1';e.paper.highWater='1';e.paper.dayStart='1';await e.analyze();
 assert.equal(e.paper.history.length,0);assert.match(e.action.reason,/잔액/);
 e.paper.cash='100000';e.paper.pending={identifier:'test-existing'};await e.analyze();
 assert.equal(e.paper.history.length,0);assert.ok(e.paper.pending);
});

test('wide spread block shows actual spread and maximum rather than only passed probability',t=>{
const {e}=setup(t);const a=answer();a.answers.execution_health.score=1.64;
const d=decide(a.answers,{bid:10000,spreadBps:30},e.paper,e.config);
assert.equal(d.side,'hold');assert.match(d.reason,/0.300% \/ 최대 0.150%/);
});

test('start queues while trades warm up and starts once without another click',async t=>{
 const {e,feed}=setup(t);e.jevKey='test-only';e.askJev=async()=>answer();const trades=feed.trades;feed.trades=[];
 await e.startConnected();assert.equal(e.startRequested,true);assert.equal(e.running,false);assert.match(e.action.reason,/0\/10/);
 feed.trades=trades;await e.tick();assert.equal(e.startRequested,false);assert.equal(e.running,true);
});
test('OFF cancels a queued start even after data becomes ready',async t=>{
 const {e,feed}=setup(t);e.jevKey='test-only';let calls=0;e.askJev=async()=>{calls++;return answer();};const trades=feed.trades;feed.trades=[];
 await e.startConnected();await e.setJudgment(false);feed.trades=trades;await e.tick();assert.equal(e.running,false);assert.equal(calls,0);
});

test('data going stale during key verification keeps start queued until fresh again', async t=>{
 const {e,feed}=setup(t);e.jevKey='test-only';const trades=feed.trades;e.askJev=async()=>{feed.trades=[];return answer();};
 await e.startConnected();assert.equal(e.running,false);assert.equal(e.startRequested,true);
 feed.trades=trades;e.askJev=async()=>answer();await e.tick();assert.equal(e.running,true);assert.equal(e.startRequested,false);
});

for(const action of ['stop','off']) test('queued key verification cannot reactivate after '+action,async t=>{
 const {e,feed}=setup(t);e.jevKey='test-only';const trades=feed.trades;feed.trades=[];let release;
 e.askJev=()=>new Promise(r=>release=r);await e.startConnected();feed.trades=trades;const ticking=e.tick();
 assert.equal(typeof release,'function');if(action==='stop')e.stop();else await e.setJudgment(false);
 release(answer());await ticking;assert.equal(e.running,false);assert.equal(e.judgmentRunning,false);assert.equal(e.startRequested,false);assert.equal(e.paper.history.length,0);
});
test('unresolved order arriving while start is queued prevents activation',async t=>{
 const {e,feed}=setup(t);e.jevKey='test-only';const trades=feed.trades;feed.trades=[];let calls=0;e.askJev=async()=>{calls++;return answer();};
 await e.startConnected();feed.trades=trades;e.paper.pending={identifier:'existing-unresolved'};await e.tick();
 assert.equal(e.running,false);assert.equal(calls,0);assert.equal(e.paper.pending.identifier,'existing-unresolved');assert.equal(e.paper.history.length,0);
});

function immediateSetup(t) {
 const s=setup(t);s.e.jevVerified=true;s.e.jevKey='test-only';s.e.config.intervalSeconds=60;
 s.e.askJev=async()=>{const a=answer();a.answers.direction.probabilities={up:.1,neutral:.8,down:.1};return a;};return s;
}
test('restart resets previous 60 second wait and failure backoff; subsequent ticks retain interval',async t=>{
 const {e}=immediateSetup(t);e.lastAnalysis=Date.now();e.coolUntil=Date.now()+15000;e.stop();await e.startConnected();
 assert.match(e.action.reason,/첫 판단/);await e.tick();assert.equal(e.calls.count,1);assert.ok(e.decision);await e.tick();assert.equal(e.calls.count,1);assert.equal(e.config.intervalSeconds,60);
});
test('changing market during judgment only runs first fresh judgment immediately without orders',async t=>{
 const {e,feed}=immediateSetup(t);e.judgmentRunning=true;e.lastAnalysis=Date.now();e.coolUntil=Date.now()+15000;feed.select=async symbol=>{feed.symbol=symbol;};
 await e.select('KRW-ETH');assert.equal(e.decision,null);await e.tick();assert.equal(e.calls.count,1);assert.equal(e.running,false);assert.equal(e.paper.history.length,0);await e.tick();assert.equal(e.calls.count,1);
});
test('judgment ON clears the old failure wait for the first tick only',async t=>{
 const {e}=immediateSetup(t);e.lastAnalysis=Date.now();e.coolUntil=Date.now()+15000;await e.setJudgment(true);await e.tick();assert.equal(e.calls.count,1);await e.tick();assert.equal(e.calls.count,1);
});
test('late failed response from old market cannot reinstate cooldown after market change',async t=>{
 const {e,feed}=immediateSetup(t);e.judgmentRunning=true;const fresh=e.askJev;let rejectOld;e.askJev=()=>new Promise((resolve,reject)=>rejectOld=reject);const pending=e.analyze();
 feed.select=async symbol=>{feed.symbol=symbol;};await e.select('KRW-ETH');rejectOld(Error('old request failed'));await pending;assert.equal(e.coolUntil,0);e.askJev=fresh;await e.tick();assert.equal(e.calls.count,2);assert.ok(e.decision);
});
test('new run still waits for fresh data and OFF cancels queued first judgment',async t=>{
 const {e,feed}=immediateSetup(t);e.lastAnalysis=Date.now();const trades=feed.trades;feed.trades=[];await e.startConnected();await e.tick();assert.equal(e.calls.count,0);assert.equal(e.startRequested,true);
 await e.setJudgment(false);feed.trades=trades;await e.tick();assert.equal(e.calls.count,0);assert.equal(e.running,false);
});
