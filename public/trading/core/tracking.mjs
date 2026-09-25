import Decimal from "../vendor/decimal.mjs";
import { randomUUID } from "./web-crypto.mjs";
import { D, validateBook, riskCheck, applyFill } from "./core.mjs";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This is the same spendable base exposed to the percentage buttons.
export function manualBuyingPower(ledger, config, book, chance = null) {
  if (!ledger || !book?.orderbook_units?.length) return 0;
  const fee = chance ? Number(chance.bid_fee) : config.feePct / 100;
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.01) return 0;
  const bid = book.orderbook_units[0].bid_price;
  const cash = chance
    ? Decimal.min(ledger.cash, chance.bid_account?.balance || 0)
    : D(ledger.cash);
  const headroom = config.maxPositionKrw === 0 ? cash : D(config.maxPositionKrw).minus(D(ledger.quantity).mul(bid));
  return Decimal.max(0, Decimal.min(cash.div(D(1).plus(fee)), headroom))
    .floor()
    .toNumber();
}
export function percentageAmount(base, pct) {
  if (!Number.isFinite(base) || ![10, 25, 50, 100].includes(pct))
    throw Error("비율 오류");
  return Math.floor((base * pct) / 100);
}
export class TrackingExecutor {
  constructor(engine, saved = null) {
    this.e = engine;
    this.state = saved
      ? {
          ...saved,
          active: false,
          phase: "재시작으로 추적 중지 · 미확정 주문은 별도 확인",
        }
      : null;
    this.busy = false;
  }
  start(side, amount, sellPct = "100", sellAmount = null) {
    const e = this.e;
    e.assertIdle();
    const l = e.ledger();
    if (!l) throw Error("시작금을 먼저 설정하세요.");
    if (e.mode === "live" && (!e.armed || !e.broker.verified))
      throw Error("실전 주문 잠금 상태");
    if (!["buy", "sell"].includes(side)) throw Error("주문 방향 오류");
    const p = D(sellPct);
    if (!p.isFinite() || p.lte(0) || p.gt(100)) throw Error("매도 비율 오류");
    if (l.market !== e.feed.symbol) throw Error("계좌 종목 불일치");
    if (
      sellAmount !== null &&
      (typeof sellAmount !== "number" ||
        !Number.isFinite(sellAmount) ||
        sellAmount < 5000)
    )
      throw Error("팔 금액은 5,000원 이상으로 입력하세요.");
    const sellPrice = validateBook(e.feed.book)[0].bid_price;
    const quantity = (
      side === "sell" && sellAmount !== null
        ? D(sellAmount).div(sellPrice)
        : D(l.quantity).mul(p).div(100)
    )
      .toDecimalPlaces(8, 1)
      .toString();
    const cfg = { ...e.config, orderKrw: e.config.maxPositionKrw === 0 ? Number.MAX_SAFE_INTEGER : e.config.maxPositionKrw };
    riskCheck({
      ledger: l,
      book: e.feed.book,
      config: cfg,
      side,
      amount,
      quantity,
      ignoreCooldown: true,
    });
    if (
      side === "buy" &&
      amount >
        manualBuyingPower(
          l,
          e.config,
          e.feed.book,
          e.mode === "live" ? e.chance : null,
        )
    )
      throw Error("수수료/최대 보유 한도를 반영한 주문가능 금액 초과");
    const previous = this.state;
    this.state = {
      id: randomUUID(),
      active: true,
      mode: e.mode,
      market: l.market,
      ledgerId: l.id,
      side,
      targetFunds: side === "buy" ? String(amount) : "0",
      targetQuantity: side === "sell" ? quantity : "0",
      filled: "0",
      funds: "0",
      fees: "0",
      attempts: 0,
      startedAt: Date.now(),
      phase: "현재 호가 주문 준비",
      lastPrice: null,
      lastPaperBook: null,
      generation: e.generation,
    };
    try {
      e.save();
    } catch (err) {
      this.state = previous;
      throw err;
    }
    e.event(
      "현재가 추적 " +
        (side === "buy" ? "매수" : "매도") +
        " 시작 · 완료 또는 중지까지 잔량만 재주문",
    );
    // No Jev call or analysis interval is in this execution path.
    void this.pump();
  }
  stop(reason = "사용자 추적 중지") {
    if (!this.state?.active) return;
    this.state.active = false;
    this.state.phase = reason;
    this.state.endedAt = Date.now();
    this.e.save();
    this.e.event(reason);
  }
  guard() {
    const e = this.e,
      s = this.state;
    if (
      !s?.active ||
      s.generation !== e.generation ||
      s.mode !== e.mode ||
      s.market !== e.feed.symbol ||
      s.ledgerId !== e.ledger()?.id ||
      e.running ||
      (s.mode === "live" && !e.armed)
    )
      throw Error("추적 중지 또는 실행 상태 변경");
  }
  remaining() {
    const s = this.state;
    return s.side === "buy"
      ? D(s.targetFunds).minus(s.funds)
      : D(s.targetQuantity).minus(s.filled);
  }
  record(fill, trackingId) {
    if (!this.state || this.state.id !== trackingId || !fill) return;
    const s = this.state;
    s.filled = D(s.filled).plus(fill.quantity).toString();
    s.funds = D(s.funds).plus(fill.funds).toString();
    s.fees = D(s.fees).plus(fill.fee).toString();
    if (
      (s.side === "buy" && D(s.funds).gt(s.targetFunds)) ||
      (s.side === "sell" && D(s.filled).gt(s.targetQuantity))
    )
      throw Error("추적 목표 초과 체결 · 대사 필요");
    s.lastFillAt = Date.now();
    if (s.active) s.phase = "부분 체결 확인 · 잔량 재주문";
  }
  snapshot() {
    if (!this.state) return null;
    return {
      ...this.state,
      remaining: this.remaining().toString(),
      busy: this.busy,
    };
  }
  async pump() {
    if (this.busy || !this.state?.active) return;
    this.busy = true;
    const e = this.e,
      s = this.state;
    try {
      while (s.active) {
        this.guard();
        const l = e.ledger();
        if (l.pending) {
          s.phase = "체결/잔량 취소 확인 중";
          await e.reconcile();
          if (!s.active) break;
          if (l.pending) {
            // IOC normally cancels the remainder at the exchange. A slow unresolved
            // order is explicitly cancelled, then queried; never replaced speculatively.
            if (
              Date.now() - l.pending.at > 1500 &&
              !l.pending.cancelRequested
            ) {
              l.pending.cancelRequested = true;
              e.save();
              await e.broker.cancel(l.pending.identifier);
            }
            await pause(50);
          }
          continue;
        }
        let rows;
        try {
          rows = validateBook(e.feed.book);
        } catch {
          s.phase = "최신 호가 대기 · 주문 보류";
          await pause(100);
          continue;
        }
        const rem = this.remaining();
        const price = s.side === "buy" ? rows[0].ask_price : rows[0].bid_price;
        const min =
          e.mode === "live"
            ? Number(
                (s.side === "buy"
                  ? e.chance?.market?.bid
                  : e.chance?.market?.ask
                )?.min_total || 5000,
              )
            : 5000;
        if (rem.lte(0)) {
          this.stop("목표 전량 체결 완료");
          break;
        }
        if ((s.side === "buy" ? rem : rem.mul(price)).lt(min)) {
          this.stop(
            s.side === "buy" && rem.lt(D(price).mul(".00000001"))
              ? "거래 가능한 수량 체결 완료 · 아주 작은 원화 잔액 유지"
              : "추적 종료 · 남은 양이 거래소 최소 주문금액 미만",
          );
          break;
        }
        if (
          s.mode === "paper" &&
          s.lastPaperBook ===
            String(e.feed.book.sourceTimestamp ?? e.feed.book.timestamp)
        ) {
          s.phase = "새 호가 대기 · 같은 잔량 재사용 안 함";
          await pause(50);
          continue;
        }
        await this.attempt(rem);
        // Immediately continue with the next exchange result/new book, with no
        // retry count, duration cutoff, strategy cooldown, or AI decision delay.
      }
    } catch (err) {
      if (s.active)
        this.stop(
          err.message +
            " · 추적 중지" +
            (e.ledger()?.pending ? " · 미확정 주문 확인 필요" : ""),
        );
      e.fail(err);
    } finally {
      this.busy = false;
    }
  }
  async attempt(rem) {
    const e = this.e,
      s = this.state,
      l = e.ledger();
    if (e.orderBusy) throw Error("다른 주문 처리 중");
    e.orderBusy = true;
    try {
      let cfg = { ...e.config, orderKrw: e.config.maxPositionKrw === 0 ? Number.MAX_SAFE_INTEGER : e.config.maxPositionKrw };
      if (s.mode === "live") {
        e.chance = await e.broker.chance(s.market);
        const fee = Number(
          s.side === "buy" ? e.chance.bid_fee : e.chance.ask_fee,
        );
        if (!Number.isFinite(fee) || fee < 0 || fee > 0.01)
          throw Error("업비트 수수료 확인 실패");
        cfg.feePct = fee * 100;
        if (e.chance.market?.state !== "active") throw Error("거래 불가 마켓");
      }
      this.guard();
      const makeParams = () => {
        this.guard();
        const b = validateBook(e.feed.book)[0];
        const price = D(s.side === "buy" ? b.ask_price : b.bid_price);
        const quantity = (
          s.side === "buy" ? rem.div(price) : rem
        ).toDecimalPlaces(8, 1);
        const funds = quantity.mul(price);
        riskCheck({
          ledger: l.pending ? { ...l, pending: null } : l,
          book: e.feed.book,
          config: cfg,
          side: s.side,
          amount: s.side === "buy" ? rem.toNumber() : 0,
          quantity: quantity.toString(),
          ignoreCooldown: true,
        });
        if (s.mode === "live") {
          const minimum = Number(
            (s.side === "buy" ? e.chance.market?.bid : e.chance.market?.ask)
              ?.min_total,
          );
          if (
            !Number.isFinite(minimum) ||
            (s.side === "buy" ? rem : funds).lt(minimum)
          )
            throw Error("업비트 최소 주문금액 미만");
          if (
            s.side === "buy" &&
            funds
              .mul(D(1).plus(D(cfg.feePct).div(100)))
              .gt(e.chance.bid_account?.balance || 0)
          )
            throw Error("업비트 주문가능 원화 부족");
          if (
            s.side === "sell" &&
            quantity.gt(e.chance.ask_account?.balance || 0)
          )
            throw Error("업비트 주문가능 수량 부족");
        }
        s.lastPrice = price.toNumber();
        return {
          market: s.market,
          side: s.side === "buy" ? "bid" : "ask",
          ord_type: "best",
          time_in_force: "ioc",
          ...(s.side === "buy"
            ? { price: rem.toString() }
            : { volume: quantity.toString() }),
          smp_type: "cancel_taker",
        };
      };
      const params = makeParams();
      const paperLimit = D(s.lastPrice);
      const paperQuantity = (
        s.side === "buy" ? rem.div(paperLimit) : rem
      ).toDecimalPlaces(8, 1);
      s.attempts++;
      s.phase = "현재 호가 주문 전송";
      if (s.mode === "paper") {
        await pause(100);
        this.guard();
        const b = validateBook(e.feed.book)[0];
        s.lastPaperBook = String(
          e.feed.book.sourceTimestamp ?? e.feed.book.timestamp,
        );
        const price = D(s.side === "buy" ? b.ask_price : b.bid_price);
        if (
          (s.side === "buy" && price.gt(paperLimit)) ||
          (s.side === "sell" && price.lt(paperLimit))
        ) {
          s.phase = "가격 이동 · 미체결 취소 후 재주문";
          e.save();
          return;
        }
        const q = Decimal.min(
          paperQuantity,
          D(s.side === "buy" ? b.ask_size : b.bid_size).mul(".1"),
        ).toDecimalPlaces(8, 1);
        if (q.lte(0)) {
          s.phase = "체결 가능 잔량 대기";
          e.save();
          return;
        }
        const funds = q.mul(price),
          fee = funds.mul(D(cfg.feePct).div(100));
        const fill = {
          quantity: q.toString(),
          funds: funds.toString(),
          fee: fee.toString(),
          price: price.toNumber(),
        };
        const before = structuredClone(l),
          beforeState = structuredClone(s);
        try {
          applyFill(l, s.side, fill, {
            reason: "현재가 추적 " + s.attempts + "차",
          });
          this.record(fill, s.id);
          e.save();
        } catch (err) {
          Object.assign(l, before);
          Object.assign(s, beforeState);
          throw err;
        }
        return;
      }
      params.identifier = "jev-" + randomUUID();
      l.pending = {
        identifier: params.identifier,
        params,
        side: s.side,
        at: Date.now(),
        reason: "현재가 추적 " + s.attempts + "차",
        decisionId: null,
        trackingId: s.id,
        status: "sending",
      };
      e.save();
      try {
        const result = await e.broker.send(params, () => {
          // Queue admission can take time: refresh the latest book and remaining budget at
          // the final send boundary and persist the exact request values before any network IO.
          Object.assign(params, makeParams());
          l.pending.sentAt = Date.now();
          e.save();
        });
        l.pending.uuid = result.uuid;
        l.pending.status = "accepted";
        l.pending.acceptedAt = Date.now();
        e.save();
      } catch (err) {
        if (err.notSent) l.pending = null;
        else if (l.pending) l.pending.status = "unknown";
        e.save();
        throw err;
      }
    } finally {
      e.orderBusy = false;
    }
  }
}
