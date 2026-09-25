import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, validateConfig, newLedger, riskCheck, decide} from '../../services/trading/core/core.mjs';
import {safetySignal} from '../../services/trading/core/safety.mjs';
import {manualBuyingPower} from '../../services/trading/core/tracking.mjs';
import {investmentPlan,defaultPolicy} from '../../services/trading/core/evidence.mjs';
import {Engine} from '../../services/trading/core/engine.mjs';
import * as previewCore from '../../public/trading/core/core.mjs';
import {manualBuyingPower as previewBuyingPower} from '../../public/trading/core/tracking.mjs';

test('new defaults are unlimited; explicit existing values survive; large amounts and zero round trip',()=>{
 assert.equal(defaults.maxPositionKrw,0);assert.equal(defaults.dailyLossKrw,0);
 for(const n of [0,10000000,100000000]){const c=validateConfig({maxPositionKrw:n,dailyLossKrw:n});assert.equal(validateConfig(JSON.parse(JSON.stringify(c))).dailyLossKrw,n);}
 const old=validateConfig({maxPositionKrw:50000,dailyLossKrw:10000});assert.equal(old.maxPositionKrw,50000);assert.equal(old.dailyLossKrw,10000);
 for(const n of [-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'0',null]) for(const k of ['dailyLossKrw','maxPositionKrw'])assert.throws(()=>validateConfig({[k]:n}));
 assert.throws(()=>validateConfig({dailyLossKrw:99}));assert.throws(()=>validateConfig({maxPositionKrw:4999}));
});
test('browser preview has the same optional defaults, validation and spendable amount',()=>{
 assert.deepEqual(previewCore.defaults,defaults);
 const config=validateConfig({dailyLossKrw:10000000,maxPositionKrw:0});
 assert.deepEqual(previewCore.validateConfig(config),config);
 const l=newLedger(1000000,'KRW-A'),book={timestamp:Date.now(),orderbook_units:[{ask_price:10000,bid_price:9999,ask_size:100,bid_size:100}]};
 assert.equal(previewBuyingPower(l,config,book),manualBuyingPower(l,config,book));
 assert.doesNotThrow(()=>previewCore.riskCheck({ledger:l,book,config,side:'buy',amount:10000}));
});
for(const mode of ['paper','live']) test(mode+': zero caps do not block buys, but cash and other risk checks still apply',()=>{
 const now=Date.now(),l=newLedger(1000000,'KRW-A',mode);l.day=new Date(now+9*3600000).toISOString().slice(0,10);l.cash='985000';
 const book={timestamp:now,orderbook_units:[{ask_price:10000,bid_price:9999,ask_size:100,bid_size:100}]};
 const c={...defaults,orderKrw:100000,maxDrawdownPct:20};
 assert.doesNotThrow(()=>riskCheck({ledger:l,book,config:c,side:'buy',amount:100000,now}));
 assert.throws(()=>riskCheck({ledger:l,book,config:{...c,dailyLossKrw:10000},side:'buy',amount:100000,now}),/손실 한도/);
 assert.throws(()=>riskCheck({ledger:l,book,config:{...c,maxPositionKrw:50000},side:'buy',amount:100000,now}),/최대 보유/);
 assert.throws(()=>riskCheck({ledger:l,book,config:{...c,maxDrawdownPct:1},side:'buy',amount:100000,now}),/손실 한도/);
 assert.throws(()=>riskCheck({ledger:l,book,config:{...c,orderKrw:2000000},side:'buy',amount:2000000,now}),/잔액 부족/);
 const chance=mode==='live'?{bid_fee:'.0005',bid_account:{balance:'800000'}}:null;
 assert.equal(manualBuyingPower(l,c,book,chance),Math.floor((mode==='live'?800000:985000)/1.0005));
 l.quantity='1';l.cost='10000';l.openedAt=now;
 assert.equal(safetySignal(l,{bid:9999},{...c,strategyEnabled:0},now),null);
 assert.equal(decide(null,{bid:9999},l,{...c,strategyEnabled:0},now).side,'hold');
 assert.equal(safetySignal(l,{bid:9800},{...c,strategyEnabled:0},now),'절대 손실 한도 도달');
});
test('automatic sizing does not treat unlimited as zero money or infinite order',()=>{
 const p=defaultPolicy(),l=newLedger(1000000,'KRW-A');l.cash='985000';
 const a={side:'buy',score:1,evidence:[{category:'sizing',status:'supported',support:1}]};
 const c={...defaults,maxDrawdownPct:20},f={bid:10000,visibleAskKrw:100000000};
 const enabled=investmentPlan(p,a,l,f,{...c,dailyLossKrw:10000});assert.equal(enabled.amount,0);
 const unlimited=investmentPlan(p,a,l,f,c);assert.ok(unlimited.amount>50000);assert.ok(Number.isFinite(unlimited.amount));assert.ok(unlimited.amount<Number(l.cash));
});
for(const mode of ['paper','live']) test(mode+': configure/save/reload retains unlimited and explicit amounts',t=>{
 let data=null;const store={load:()=>data,save:v=>data=structuredClone(v),log:()=>{}};
 const feed={symbol:'KRW-A'};const e=new Engine(feed,store);clearInterval(e.timer);t.after(()=>clearInterval(e.timer));e.mode=mode;
 e.configure({maxPositionKrw:10000000,dailyLossKrw:10000000});assert.equal(data.config.dailyLossKrw,10000000);
 e.configure({maxPositionKrw:0,dailyLossKrw:0});
 const restored=new Engine(feed,store);clearInterval(restored.timer);assert.equal(restored.config.maxPositionKrw,0);assert.equal(restored.config.dailyLossKrw,0);
 e.startRequested=true;assert.throws(()=>e.configure({dailyLossKrw:10000}),/정지/);
});
