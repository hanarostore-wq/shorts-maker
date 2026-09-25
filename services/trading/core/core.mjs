import Decimal from "../../../public/trading/vendor/decimal.mjs";
import { randomUUID } from "node:crypto";
import { strategyDecision } from "./strategy.mjs";
export const D = (x) => new Decimal(x);
export const defaults = {
  orderKrw: 10000,
  maxPositionKrw: 50000,
  dailyLossKrw: 10000,
  maxDrawdownPct: 3,
  stopLossPct: 0.7,
  takeProfitPct: 1.2,
  maxHoldSeconds: 900,
  cooldownSeconds: 1,
  intervalSeconds: 60,
  horizonSeconds: 60,
  strategyEnabled: 1,
  autoScan: 1,
  entryScore: 0.72,
  weaknessExitScore: 0.72,
  atrMultiplier: 2,
  trailAtrMultiplier: 3,
  crashBps: 60,
  pendingTimeoutSeconds: 10,
  feePct: 0.05,
  slippageBps: 2,
  maxSpreadBps: 15,
  entryProbability: 0.72,
  exitProbability: 0.65,
  maxCallsPerDay: 0,
};
export function validateConfig(input, base = defaults) {
  const ranges = {
    orderKrw: [5000, 10000000],
    maxPositionKrw: [5000, 10000000],
    dailyLossKrw: [100, 1000000],
    maxDrawdownPct: [0.1, 20],
    stopLossPct: [0.1, 10],
    takeProfitPct: [0.1, 30],
    maxHoldSeconds: [10, 86400],
    cooldownSeconds: [1, 3600],
    intervalSeconds: [1, 300],
    horizonSeconds: [1, 60],
    feePct: [0, 1],
    slippageBps: [0, 100],
    maxSpreadBps: [1, 100],
    entryProbability: [0.5, 0.99],
    exitProbability: [0.5, 0.99],
    maxCallsPerDay: [0, 50000],
    strategyEnabled: [0, 1],
    autoScan: [0, 1],
    entryScore: [0.5, 0.99],
    weaknessExitScore: [0.5, 0.99],
    atrMultiplier: [0.5, 10],
    trailAtrMultiplier: [1, 15],
    crashBps: [10, 500],
    pendingTimeoutSeconds: [3, 60],
  };
  const out = { ...base };
  for (const [k, v] of Object.entries(input)) {
    if (
      !ranges[k] ||
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < ranges[k][0] ||
      v > ranges[k][1]
    )
      throw Error("잘못된 설정: " + k);
    if (["strategyEnabled", "autoScan"].includes(k) && !Number.isInteger(v))
      throw Error("잘못된 ON/OFF 설정: " + k);
    out[k] = v;
  }
  if (out.orderKrw > out.maxPositionKrw)
    throw Error("1회 주문금액이 최대 보유금액보다 큽니다.");
  return out;
}
export function newLedger(capital, market, mode = "paper") {
  if (!Number.isSafeInteger(capital) || capital < 5000 || capital > 1000000000)
    throw Error("시작금은 5,000~1,000,000,000원의 정수로 입력하세요.");
  return {
    id: randomUUID(),
    mode,
    market,
    createdAt: Date.now(),
    initial: String(capital),
    cash: String(capital),
    quantity: "0",
    cost: "0",
    fees: "0",
    realized: "0",
    highWater: String(capital),
    day: "",
    dayStart: String(capital),
    lastOrderAt: 0,
    openedAt: null,
    history: [],
    pending: null,
  };
}
export function equity(l, bid, feePct = 0) {
  return D(l.cash).plus(
    D(l.quantity)
      .mul(bid || 0)
      .mul(D(1).minus(D(feePct).div(100))),
  );
}
export function markLedger(l, bid, feePct, now = Date.now()) {
  const e = equity(l, bid, feePct);
  const day = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  if (l.day !== day) {
    l.day = day;
    l.dayStart = e.toString();
  }
  if (e.gt(l.highWater)) l.highWater = e.toString();
  return {
    equity: e.toNumber(),
    pnl: e.minus(l.initial).toNumber(),
    pnlPct: e.div(l.initial).minus(1).mul(100).toNumber(),
    dailyPnl: e.minus(l.dayStart).toNumber(),
    drawdownPct: D(l.highWater).minus(e).div(l.highWater).mul(100).toNumber(),
    positionKrw: D(l.quantity)
      .mul(bid || 0)
      .toNumber(),
    quantity: Number(l.quantity),
    averagePrice: D(l.quantity).gt(0)
      ? D(l.cost).div(l.quantity).toNumber()
      : 0,
    fees: Number(l.fees),
    cash: Number(l.cash),
  };
}
export function validateBook(book, now = Date.now()) {
  if (
    !book ||
    !Array.isArray(book.orderbook_units) ||
    !book.orderbook_units.length ||
    !Number.isFinite(book.timestamp) ||
    now - book.timestamp > 3000 ||
    book.timestamp - now > 2000
  )
    throw Error("호가가 없거나 3초 이상 지연됐습니다.");
  const b = book.orderbook_units;
  for (const x of b)
    for (const k of ["ask_price", "bid_price", "ask_size", "bid_size"])
      if (!Number.isFinite(x[k]) || x[k] <= 0)
        throw Error("잘못된 호가 데이터");
  if (b[0].ask_price <= b[0].bid_price) throw Error("역전된 호가");
  return b;
}
export function planFill({
  side,
  amount,
  quantity,
  book,
  feePct,
  slippageBps = 0,
  participation = 0.1,
  allowPartial = false,
  now = Date.now(),
}) {
  if (!["buy", "sell"].includes(side)) throw Error("주문 방향 오류");
  const rows = validateBook(book, now);
  let remaining = D(side === "buy" ? amount : quantity);
  if (!remaining.isFinite() || remaining.lte(0))
    throw Error("주문 금액/수량 오류");
  let qty = D(0),
    funds = D(0);
  for (const r of rows) {
    const price = D(side === "buy" ? r.ask_price : r.bid_price).mul(
      D(1).plus(
        D(slippageBps)
          .div(10000)
          .mul(side === "buy" ? 1 : -1),
      ),
    );
    const cap = D(side === "buy" ? r.ask_size : r.bid_size).mul(participation);
    const q = Decimal.min(
      cap,
      side === "buy" ? remaining.div(price) : remaining,
    ).toDecimalPlaces(8, Decimal.ROUND_DOWN);
    qty = qty.plus(q);
    funds = funds.plus(q.mul(price));
    remaining = remaining.minus(side === "buy" ? q.mul(price) : q);
    if (remaining.lte(side === "buy" ? price.mul("0.00000001") : 0)) break;
  }
  if (
    qty.lte(0) ||
    (!allowPartial && remaining.gt(
      side === "buy" ? D(rows[0].ask_price).mul("0.00000002") : D("0.00000001"),
    ))
  )
    throw Error("보수적 호가 잔량 한도에서 전량 체결 불가");
  return {
    quantity: qty.toString(),
    funds: funds.toString(),
    fee: funds.mul(D(feePct).div(100)).toString(),
    price: funds.div(qty).toNumber(),
  };
}
export function applyFill(l, side, fill, meta = {}) {
  const q = D(fill.quantity),
    funds = D(fill.funds),
    fee = D(fill.fee);
  if (
    !q.isFinite() ||
    !funds.isFinite() ||
    !fee.isFinite() ||
    q.lte(0) ||
    funds.lte(0) ||
    fee.lt(0)
  )
    throw Error("체결값 오류");
  let realized = D(0);
  if (side === "buy") {
    if (D(l.cash).lt(funds.plus(fee)))
      throw Error("수수료 포함 주문가능 금액 부족");
    l.cash = D(l.cash).minus(funds).minus(fee).toString();
    l.quantity = D(l.quantity).plus(q).toString();
    l.cost = D(l.cost).plus(funds).plus(fee).toString();
    l.openedAt ??= Date.now();
  } else if (side === "sell") {
    if (q.gt(l.quantity)) throw Error("보유수량 부족");
    const cost = D(l.cost).mul(q.div(l.quantity));
    realized = funds.minus(fee).minus(cost);
    l.quantity = D(l.quantity).minus(q).toString();
    l.cost = D(l.cost).minus(cost).toString();
    l.cash = D(l.cash).plus(funds).minus(fee).toString();
    l.realized = D(l.realized).plus(realized).toString();
    if (D(l.quantity).isZero()) {
      l.cost = "0";
      l.openedAt = null;
      l.riskState = null;
    }
  } else throw Error("주문 방향 오류");
  l.fees = D(l.fees).plus(fee).toString();
  l.lastOrderAt = Date.now();
  const row = {
    id: meta.id || randomUUID(),
    at: Date.now(),
    market: l.market,
    mode: l.mode,
    side,
    ...fill,
    realized: realized.toString(),
    reason: meta.reason || "수동 주문",
    decisionId: meta.decisionId || null,
  };
  l.history.push(row);
  return row;
}
export function riskCheck({
  ledger,
  book,
  config,
  side,
  amount,
  quantity,
  now = Date.now(),
  ignoreCooldown = false,
}) {
  const b = validateBook(book, now);
  if (ledger.pending) throw Error("미확정 주문이 있어 신규 주문을 중단합니다.");
  if (
    !ignoreCooldown &&
    now - ledger.lastOrderAt < config.cooldownSeconds * 1000
  )
    throw Error("주문 간격 제한 대기");
  const spread =
    ((b[0].ask_price - b[0].bid_price) /
      ((b[0].ask_price + b[0].bid_price) / 2)) *
    10000;
  const m = markLedger(ledger, b[0].bid_price, config.feePct, now);
  if (side === "buy") {
    if (spread > config.maxSpreadBps) throw Error("스프레드 한도 초과");
    if (!Number.isFinite(amount) || amount < 5000 || amount > config.orderKrw)
      throw Error("최소 주문/1회 주문 한도 위반");
    if (
      m.dailyPnl <= -config.dailyLossKrw ||
      m.drawdownPct >= config.maxDrawdownPct
    )
      throw Error("손실 한도 도달: 신규 매수 중단");
    if (m.positionKrw + amount > config.maxPositionKrw)
      throw Error("최대 보유금액 초과");
    if (D(ledger.cash).lt(D(amount).mul(D(1).plus(D(config.feePct).div(100)))))
      throw Error("수수료 포함 잔액 부족");
  } else {
    if (
      !D(quantity).isFinite() ||
      D(quantity).lte(0) ||
      D(quantity).gt(ledger.quantity)
    )
      throw Error("매도 가능 수량 초과");
    if (D(quantity).mul(b[0].bid_price).lt(5000))
      throw Error("최소 매도금액 미만");
  }
  return m;
}
export function decide(answers, features, ledger, config, now = Date.now()) {
  const p = Number(ledger.quantity);
  const m = markLedger(ledger, features.bid, config.feePct, now);
  if (p > 0) {
    const pnl =
      ((features.bid * (1 - config.feePct / 100)) / m.averagePrice - 1) * 100;
    if (pnl <= -config.stopLossPct)
      return { side: "sell", reason: "설정한 손해 비율에 도달해 매도" };
    if (!config.strategyEnabled && pnl >= config.takeProfitPct)
      return { side: "sell", reason: "설정한 이익 비율에 도달해 매도" };
    if (!config.strategyEnabled && now - ledger.openedAt >= config.maxHoldSeconds * 1000)
      return { side: "sell", reason: "최대 보유시간 도달" };
    if (
      m.dailyPnl <= -config.dailyLossKrw ||
      m.drawdownPct >= config.maxDrawdownPct
    )
      return { side: "sell", reason: "계좌 손실 한도: 포지션 정리" };
  }
  if (config.strategyEnabled && features.strategy)
    return strategyDecision(answers, features, ledger, config);
  if (!answers) return { side: "hold", reason: "실제 Jev 판단 대기" };
  if (
    p > 0 &&
    (answers.direction.probabilities.down >= config.exitProbability ||
      answers.inventory_pressure.score >= 2)
  )
    return { side: "sell", reason: "Jev 하락/재고 위험 기준 충족" };
  if (p > 0)
    return {
      side: "hold",
      reason:
        "보유 유지 · 하락 " +
        (answers.direction.probabilities.down * 100).toFixed(1) +
        "% / 매도 기준 " +
        (config.exitProbability * 100).toFixed(0) +
        "% · 계속 보유할 위험 " +
        answers.inventory_pressure.score.toFixed(2) +
        "/3",
    };
  if (
    answers.regime.choice === "crisis" ||
    answers.toxic_flow.noul >= 0.65 ||
    answers.liquidity_stressed.noul >= 0.65
  )
    return {
      side: "hold",
      reason:
        "매수 보류 · " +
        [
          answers.regime.choice === "crisis" ? "위기 국면" : "",
          answers.toxic_flow.noul >= 0.65
            ? "산 뒤 불리해질 위험 " +
              (answers.toxic_flow.noul * 100).toFixed(0) +
              "%"
            : "",
          answers.liquidity_stressed.noul >= 0.65
            ? "거래 물량 부족 위험 " +
              (answers.liquidity_stressed.noul * 100).toFixed(0) +
              "%"
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
    };
  if (
    answers.direction.probabilities.up >= config.entryProbability &&
    answers.direction.confidence >= 0.5 &&
    features.spreadBps <= config.maxSpreadBps
  )
    return { side: "buy", reason: "Jev 상승 판단·판단 집중도·호가 조건 충족" };
  return {
    side: "hold",
    reason:
      "매수 대기 · 상승 " +
      (answers.direction.probabilities.up * 100).toFixed(1) +
      "% / 기준 " +
      (config.entryProbability * 100).toFixed(0) +
      "% · 판단 집중도 " +
      (answers.direction.confidence * 100).toFixed(1) +
      "% / 기준 50% · 살 가격·팔 가격 차이 " +
      (features.spreadBps / 100).toFixed(3) + "% / 최대 " +
      (config.maxSpreadBps / 100).toFixed(3) + "%",
  };
}
