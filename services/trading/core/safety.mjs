import {tradeContext} from '../analytics.mjs';
import { D, markLedger, validateBook } from './core.mjs';

// These are execution rules, not AI opinions. Stop prices are triggers, not guaranteed fills.
export function safetySignal(ledger, f, config, now = Date.now()) {
  if (!ledger || !f || Number(ledger.quantity) <= 0) return null;
  const mark = markLedger(ledger, f.bid, config.feePct, now);
  const average = mark.averagePrice;
  const netBid = f.bid * (1 - config.feePct / 100);
  if (netBid <= average * (1 - config.stopLossPct / 100))
    return '절대 손실 한도 도달';
  if ((config.dailyLossKrw > 0 && mark.dailyPnl <= -config.dailyLossKrw) || mark.drawdownPct >= config.maxDrawdownPct)
    return '계좌 손실 한도 도달';
  if (!config.strategyEnabled) return null;
  if (Number.isFinite(f.strategy?.fastReturnBps) && f.strategy.fastReturnBps <= -config.crashBps)
    return '최근 5초 급락 감지';
  // Capture ATR once per position, never widen a stop when volatility rises.
  if (!ledger.riskState && f.strategy?.ready && f.strategy.atr > 0) {
    ledger.riskState = { openedAt:ledger.openedAt, atr:f.strategy.atr,
      peakBid:f.bid, stopNet:average - f.strategy.atr * config.atrMultiplier };
  }
  const risk = ledger.riskState;
  if (risk) {
    risk.peakBid = Math.max(risk.peakBid, f.bid);
    risk.stopNet = Math.max(risk.stopNet,
      average * (1 - config.stopLossPct / 100),
      risk.peakBid * (1 - config.feePct / 100) - risk.atr * config.trailAtrMultiplier);
    if (netBid <= risk.stopNet) return '가격 흔들림을 반영한 추적 손절선 도달';
  }
  return null;
}

export class SafetyEngine {
  constructor(engine) { this.engine=engine; this.busy=false; this.lastAttempt=0; this.status='정지'; }
  request(reason, cause="strategy_exit") {
    const e=this.engine,l=e.ledger();
    if (!l || (Number(l.quantity)<=0 && !l.pending)) return;
    if (!l.exitIntent || l.exitIntent.phase==='complete') {
      l.exitIntent={reason,at:Date.now(),phase:'requested',analytics:tradeContext(e,{automatic:cause==='jev',reason,cause})};
      // Fence in-flight AI answers and buys before the first asynchronous exit step.
      e.generation++;
      e.decision=null;
      e.save();
      e.event('청산 시작 · '+reason);
    }
  }
  async tick(f) {
    const e=this.engine,l=e.ledger();
    if (!e.running || !l) {this.status=l?.exitIntent&&l.exitIntent.phase!=='complete'?'중단됨 · 잔여 청산은 시작 후 재개':'정지';return;}
    if (e.scanning) {this.status='보유 없음 · 새 종목 자료 준비 중';return;}
    if (l.market!==e.feed.symbol) {this.status='계좌·종목 불일치 · 주문 중단';e.stop();return;}
    try { validateBook(e.feed.book); } catch {
      this.status='시세 지연 · 주문 중단, 최신 호가 대기';return;
    }
    if (!f || !e.feed.clockVerified) {this.status='시세 확인 중';return;}
    const before=JSON.stringify(l.riskState);
    const trigger=safetySignal(l,f,e.config);
    if (before!==JSON.stringify(l.riskState)) e.save();
    if (trigger) this.request(trigger, trigger.includes('손절')||trigger.includes('절대 손실')?'hard_stop':'risk');
    const intent=l.exitIntent;
    if (!intent || intent.phase==='complete') {this.status='실시간 위험 감시 중';return;}
    this.status=intent.reason+' · 청산 진행 중';
    if (this.busy || e.orderBusy || e.tracker.busy) return;
    if (e.tracker.state?.active) e.tracker.stop('위험 청산 우선');
    this.busy=true;
    try {
      if (l.pending) {
        intent.phase='confirming';
        this.status='기존 주문 체결·취소 확인 중 · 중복 주문 금지';
        if (Date.now()-this.lastAttempt<1000) return;
        this.lastAttempt=Date.now();
        // Query even after cancel/timeout. Never assume a cancel response means no fill.
        if (e.mode==='live' && e.broker.verified) {
          if (Date.now()-l.pending.at>=e.config.pendingTimeoutSeconds*1000 && l.pending.status!=='unknown') {
            e.orderBusy=true;
            try { await e.broker.cancel(l.pending.identifier); }
            catch { this.status='취소 결과 확인 필요 · 원주문 조회'; }
            finally {e.orderBusy=false;}
          }
          await e.reconcile();
        }
        return;
      }
      if (D(l.quantity).isZero()) {
        // live fills were reconciled by order identifier. Also query exchange balance,
        // separating any pre-existing personal holdings from bot-owned inventory.
        if (e.mode==='live') {
          intent.phase='verifying';
          const baseline=l.exchangeBaseline;
          if (baseline===undefined) {this.status='봇 수량 0 · 거래소 기준 잔고 확인 필요';return;}
          if (Date.now()-this.lastAttempt<1000) return;
          this.lastAttempt=Date.now();
          const gen=e.generation;
          e.orderBusy=true;
          let chance;
          try {chance=await e.broker.chance(l.market);} finally {e.orderBusy=false;}
          if (!e.running || gen!==e.generation) return;
          const total=D(chance.ask_account?.balance).plus(chance.ask_account?.locked||0);
          if (!total.isFinite() || !total.minus(baseline).abs().lte('0.00000001')) {
            intent.phase='mismatch';this.status='거래소 잔고 불일치 · 확인 필요';e.stop();e.save();return;
          }
        }
        intent.phase='complete';intent.completedAt=Date.now();e.save();
        this.status='청산 완료 · 봇 보유수량 0 확인';e.event(this.status);return;
      }
      const minimum=e.mode==='live'?Number(e.chance?.market?.ask?.min_total||5000):5000;
      if (D(l.quantity).mul(f.bid).lt(minimum) || D(l.quantity).toDecimalPlaces(8,1).isZero()) {
        intent.phase='dust';e.save();this.status='최소 주문금액 미만 잔여 보유 · 청산 미완료';return;
      }
      if (Date.now()-this.lastAttempt<1000) return;
      if (e.mode==='paper' && this.lastPaperBook===e.feed.book.timestamp) {
        this.status='부분 체결 후 새 호가 대기 · 같은 잔량 중복 사용 금지';return;
      }
      this.lastAttempt=Date.now();intent.phase='selling';e.save();
      const usedBook=e.feed.book.timestamp;
      const result=await e.order('sell',0,'100',intent.reason,true,null,true);
      if (e.mode==='paper') this.lastPaperBook=result?.bookTimestamp ?? usedBook;
    } catch(err) {
      intent.phase=l.pending?'confirming':'retry';e.save();
      this.status='청산 미완료 · '+err.message;e.fail(Error(this.status));
    } finally {this.busy=false;}
  }
  snapshot() {
    const l=this.engine.ledger();
    return {status:this.status,busy:this.busy,intent:l?.exitIntent||null,risk:l?.riskState||null};
  }
}
