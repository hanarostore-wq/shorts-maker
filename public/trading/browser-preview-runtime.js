import {Engine} from './core/engine.mjs';
import {MarketFeed} from './core/market.mjs';
import {workspaceMode} from './workspace.js';
const storageKey='moneyos:web-upbit:paper:v1';
let engine,feed,listener,locked=false,bootPromise,liveAccount=null,lastLive=0;
class Store {
 load(){if(workspaceMode==='live')return null;const s=localStorage.getItem(storageKey);if(!s)return null;const x=JSON.parse(s);if(x.version!==1)throw Error('저장된 모의계좌 형식을 확인하세요. 기존 기록은 삭제하지 않았습니다.');return x;}
 save(x){if(workspaceMode==='paper')localStorage.setItem(storageKey,JSON.stringify({...x,live:null,accountHash:null}));}
 log(x){const key=storageKey+':decisions';const rows=JSON.parse(localStorage.getItem(key)||'[]');rows.push(x);localStorage.setItem(key,JSON.stringify(rows.slice(-200)));}
}
async function refreshLive(){if(workspaceMode!=='live'||Date.now()-lastLive<10000)return;lastLive=Date.now();try{const r=await fetch('/api/coin/account',{cache:'no-store'});const x=await r.json();if(!r.ok||!x.ok)throw Error(x.error||'실전 잔고 조회 실패');liveAccount=x;}catch(e){engine.event('실전 잔고 조회: '+e.message);}}
function snapshot(){const s={at:Date.now(),engine:engine.snapshot(),market:feed.snapshot()};if(workspaceMode==='live'){
 s.engine.mode='live';s.engine.armed=false;s.engine.keys.upbit=!!liveAccount;s.engine.action={side:'hold',reason:'실전 승인 통합 전 조회 모드 · 주문 잠금'};
 if(liveAccount){const asset=liveAccount.portfolio.find(x=>'KRW-'+x.currency===feed.symbol);s.engine.account={id:'server-account',mode:'live',market:feed.symbol,initial:'0',cash:String(liveAccount.cash),quantity:String(asset?.quantity||0),cost:String(asset?.cost||0),fees:'0',realized:'0',history:[],pending:null,mark:{equity:liveAccount.totalValue,pnl:liveAccount.pnl,pnlPct:0,positionKrw:asset?.value||0,averagePrice:asset?.avgBuyPrice||0}};s.engine.upbitAccount={krwAvailable:liveAccount.cash,coinAvailable:asset?.quantity||0};}
 }return s;}
export function subscribe(fn){listener=fn;}
export function boot(){return bootPromise ||= new Promise((resolve,reject)=>{
 if(!navigator.locks){reject(Error('중복 주문 방지 기능을 지원하는 최신 브라우저에서 열어 주세요.'));return;}
 navigator.locks.request('moneyos-upbit-'+workspaceMode,{ifAvailable:true},async lock=>{
 if(!lock){reject(Error('다른 운영본부 탭에서 같은 매매 화면을 사용 중입니다. 먼저 그 탭을 닫아 주세요.'));return;}
 try{locked=true;feed=new MarketFeed();engine=new Engine(feed,new Store());if(workspaceMode==='live')engine.setMode('live');
 const r=await fetch('/api/coin/terminal/judgment',{cache:'no-store'});const config=await r.json();if(config.configured)engine.jevKey='server-managed';
 engine.event('웹 매매 시작 · 키는 서버 보관 · 모의계좌는 이 브라우저에 저장');
 void feed.init();void refreshLive();setInterval(()=>{void refreshLive();listener?.(snapshot());},500);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&(engine.running||engine.judgmentRunning||engine.startRequested||engine.tracker.state?.active)){engine.stop();engine.save();engine.event('브라우저가 백그라운드로 전환되어 자동매매·판단·추적을 정지했습니다.');}});
 window.addEventListener('pagehide',()=>{engine.stop();engine.save();feed.stop();});resolve(snapshot());await new Promise(()=>{});
 }catch(e){locked=false;clearInterval(engine?.timer);feed?.stop();reject(e);}
 }).catch(reject);
 });}
export async function command(name,b={}){
 if(!locked||!engine)throw Error('웹 매매 준비가 끝나지 않았습니다.');
 if(workspaceMode==='live'&&!['market','candles','stop'].includes(name))throw Error('실전 승인 연결 전 주문·자동매매 잠금 상태입니다.');
 switch(name){
 case 'paper':engine.createPaper(b.capital);break;
 case 'market':await engine.select(b.market);break;
 case 'candles':await feed.loadCandles(b.units);break;
 case 'config':engine.configure(b.config||{},b.prompt);break;
 case 'keys/jev':await engine.connectJev('server-managed');break;
 case 'start':await engine.startConnected();break;
 case 'judgment':await engine.setJudgment(b.enabled);break;
 case 'analyze':await engine.ensureJev();await engine.analyze();break;
 case 'stop':engine.stop();engine.save();break;
 case 'track':engine.tracker.start(b.side,b.amount,b.sellPct,b.sellAmount??null);break;
 case 'order':await engine.order(b.side,b.amount,b.sellPct);break;
 case 'mode':if(b.mode!==workspaceMode)throw Error('거래 종류는 운영본부 직원 선택으로 변경하세요.');break;
 case 'reconcile':case 'cancel':break;
 default:throw Error('웹에서 지원하지 않는 명령: '+name);
 }return {ok:true,...snapshot()};
}
export function exportRecords(){const data={version:1,exportedAt:new Date().toISOString(),paper:engine.paper,archives:engine.archives};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='web-upbit-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
