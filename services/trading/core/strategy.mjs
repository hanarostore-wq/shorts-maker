// Experimental research scores, never calibrated probabilities or permission to order.
const finite = Number.isFinite;
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const emaSeries = (xs, n) => { let v = xs[0]; return xs.map(x => (v += (x - v) * 2 / (n + 1))); };
const weighted = items => {
  const valid = items.filter(([v]) => finite(v));
  return valid.length ? valid.reduce((s, [v, w]) => s + clamp(v) * w, 0) / valid.reduce((s, [, w]) => s + w, 0) : null;
};
export function strategySignals(feed, f, now = Date.now()) {
  const exchangeNow = now - (feed.clockOffsetMs || 0);
  const candles = (feed.signalCandles || feed.candles || []).filter(c =>
    finite(c.time) && c.time + 60000 <= exchangeNow &&
    ['open','high','low','close','volume'].every(k => finite(c[k])) && c.low > 0 && c.high >= c.low && c.volume >= 0);
  const recent = candles.slice(-60), closes = recent.map(c => c.close);
  if (closes.length < 35) return {ready:false, reason:'완성된 1분 봉 35개 준비 중', closedCandles:closes.length};
  if (exchangeNow-recent.at(-1).time>120000) return {ready:false, reason:'최근 완성된 1분 봉 수신 대기'};
  const last = recent.at(-1), previous = recent.slice(0,-1), priorHigh = Math.max(...previous.slice(-20).map(c=>c.high));
  const e9=emaSeries(closes,9).at(-1), e21=emaSeries(closes,21).at(-1);
  const fast=emaSeries(closes,12), slow=emaSeries(closes,26), macd=fast.map((v,i)=>v-slow[i]), signal=emaSeries(macd,9);
  const histogram=macd.at(-1)-signal.at(-1), oldHistogram=macd.at(-2)-signal.at(-2);
  const ranges=recent.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-recent[i].close),Math.abs(c.low-recent[i].close)));
  const atr=avg(ranges.slice(-14)), center=avg(closes.slice(-20));
  const sd=Math.sqrt(avg(closes.slice(-20).map(x=>(x-center)**2)));
  const changes=closes.slice(-15).slice(1).map((x,i)=>x-closes.slice(-15)[i]);
  const gains=changes.reduce((s,x)=>s+Math.max(x,0),0),losses=changes.reduce((s,x)=>s+Math.max(-x,0),0);
  const rsi=gains+losses?100*gains/(gains+losses):50;
  const recentTrades=(feed.trades||[]).filter(t=>t.trade_timestamp<=now && t.trade_timestamp>now-60000);
  const amounts=recentTrades.map(t=>t.trade_price*t.trade_volume);
  const turnover=amounts.reduce((a,b)=>a+b,0), previousTurnover=avg(previous.slice(-20).map(c=>c.close*c.volume));
  const lastClosedTurnover=last.close*last.volume;
  const growth=previousTurnover>0?lastClosedTurnover/previousTurnover:null;
  const fastTrades=recentTrades.filter(t=>t.trade_timestamp>now-5000);
  const olderTrades=recentTrades.filter(t=>t.trade_timestamp<=now-5000&&t.trade_timestamp>now-10000);
  const ret=ts=>ts.length>=2?(ts.at(-1).trade_price/ts[0].trade_price-1)*10000:null;
  const fastReturn=ret(fastTrades), olderReturn=ret(olderTrades);
  const share=ts=>{const all=ts.reduce((s,t)=>s+t.trade_price*t.trade_volume,0);return all?ts.filter(t=>t.ask_bid==='BID').reduce((s,t)=>s+t.trade_price*t.trade_volume,0)/all:null;};
  const fastBuy=share(fastTrades), priorBuy=share(olderTrades);
  const book=feed.book.orderbook_units.slice(0,10), old=feed.bookHistory?.findLast(x=>x.at<=now-5000&&x.at>=now-15000);
  const depth=side=>book.reduce((s,x)=>s+x[side+'_price']*x[side+'_size'],0);
  const bidDepth=depth('bid'),askDepth=depth('ask');
  const depthChange=(v,b)=>b>0?(v/b-1):null;
  const wick=(last.high-Math.max(last.open,last.close))/Math.max(last.high-last.low,1e-12);
  const highFailure=last.high>=priorHigh&&last.close<priorHigh;
  const breakout=f.mid>priorHigh, pullback=last.high>=priorHigh&&f.mid>=e9&&f.mid>=priorHigh-atr;
  const trend=weighted([[f.mid>=e9?1:0,1],[e9>=e21?1:0,1],[histogram>oldHistogram?1:0,1],[f.vwap60s?f.mid>=f.vwap60s?1:0:null,1]]);
  const flow=weighted([[f.buyVolumeShare,1],[fastBuy,1],[finite(f.imbalance)?(f.imbalance+1)/2:null,1]]);
  const impulse=weighted([[finite(fastReturn)?0.5+fastReturn/40:null,1],[finite(growth)?growth/3:null,1],[breakout?1:pullback?0.7:0.3,1]]);
  const weakness=weighted([[finite(fastBuy)?1-fastBuy:null,2],[finite(f.imbalance)?(1-f.imbalance)/2:null,1],[1-trend,2],[highFailure?1:0,1],[wick,1],[finite(fastReturn)?0.5-fastReturn/40:null,1]]);
  const regime=atr/f.mid>0.008?'volatile':Math.abs(e9/e21-1)>0.001?'trend':'range';
  const weights=regime==='trend'?[0.35,0.35,0.30]:regime==='volatile'?[0.2,0.5,0.3]:[0.25,0.45,0.30];
  const entryScore=weighted([[trend,weights[0]],[flow,weights[1]],[impulse,weights[2]]]);
  return {ready:true,asOf:now,closedCandles:closes.length,regime,entryScore,weakness,groups:{trend,flow,impulse},
    atr,atrPct:atr/f.mid*100,ema9:e9,ema21:e21,macdHistogram:histogram,macdChange:histogram-oldHistogram,
    bandWidthPct:4*sd/center*100,bandUpper:center+2*sd,bandLower:center-2*sd,rsi14:rsi,vwap60s:f.vwap60s,turnover60s:turnover,
    volumeGrowth:avg(previous.slice(-20).map(c=>c.volume))>0?last.volume/avg(previous.slice(-20).map(c=>c.volume)):null,
    turnoverGrowth:growth,fastBuyShare:fastBuy,flowChange:finite(fastBuy)&&finite(priorBuy)?fastBuy-priorBuy:null,
    priceAccelerationBps:finite(fastReturn)&&finite(olderReturn)?fastReturn-olderReturn:null,fastReturnBps:fastReturn,
    bidDepthChange:depthChange(bidDepth,old?.bidDepth),askDepthChange:depthChange(askDepth,old?.askDepth),
    bidWallShare:bidDepth?Math.max(...book.map(x=>x.bid_price*x.bid_size))/bidDepth:null,
    askWallShare:askDepth?Math.max(...book.map(x=>x.ask_price*x.ask_size))/askDepth:null,
    priorHigh,breakout,pullback,highFailure,upperWick:wick,
    limitations:['보이는 호가 잔량은 실제 체결 약속이 아님','지표 점수는 검증 전 연구 점수이며 승률 아님']};
}
export function strategyDecision(answers, f, l, cfg) {
  const s=f.strategy, holding=Number(l.quantity)>0;
  if(!s?.ready) return {side:'hold',state:holding?'HOLD':'WATCH',reason:s?.reason||'1분 전략 자료 준비 중'};
  const ai=answers?.direction?.probabilities;
  if(holding){
    const score=weighted([[s.weakness,0.65],[ai?.down,0.25],[answers?.inventory_pressure?.score/3,0.1]]);
    if(score>=cfg.weaknessExitScore) return {side:'sell',state:'EXIT',score,reason:'매수세·가격 흐름의 종합 약화로 청산'};
    return {side:'hold',state:score>=cfg.weaknessExitScore*0.75?'WEAKEN':'HOLD',score,reason:score>=cfg.weaknessExitScore*0.75?'상승 힘 약화 · 계속 감시':'상승 흐름 유지 · 고정 이익률에 도달해도 보유'};
  }
  if(!ai) return {side:'hold',state:'WATCH',reason:'종목과 신호 확인 완료 · Jev 판단 대기'};
  const score=weighted([[s.entryScore,0.4],[ai.up,0.6]]);
  const penalty=weighted([[answers?.toxic_flow?.noul,1],[answers?.liquidity_stressed?.noul,1]]);
  const combined=clamp(score-(penalty||0)*0.15);
  return combined>=cfg.entryScore
    ? {side:'buy',state:'ENTRY',score:combined,reason:'서로 다른 신호와 Jev 판단의 종합 진입 점수 충족'}
    : {side:'hold',state:'WATCH',score:combined,reason:'종합 진입 점수 '+(combined*100).toFixed(1)+' / 기준 '+(cfg.entryScore*100).toFixed(0)+'점'};
}
export function scanCandidates(feed, now=Date.now()) {
  const rows=(feed.markets||[]).map(m=>({market:m.market,name:m.korean_name,warning:m.market_warning,
    excluded:m.market_warning==='CAUTION'||m.market_event?.warning===true,activity:feed.activity?.snapshot(m.market,now)}))
    .filter(x=>x.activity?.fullWindow&&x.activity.ready&&now-x.activity.asOf<=5000&&!x.excluded);
  const max=Math.max(1,...rows.map(x=>x.activity.recentKrw));
  return rows.map(x=>({...x,score:100*weighted([[Math.log1p(x.activity.recentKrw)/Math.log1p(max),0.4],[finite(x.activity.growthRatio)?x.activity.growthRatio/3:null,0.35],[clamp(x.activity.returnPct/2),0.25]])}))
    .sort((a,b)=>b.score-a.score).slice(0,10);
}
