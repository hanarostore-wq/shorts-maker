const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export function rankMarkets(markets) {
  const ready = markets.filter(m => m.activity?.ready && m.activity?.fullWindow && m.ticker);
  const liquidity = ready.map(m => Number(m.ticker.acc_trade_price_24h) || 0).sort((a,b)=>a-b);
  const activity = ready.map(m => m.activity.recentKrw).sort((a,b)=>a-b);
  const percentile = (items, n) => {
    if (!items.length || n <= 0) return 0;
    return items.filter(v => v < n).length / Math.max(1, items.length - 1);
  };
  return markets.map(m => {
    const a = m.activity;
    const warning = !!m.market_event?.warning;
    const caution = Object.values(m.market_event?.caution || {}).some(Boolean);
    let reason = warning ? '투자유의 종목 · 점수 제외' : !a?.ready ? (a?.reason || '실시간 자료 집계 중') : !a.fullWindow ? '2분 자료 집계 중' : '';
    if (warning || !a?.ready || !a.fullWindow || !m.ticker) return {...m, watchScore:null, watchReason:reason};
    // Relative observation score, not a return forecast or a probability.
    const turnover = 40 * percentile(activity, a.recentKrw);
    const depthProxy = 15 * percentile(liquidity, Number(m.ticker.acc_trade_price_24h) || 0);
    const growth = a.growthRatio === null ? 0 : 25 * clamp((a.growthRatio - .5) / 2.5, 0, 1);
    const trend = a.recentKrw > 0 ? 20 * clamp(a.returnPct / 1, 0, 1) : 0;
    const penalty = (Math.abs(a.returnPct) > 3 ? 15 : 0) + (Math.abs(m.ticker.signed_change_rate || 0) > .2 ? 15 : 0) + (caution ? 15 : 0);
    const score = a.recentKrw > 0 ? Math.round(clamp(turnover + depthProxy + growth + trend - penalty, 0, 100)) : 0;
    return {...m, watchScore:score, watchReason: (caution ? '거래 주의 감점 · ' : '') + (penalty ? '급변·주의 항목 감점 적용' : '최근 거래대금·증가세·가격 흐름 반영')};
  });
}
export function sortMarketRows(rows, mode) {
  const metric = m => mode === 'value' ? m.watchScore : mode === 'recent' ? (m.activity?.ready ? m.activity.recentKrw : null) : mode === 'change' ? (m.ticker?.signed_change_rate ?? null) : (m.ticker?.acc_trade_price_24h ?? null);
  return [...rows].sort((a,b) => {
    const x=metric(a), y=metric(b);
    if (x === null && y !== null) return 1;
    if (x !== null && y === null) return -1;
    return (y ?? 0) - (x ?? 0) || a.market.localeCompare(b.market);
  });
}
