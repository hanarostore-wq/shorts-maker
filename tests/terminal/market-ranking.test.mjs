import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketActivity} from '../../public/trading/core/market-activity.mjs';
import {rankMarkets,sortMarketRows} from '../../public/trading/market-ranking.js';
import {parseMoney,groupedMoneyInput,moneyLabel,koreanMoney} from '../../public/trading/money-format.js';
const tick=(at,total=1000,day='20260924')=>({market:'KRW-A',timestamp:at,trade_date:day,acc_trade_price:total,trade_price:100});
test('rolling current and previous minutes use cumulative deltas without duplicate volume',()=>{
const a=new MarketActivity(); for(let i=0;i<=120;i++)a.observe(tick(i*1000,1000+i*100),i*1000);
a.observe(tick(120000,13000),120000); a.observe(tick(100000,999999),120000);
const s=a.snapshot('KRW-A',120000); assert.equal(s.recentKrw,6000);assert.equal(s.previousKrw,6000);assert.equal(s.growthRatio,1);assert.equal(s.fullWindow,true);
});
test('warmup, stale feed and UTC counter reset are not presented as measured full windows',()=>{
const a=new MarketActivity();a.observe(tick(1000),1000);assert.equal(a.snapshot('KRW-A',2000).ready,false);assert.equal(a.snapshot('KRW-A',70000).ready,false);
a.observe(tick(71000,1,'20260925'),71000);assert.equal(a.snapshot('KRW-A',71000).fullWindow,false);
});
test('ranking keeps unavailable and warning coins below measured candidates without changing input',()=>{
const ready={ready:true,fullWindow:true,recentKrw:100000,previousKrw:50000,growthRatio:2,returnPct:.5};
const rows=[{market:'KRW-A',ticker:{acc_trade_price_24h:10000000,signed_change_rate:.03},activity:ready},{market:'KRW-B',ticker:{acc_trade_price_24h:999999999},activity:ready,market_event:{warning:true}},{market:'KRW-C',ticker:null}];
const r=sortMarketRows(rankMarkets(rows),'value');assert.equal(r[0].market,'KRW-A');assert.ok(r[0].watchScore>=0&&r[0].watchScore<=100);assert.equal(r[1].watchScore,null);assert.equal(rows[0].watchScore,undefined);
});
test('recent activity sorting compares KRW turnover instead of coin units',()=>{
const r=sortMarketRows([{market:'A',activity:{ready:true,recentKrw:100},ticker:{acc_trade_volume_24h:1e9}},{market:'B',activity:{ready:true,recentKrw:1000},ticker:{acc_trade_volume_24h:1}},{market:'C',activity:{ready:false}}],'recent');assert.deepEqual(r.map(x=>x.market),['B','A','C']);
});
test('formatted inputs preserve order amounts and reject invalid financial input',()=>{
for(const n of [10000,50000,100000,500000,1000000,3000000,1000000000])assert.equal(parseMoney(groupedMoneyInput(n)),n);
for(const n of ['', '1e6','-10000','NaN','10,00','999999999999999999999'])assert.ok(Number.isNaN(parseMoney(n)));
assert.equal(groupedMoneyInput('0001234567'),'1,234,567');
});
test('Korean money uses the same amount as comma notation including full turnover',()=>{
assert.equal(moneyLabel(3000000,0),'3,000,000원 (3백만원)');assert.equal(moneyLabel(68001000000,0),'68,001,000,000원 (680억 1백만원)');assert.equal(koreanMoney(0),'0원');assert.equal(moneyLabel(-12345,0),'-12,345원 (-1만 2천3백45원)');
});
