import { decidePaper, type PaperMarket } from "./paperEngine";

export type LoopAction = "KILL" | "PULL_QUOTES" | "WIDEN" | "QUOTE_BOTH_SIDES" | "QUOTE_WIDE" | "STAND_DOWN";
export type OrderSide = "buy" | "sell";
export type RestingOrder = { id: string; side: OrderSide; price: number; quantity: number; createdAt: number };
export type Fill = { id: string; orderId: string; side: OrderSide; price: number; quantity: number; fee: number; timestamp: number };
export type LoopInput = PaperMarket & { timestamp?: number; allowedBuy?: boolean; allowedSell?: boolean; marketOpen?: boolean; feeRate?: number; targetNotional?: number };
export type LoopState = { cash: number; asset: number; averageCost: number; realizedPnl: number; resting: RestingOrder[]; fills: Fill[]; tick: number };
export type Battery = { regime: string; direction: "BUY" | "SELL" | "HOLD"; toxicFlow: string; liquidityStress: string; quoteEnvironment: string; inventoryPressure: string; executionHealth: string; buyConfidence: number; sellConfidence: number; latencyMs: number; provider: "JEV" | "RULES_ONLY" };
export type LoopTick = { state: LoopState; action: LoopAction; battery: Battery; decisionReason: string; orders: RestingOrder[]; fills: Fill[]; spreadBps: number; mid: number };

const id = () => `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function battery(input: LoopInput, decision: ReturnType<typeof decidePaper>): Battery {
  const imbalance = decision.state.imbalance;
  const buyConfidence = clamp(0.5 + imbalance * 0.45, 0.01, 0.99);
  const sellConfidence = clamp(0.5 - imbalance * 0.45, 0.01, 0.99);
  return {
    regime: decision.judgments.regime,
    direction: buyConfidence > sellConfidence + 0.08 ? "BUY" : sellConfidence > buyConfidence + 0.08 ? "SELL" : "HOLD",
    toxicFlow: decision.judgments.toxicFlow,
    liquidityStress: decision.judgments.liquidityStress,
    quoteEnvironment: decision.judgments.quoteEnvironment,
    inventoryPressure: decision.judgments.inventoryPressure,
    executionHealth: decision.judgments.executionHealth,
    buyConfidence,
    sellConfidence,
    latencyMs: 0,
    provider: "RULES_ONLY",
  };
}

function composeAction(input: LoopInput, state: LoopState, decision: ReturnType<typeof decidePaper>, feed: Battery): LoopAction {
  if (input.marketOpen === false) return "KILL";
  if (!input.websocketHealthy || (input.dataAgeMs ?? 0) > 3000 || !decision.risk.allowed) return "KILL";
  if (!input.allowedBuy && !input.allowedSell) return "STAND_DOWN";
  if (decision.state.spreadBps > 30) return "PULL_QUOTES";
  if (decision.state.spreadBps > 12) return "QUOTE_WIDE";
  if (Math.abs(decision.state.imbalance) > 0.65) return "WIDEN";
  if (feed.direction === "HOLD") return "QUOTE_BOTH_SIDES";
  if (state.asset > 0 && state.asset * input.price > (input.targetNotional ?? 50000) * 0.9) return "STAND_DOWN";
  return "QUOTE_BOTH_SIDES";
}

function quotePrices(input: LoopInput, action: LoopAction, mid: number) {
  const base = Math.max(mid * 0.00005, 0.00000001);
  const width = action === "QUOTE_WIDE" || action === "WIDEN" ? Math.max(input.price * 0.0015, base) : Math.max(input.price * 0.0004, base);
  return { bid: Math.max(0, mid - width), ask: mid + width };
}

function matchResting(state: LoopState, input: LoopInput, now: number): Fill[] {
  const fills: Fill[] = [];
  const ask = Number(input.bestAsk ?? input.price);
  const bid = Number(input.bestBid ?? input.price);
  const feeRate = input.feeRate ?? 0.0004;
  const remaining: RestingOrder[] = [];
  for (const order of state.resting) {
    const matched = order.side === "buy" ? ask <= order.price : bid >= order.price;
    const affordable = order.side === "buy" ? state.cash >= order.price * order.quantity : state.asset >= order.quantity;
    if (!matched || !affordable) { remaining.push(order); continue; }
    const notional = order.price * order.quantity;
    const fee = notional * feeRate;
    fills.push({ id: id(), orderId: order.id, side: order.side, price: order.price, quantity: order.quantity, fee, timestamp: now });
    if (order.side === "buy") {
      const oldValue = state.averageCost * state.asset;
      state.cash -= notional + fee; state.asset += order.quantity; state.averageCost = (oldValue + notional + fee) / state.asset;
    } else {
      state.cash += notional - fee; state.realizedPnl += (order.price - state.averageCost) * order.quantity - fee; state.asset -= order.quantity;
    }
  }
  state.resting = remaining;
  state.fills = [...fills, ...state.fills].slice(0, 200);
  return fills;
}

export function newLoopState(initialCash = 100000): LoopState { return { cash: initialCash, asset: 0, averageCost: 0, realizedPnl: 0, resting: [], fills: [], tick: 0 }; }

export function runLoopTick(previous: LoopState, input: LoopInput): LoopTick {
  const state: LoopState = { ...previous, resting: [...previous.resting], fills: [...previous.fills] };
  const now = input.timestamp ?? Date.now();
  const price = Number(input.price);
  const mid = (Number(input.bestBid ?? price) + Number(input.bestAsk ?? price)) / 2;
  const paper = decidePaper(input, state.asset * price, state.realizedPnl);
  const feed = battery(input, paper);
  feed.latencyMs = 0;
  const action = composeAction(input, state, paper, feed);
  const fills = matchResting(state, input, now);
  if (action !== "KILL" && action !== "PULL_QUOTES" && action !== "STAND_DOWN") {
    const { bid, ask } = quotePrices(input, action, mid);
    const target = input.targetNotional ?? 5000;
    const buyQty = target / bid;
    const sellQty = Math.min(state.asset, target / ask);
    if (input.allowedBuy !== false && state.cash >= target && feed.buyConfidence >= 0.5) state.resting.push({ id: id(), side: "buy", price: bid, quantity: buyQty, createdAt: now });
    if (input.allowedSell !== false && sellQty > 0 && feed.sellConfidence >= 0.5) state.resting.push({ id: id(), side: "sell", price: ask, quantity: sellQty, createdAt: now });
  }
  state.tick += 1;
  return { state, action, battery: feed, decisionReason: paper.reason, orders: state.resting, fills, spreadBps: paper.state.spreadBps, mid };
}
