import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketFeed} from '../../services/trading/core/market.mjs';
import {MarketFeed as PreviewFeed} from '../../public/trading/core/market.mjs';
class FakeSocket extends EventTarget {
 static latest;readyState=1;sent=[];
 constructor(){super();FakeSocket.latest=this;}
 send(text){this.sent.push(JSON.parse(text));}
 close(){this.dispatchEvent(new Event('close'));}
 message(value){const e=new Event('message');e.data=JSON.stringify(value);this.dispatchEvent(e);}
}
for(const mode of ['paper','live'])test(mode+': shared scanner omits empty trade subscription and selected quote stays connected',t=>{
 const original=globalThis.WebSocket;globalThis.WebSocket=FakeSocket;t.after(()=>globalThis.WebSocket=original);
 const f=new MarketFeed();f.scanner={};f.markets=[{market:'KRW-BTC'}];t.after(()=>f.stop());f.connect(f.generation);
 const ws=FakeSocket.latest;ws.dispatchEvent(new Event('open'));
 const requests=ws.sent[0].filter(x=>x.type);assert.deepEqual(requests.map(x=>x.type),['ticker','orderbook']);assert.ok(requests.every(x=>x.codes.length>0));
 ws.message({type:'ticker',code:'KRW-BTC',trade_price:100});assert.equal(f.snapshot().ticker.trade_price,100);
 ws.message({type:'ticker',code:'KRW-BTC',trade_price:101});assert.equal(f.snapshot().ticker.trade_price,101);
 ws.message({type:'orderbook',code:'KRW-BTC',timestamp:Date.now(),orderbook_units:[{ask_price:102,bid_price:101,ask_size:1,bid_size:1}]});assert.equal(f.snapshot().book.orderbook_units[0].bid_price,101);assert.equal(f.status,'실시간 연결');
});
for(const Feed of [MarketFeed,PreviewFeed])test(Feed===MarketFeed?'standalone PC feed keeps selected trades':'browser preview keeps selected trades',t=>{
 const original=globalThis.WebSocket;globalThis.WebSocket=FakeSocket;t.after(()=>globalThis.WebSocket=original);
 const f=new Feed();f.markets=[{market:'KRW-BTC'}];t.after(()=>f.stop());f.connect(f.generation);const ws=FakeSocket.latest;ws.dispatchEvent(new Event('open'));
 assert.deepEqual(ws.sent[0].find(x=>x.type==='trade').codes,['KRW-BTC']);
});
