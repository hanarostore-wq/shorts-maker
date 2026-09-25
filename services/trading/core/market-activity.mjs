// Rolling estimates from observed cumulative KRW turnover; never sum ticker trade_volume.
export class MarketActivity {
  constructor() { this.rows = new Map(); }
  observe(ticker, now = Date.now()) {
    const code = ticker.market || ticker.code;
    const total = Number(ticker.acc_trade_price), price = Number(ticker.trade_price);
    const sourceAt = Number(ticker.timestamp);
    if (!code || !Number.isFinite(total) || total < 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(sourceAt)) return;
    const day = ticker.trade_date || new Date(sourceAt).toISOString().slice(0, 10);
    let row = this.rows.get(code);
    if (row && sourceAt < row.sourceAt) return;
    if (!row || row.day !== day || total < row.total || now - row.lastSeen > 45000) {
      row = {day, sourceAt, total, startedAt: now, lastSeen: now, samples: [{at: now, total, price}]};
      this.rows.set(code, row);
      return;
    }
    row.sourceAt = sourceAt; row.total = total; row.lastSeen = now;
    const sample = {at: now, total, price};
    const last = row.samples.at(-1);
    if (row.samples.length > 1 && Math.floor(last.at / 1000) === Math.floor(now / 1000)) row.samples[row.samples.length - 1] = sample;
    else row.samples.push(sample);
    while (row.samples.length > 2 && row.samples[1].at < now - 125000) row.samples.shift();
  }
  snapshot(code, now = Date.now()) {
    const r = this.rows.get(code);
    if (!r) return {ready: false, fullWindow: false, reason: '실시간 자료 집계 중', observedSeconds: 0};
    const observedSeconds = Math.floor((now - r.startedAt) / 1000);
    if (now - r.lastSeen > 45000) return {ready:false, fullWindow:false, reason:'시세 수신 지연', observedSeconds};
    const at = cutoff => {
      // Previous sample is at most 35s from the requested boundary (REST fallback).
      const before = r.samples.findLast(s => s.at <= cutoff);
      return before && cutoff - before.at <= 35000 ? before : null;
    };
    const current = r.samples.at(-1), one = at(now - 60000), two = at(now - 120000);
    if (!one) return {ready:false, fullWindow:false, reason:'최근 1분 집계 중', observedSeconds};
    const recentKrw = Math.max(0, current.total - one.total);
    const previousKrw = two ? Math.max(0, one.total - two.total) : null;
    return {
      ready: true, fullWindow: !!two, reason: two ? '' : '거래 증가세 집계 중', observedSeconds,
      recentKrw, previousKrw,
      growthRatio: previousKrw > 0 ? recentKrw / previousKrw : null,
      returnPct: (current.price / one.price - 1) * 100,
      asOf: r.lastSeen,
    };
  }
}
