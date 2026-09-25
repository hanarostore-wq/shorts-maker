import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {features,MarketFeed} from './core/market.mjs';
import {categories} from './core/evidence.mjs';
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const numbers=x=>Object.fromEntries(Object.entries(x||{}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||v===null));
const json=JSON.stringify;
// Explicitly admit public observations, never account objects or credentials.
export function marketSample(feed,at=Date.now()){
 const f=features(feed,at);if(!f)return null;
 const trades=feed.trades.filter(t=>t.trade_timestamp>=at-60000&&t.trade_timestamp<=at);
 return {schema:1,market:feed.symbol,at,features:{...numbers(f),fastFlow:f.fastFlow?.map(numbers),strategy:numbers(f.strategy)},
 book:(feed.book.orderbook_units||[]).slice(0,5).map(numbers),
 flow:{volume60s:trades.reduce((n,t)=>n+t.trade_volume,0),funds60s:trades.reduce((n,t)=>n+t.trade_price*t.trade_volume,0),high60s:trades.length?Math.max(...trades.map(t=>t.trade_price)):null,low60s:trades.length?Math.min(...trades.map(t=>t.trade_price)):null},fresh:f.bookAgeMs<=3000};
}
export function tradeContext(e,{automatic=false,reason='수동 주문',cause,at=Date.now()}={}){
 const action=e.action||{},d=e.decision;const rows=automatic?(action.evidence||[]):[];
 return {schema:1,at,policyRevision:e.policy?.revision??null,cause:cause||(automatic?'jev':'manual'),reason:String(reason).slice(0,600),
 decisionId:automatic&&d?.id?hash(d.id):null,model:automatic?d?.model||null:null,stateAsOf:automatic?d?.stateAsOf||null:null,
 decision:automatic?{side:action.side||'hold',score:number(action.score)}:null,
 evidence:rows.map(r=>({id:r.id,version:r.version||1,category:r.category,staff:categories[r.category],text:r.text,status:r.status,support:number(r.support),unknown:number(r.unknown)})),
 limits:numbers(e.config),risk:numbers(e.ledger()?.riskState),investment:automatic?numbers({amount:e.investment?.amount,ratioPct:e.investment?.ratioPct,targetPct:e.investment?.targetPct,quality:e.investment?.quality}):null,judgmentMarket:automatic&&d?e.decisionInput||null:null,market:marketSample(e.feed,at)};
}
export class TradingAnalytics {
 constructor(dir,{preSeconds=60,postSeconds=60,sampleMs=1000,maxBytes=512*1024*1024,clock=Date.now,feedFactory=()=>new MarketFeed()}={}){
  this.feedFactory=feedFactory;this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.clock=clock;this.pre=preSeconds*1000;this.post=postSeconds*1000;this.step=sampleMs;this.maxBytes=maxBytes;
  this.rings=new Map();this.tails=new Map();this.seen=new Set();this.workers={};this.error=null;this.busy=false;this.lastSample=null;this.lastAnalysis=null;
  this.db=new DatabaseSync(path.join(dir,'analytics.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
  if(this.db.prepare('PRAGMA user_version').get().user_version>1)throw Error('지원하지 않는 매매분석 DB 버전');
  this.db.exec(`CREATE TABLE IF NOT EXISTS fills(id TEXT PRIMARY KEY, ledger TEXT NOT NULL, mode TEXT NOT NULL, market TEXT NOT NULL, at INTEGER NOT NULL, side TEXT NOT NULL, quantity TEXT NOT NULL, funds TEXT NOT NULL, fee TEXT NOT NULL, realized TEXT NOT NULL, cause TEXT NOT NULL, reason TEXT NOT NULL, context TEXT NOT NULL, episode TEXT NOT NULL, window_start INTEGER NOT NULL, window_end INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS fills_period ON fills(at,mode,market); CREATE INDEX IF NOT EXISTS fills_episode ON fills(episode);
 CREATE TABLE IF NOT EXISTS evidence(fill_id TEXT, staff TEXT, rule_id TEXT, version INTEGER, status TEXT, PRIMARY KEY(fill_id,rule_id));
 CREATE INDEX IF NOT EXISTS evidence_lookup ON evidence(staff,rule_id,version,fill_id);
 CREATE TABLE IF NOT EXISTS samples(market TEXT, at INTEGER, fresh INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(market,at));
 CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,ledger TEXT NOT NULL,mode TEXT NOT NULL,market TEXT NOT NULL,opened INTEGER NOT NULL,closed INTEGER,quantity REAL NOT NULL,buy_funds REAL NOT NULL,buy_fees REAL NOT NULL,sell_funds REAL NOT NULL,sell_fees REAL NOT NULL,realized REAL NOT NULL,complete_basis INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS episodes_query ON episodes(opened,mode,market,closed);
 CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,at INTEGER,query TEXT,result TEXT);
 PRAGMA user_version=1;`);
  this.lastSample=this.db.prepare('SELECT MAX(at) at FROM samples').get().at;this.lastAnalysis=this.db.prepare('SELECT MAX(at) at FROM reports').get().at;
 }
 safe(fn){try{return fn();}catch{this.error='매매분석 저장/조회 실패: 저장 공간·파일 권한을 확인하세요. 매매 장부는 별도로 보존됩니다.';return null;}}
 attach(workers){this.workers=workers;for(const w of Object.values(workers)){w.engine.analytics=this;this.sync(w.engine);w.feed.onBeforeSelect=symbol=>this.safe(()=>this.retain(w.feed,symbol));}this.timer=setInterval(()=>this.safe(()=>this.sample()),this.step);this.timer.unref?.();}
 retain(feed,next){if(next===feed.symbol)return;const end=this.db.prepare('SELECT MAX(window_end) n FROM fills WHERE market=?').get(feed.symbol).n;if(!end||end<this.clock())return;
 if(this.tails.has(feed.symbol)){this.tails.get(feed.symbol).end=Math.max(end,this.tails.get(feed.symbol).end);return;}const tail=this.feedFactory();for(const k of ['symbol','book','bookHistory','trades','candles','signalCandles','clockOffsetMs','clockVerified'])tail[k]=structuredClone(feed[k]);tail.markets=[{market:feed.symbol}];tail.connect(tail.generation);this.tails.set(feed.symbol,{feed:tail,end});}
 sample(at=this.clock()){const feeds=new Map();for(const w of Object.values(this.workers))if(w.feed.book)feeds.set(w.feed.symbol,w.feed);for(const [symbol,t] of this.tails){if(at>t.end){t.feed.stop();this.tails.delete(symbol);}else if(!feeds.has(symbol))feeds.set(symbol,t.feed);}for(const feed of feeds.values()){const s=marketSample(feed,at);if(s)this.observe(s);}}
 observe(s){this.lastObserved=s.at;this.observedFresh=s.fresh;const at=Math.floor(s.at/this.step)*this.step,rows=(this.rings.get(s.market)||[]).filter(x=>x.at>=at-this.pre);if(rows.at(-1)?.at!==at)rows.push({...s,at});this.rings.set(s.market,rows);for(const [m,r] of this.rings)if(r.at(-1)?.at<at-this.pre-this.post)this.rings.delete(m);
 if(this.db.prepare('SELECT 1 FROM fills WHERE market=? AND window_start<=? AND window_end>=? LIMIT 1').get(s.market,at,at))this.storeSample({...s,at});}
 storeSample(s){if(this.bytes()>this.maxBytes)throw Error('분석 저장 용량 한도');this.db.prepare('INSERT OR IGNORE INTO samples VALUES(?,?,?,?)').run(s.market,s.at,s.fresh?1:0,gzipSync(json(s)));this.lastSample=Math.max(this.lastSample||0,s.at);}
 bytes(){return this.db.prepare('PRAGMA page_count').get().page_count*this.db.prepare('PRAGMA page_size').get().page_size;}
 sync(e){return this.safe(()=>{this.busy=true;try{for(const l of [e.paper,e.live,...(e.archives||[])].filter(Boolean)){const key=hash(l.id);for(const row of l.history||[]){const id=hash(key+':'+row.id);if(this.seen.has(id))continue;this.ingest(l,row,id,key);this.seen.add(id);}}}finally{this.busy=false;}});}
 ingest(l,row,id=hash(hash(l.id)+':'+row.id),ledger=hash(l.id)){
 if(this.db.prepare('SELECT 1 FROM fills WHERE id=?').get(id))return;
 const context=row.analytics||{schema:1,at:row.at,cause:'legacy_unknown',reason:'도입 이전 기록 · 당시 근거/시장 데이터 없음',evidence:[]};
 const at=row.at,market=row.market,mode=row.mode==='live'?'live':'paper';this.db.exec('BEGIN IMMEDIATE');try{
 let ep=this.db.prepare('SELECT * FROM episodes WHERE ledger=? AND market=? AND closed IS NULL ORDER BY opened DESC LIMIT 1').get(ledger,market);
 if(!ep)ep={id:hash(ledger+':'+row.id),ledger,mode,market,opened:at,closed:null,quantity:0,buy_funds:0,buy_fees:0,sell_funds:0,sell_fees:0,realized:0,complete_basis:row.side==='buy'?1:0};
 const q=Number(row.quantity),funds=Number(row.funds),fee=Number(row.fee);if(row.side==='buy'){ep.quantity+=q;ep.buy_funds+=funds;ep.buy_fees+=fee;}else{ep.quantity-=q;ep.sell_funds+=funds;ep.sell_fees+=fee;ep.realized+=Number(row.realized);if(row.remainingQuantity!==undefined?Number(row.remainingQuantity)===0:Math.round(ep.quantity*1e8)<=0){ep.quantity=0;ep.closed=at;}}
 this.db.prepare('INSERT OR REPLACE INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...['id','ledger','mode','market','opened','closed','quantity','buy_funds','buy_fees','sell_funds','sell_fees','realized','complete_basis'].map(k=>ep[k]));
 this.db.prepare('INSERT INTO fills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,ledger,mode,market,at,row.side,String(row.quantity),String(row.funds),String(row.fee),String(row.realized),context.cause||'system',context.reason||row.reason||'',json(context),ep.id,at-this.pre,at+this.post);
 for(const r of context.evidence||[])this.db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?)').run(id,r.staff||categories[r.category]||'미확인',r.id,r.version||1,r.status||'unknown');this.db.exec('COMMIT');
 }catch(err){this.db.exec('ROLLBACK');throw err;}
 for(const s of this.rings.get(market)||[])if(s.at>=Math.floor((at-this.pre)/this.step)*this.step&&s.at<=at+this.post)this.storeSample(s);if(context.market)this.storeSample({...context.market,at:Math.floor(at/this.step)*this.step});
 }
 query(input={}){
 const now=this.clock(),n=(k,def)=>input[k]===undefined||input[k]===''?def:Number(input[k]);const from=n('from',now-7*86400000),to=n('to',now),limit=n('limit',100),offset=n('offset',0);
 if(![from,to,limit,offset].every(Number.isFinite)||from>to||limit<1||limit>500||!Number.isInteger(limit)||!Number.isInteger(offset)||offset<0)throw Error('분석 조회 조건 오류: 기간과 1~500건 범위를 확인하세요.');
 const clauses=['e.opened<=?','COALESCE(e.closed,?)>=?'],args=[to,now,from];
 if(input.mode){if(!['paper','live'].includes(input.mode))throw Error('분석 모드 오류');clauses.push('e.mode=?');args.push(input.mode);}if(input.market){if(!/^KRW-[A-Z0-9]{1,20}$/.test(input.market))throw Error('분석 종목 형식 오류');clauses.push('e.market=?');args.push(input.market);}
 if(input.outcome){if(!['profit','loss','closed','open'].includes(input.outcome))throw Error('손익 필터 오류');clauses.push(input.outcome==='open'?'e.closed IS NULL':'e.closed IS NOT NULL');if(['profit','loss'].includes(input.outcome))clauses.push('e.realized'+(input.outcome==='profit'?'>0':'<0'));}
 const roi='(100.0*e.realized/NULLIF(e.buy_funds+e.buy_fees,0))';for(const [k,op]of [['minReturn','>='],['maxReturn','<=']])if(input[k]!==undefined&&input[k]!==''){const v=Number(input[k]);if(!Number.isFinite(v))throw Error('수익률 필터 오류');clauses.push(roi+op+'?');args.push(v);}
 const filters=[],fa=[];for(const [k,col]of [['staff','v.staff'],['rule','v.rule_id'],['version','v.version']])if(input[k]){filters.push(col+'=?');fa.push(k==='version'?Number(input[k]):String(input[k]));}if(filters.length){clauses.push('EXISTS(SELECT 1 FROM fills f JOIN evidence v ON v.fill_id=f.id WHERE f.episode=e.id AND '+filters.join(' AND ')+')');args.push(...fa);}
 for(const [k,side]of [['buyReason','buy'],['sellReason','sell']])if(input[k]){clauses.push('EXISTS(SELECT 1 FROM fills f WHERE f.episode=e.id AND f.side=? AND instr(f.reason,?)>0)');args.push(side,String(input[k]));}if(input.cause){clauses.push('EXISTS(SELECT 1 FROM fills f WHERE f.episode=e.id AND f.cause=?)');args.push(String(input.cause));}
 const where=clauses.join(' AND '),total=this.db.prepare('SELECT COUNT(*) n FROM episodes e WHERE '+where).get(...args).n;
 const rows=this.db.prepare('SELECT e.*, '+roi+' return_pct, COALESCE(e.closed,?)-e.opened held_ms FROM episodes e WHERE '+where+' ORDER BY e.opened DESC LIMIT ? OFFSET ?').all(now,...args,limit,offset);
 return {schema:1,from,to,total,limit,offset,rows:rows.map(({ledger,...r})=>{const v=this.db.prepare("SELECT SUM(CASE WHEN side='buy' THEN CAST(quantity AS REAL) ELSE 0 END) buy_quantity,SUM(CASE WHEN side='sell' THEN CAST(quantity AS REAL) ELSE 0 END) sell_quantity FROM fills WHERE episode=?").get(r.id);return {...r,...v,buy_price:v.buy_quantity?r.buy_funds/v.buy_quantity:null,sell_price:v.sell_quantity?r.sell_funds/v.sell_quantity:null};}),note:'근거 연관성은 수익의 인과관계 증명이 아닙니다. 과거 기록은 근거·시장 자료가 없을 수 있습니다.'};
 }
 detail(id){if(!/^[a-f0-9]{64}$/.test(id))throw Error('거래 ID 형식 오류');const rows=this.db.prepare('SELECT * FROM fills WHERE episode=? ORDER BY at,id').all(id);if(!rows.length)throw Error('분석 거래를 찾을 수 없습니다.');if(rows.length>100)throw Error('한 거래의 체결이 100건을 넘습니다. 로컬 분석 저장소에서 체결별로 조회하세요.');
 const unique=new Map();const fills=rows.map(({ledger,context,...r})=>{const data=this.db.prepare('SELECT payload FROM samples WHERE market=? AND at BETWEEN ? AND ? ORDER BY at').all(r.market,Math.floor(r.window_start/this.step)*this.step,r.window_end).map(x=>JSON.parse(gunzipSync(x.payload)));for(const s of data)unique.set(s.market+':'+s.at,s);const expected=Math.floor((this.pre+this.post)/this.step)+1;return {...r,price:Number(r.funds)/Number(r.quantity),context:JSON.parse(context),window:{expected,count:data.length,fresh:data.filter(s=>s.fresh).length,pending:this.clock()<r.window_end,status:this.clock()<r.window_end?'수집 중':data.length>=expected&&data.every(s=>s.fresh)?'완료':'일부 누락 또는 시세 지연',sampleKeys:data.map(s=>s.market+':'+s.at)}};});const result={schema:1,id,fills,samples:[...unique.values()]};if(Buffer.byteLength(json(result))>3000000)throw Error("거래 상세가 3MB를 넘습니다. 로컬 분석 저장소에서 체결별로 조회하세요.");return result;}
 report(input={}){this.busy=true;try{const q=this.query({...input,limit:500,offset:0});if(q.total>500)throw Error('분석 대상이 500건을 넘습니다. 기간/종목을 좁혀주세요.');const closed=q.rows.filter(r=>r.closed!==null),byEvidence=new Map(),byCause=new Map();for(const r of closed){for(const k of this.db.prepare('SELECT DISTINCT v.staff,v.rule_id,v.version FROM evidence v JOIN fills f ON f.id=v.fill_id WHERE f.episode=?').all(r.id)){const key=k.staff+'/'+k.rule_id+' v'+k.version,v=byEvidence.get(key)||{key,trades:0,losses:0,pnl:0};v.trades++;v.losses+=r.realized<0?1:0;v.pnl+=r.realized;byEvidence.set(key,v);}for(const x of this.db.prepare("SELECT DISTINCT cause FROM fills WHERE episode=? AND side='sell'").all(r.id))byCause.set(x.cause,(byCause.get(x.cause)||0)+1);}
 const pnl=closed.reduce((n,r)=>n+r.realized,0),result={id:randomUUID(),at:this.clock(),count:closed.length,wins:closed.filter(r=>r.realized>0).length,losses:closed.filter(r=>r.realized<0).length,realized:pnl,average:closed.length?pnl/closed.length:null,byEvidence:[...byEvidence.values()],byCause:[...byCause].map(([cause,trades])=>({cause,trades})),caution:'거래 손익을 연관 근거별로 표시하므로 근거별 합산은 중복됩니다. 인과 기여도·수익 보장이 아닙니다. 자동 근거 수정 없음.'};this.db.prepare('INSERT INTO reports VALUES(?,?,?,?)').run(result.id,result.at,json(input),json(result));this.lastAnalysis=result.at;return result;}finally{this.busy=false;}}
 summary(mode){if(!['paper','live'].includes(mode))throw Error('모드 오류');const r=this.db.prepare('SELECT COALESCE(SUM(CASE WHEN realized>0 THEN realized ELSE 0 END),0) profit, COALESCE(SUM(CASE WHEN realized<0 THEN -realized ELSE 0 END),0) loss, COALESCE(SUM(realized),0) net, COALESCE(SUM(buy_fees+sell_fees),0) fees FROM episodes WHERE mode=? AND closed IS NOT NULL').get(mode);return {...r,mode,basis:'완료 거래 · 수수료 차감 후 이익/손실. 비용은 포함된 수수료를 별도 표시하며 중복 차감하지 않음. API 비용 제외(원화 청구 자료 미연결).'};}
 status(){const pending=this.db.prepare('SELECT COUNT(*) n FROM fills WHERE window_end>? AND cause<>?').get(this.clock(),'legacy_unknown').n;return {schema:1,state:this.busy||pending?'업무중':'대기중',task:pending?'거래 전후 시장 자료 수집':'',collection:this.error||(pending&&this.observedFresh===false)?'이상':this.lastSample?'정상':'대기',error:this.error,total:this.db.prepare('SELECT COUNT(*) n FROM episodes').get().n,fills:this.db.prepare('SELECT COUNT(*) n FROM fills').get().n,lastData:this.lastSample,lastAnalysis:this.lastAnalysis,bytes:this.bytes(),maxBytes:this.maxBytes,pending};}
 close(){clearInterval(this.timer);for(const t of this.tails.values())t.feed.stop();this.db.close();}
}
