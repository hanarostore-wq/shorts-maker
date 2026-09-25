import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingController} from '../../services/trading/controller.mjs';

function setup(saved={}){
  let value=structuredClone(saved);
  const store={load:()=>value,save:x=>{value=structuredClone(x);}};
  const e={running:false,startRequested:false,judgmentRunning:false,jevKey:'test-fixture',paper:{cash:'300000'},archives:[],
    snapshot(){return {running:this.running,judgmentRunning:this.judgmentRunning};},
    save(){store.save({version:1,paper:this.paper});},ledger(){return this.paper;},dataReady:()=>true,
    async startConnected(){this.running=true;this.judgmentRunning=true;},
    async setJudgment(on){this.judgmentRunning=on;},stop(){this.running=false;this.judgmentRunning=false;this.startRequested=false;},fail(error){this.error=error.message;}};
  const c=new TradingController(e,{snapshot:()=>({symbol:'KRW-BTC'})},store);
  return {e,c,get saved(){return value;}};
}
test('starting sets a durable server intent without any browser connection',async()=>{
  const s=setup();await s.c.command('start');assert.equal(s.e.running,true);assert.equal(s.saved.serverIntent,'auto');
  // Merely reading or abandoning a view cannot send stop to the engine.
  s.c.snapshot();assert.equal(s.e.running,true);assert.equal(s.c.snapshot().worker.browserIndependent,true);
});
test('closing and reopening a viewer does not construct another engine',async()=>{
  const s=setup();await s.c.command('start');const first=s.c.snapshot();const second=s.c.snapshot();
  assert.equal(first.engine.running,true);assert.equal(second.engine.running,true);assert.equal(s.c.engine,s.e);
});
test('explicit stop persists off and cannot automatically resume after restart',async()=>{
  const s=setup();await s.c.command('start');await s.c.command('stop');assert.equal(s.saved.serverIntent,'off');
  const next=setup(s.saved);await next.c.resume();assert.equal(next.e.running,false);
});
test('service restart can recover the user running intent after data is ready',async()=>{
  const s=setup({version:1,serverIntent:'auto'});s.e.dataReady=()=>false;await s.c.resume();assert.equal(s.e.running,false);
  s.e.dataReady=()=>true;s.c.lastRecovery=0;await s.c.resume();assert.equal(s.e.running,true);
});
test('stop remains available while start authentication is pending',async()=>{
  const s=setup();let finish;
  s.e.startConnected=()=>new Promise(r=>{finish=r;});
  const start=s.c.command('start');await s.c.command('stop');finish();await start;
  assert.equal(s.e.running,false);assert.equal(s.saved.serverIntent,'off');
});
test('missing Jev configuration does not set an automatic run intent',async()=>{
  const s=setup();s.e.jevKey='';await assert.rejects(s.c.command('start'),/Jev/);assert.equal(s.c.intent,'off');
});
test('real order and unknown commands remain unavailable',async()=>{
  const s=setup();await assert.rejects(s.c.command('mode',{mode:'live'}),/각각의 직원/);
  await assert.rejects(s.c.command('live/arm'),/실전 화면/);assert.equal(s.e.running,false);
});
test('safety stop is not bypassed by recovery or service restart',async()=>{
 const s=setup();await s.c.command('start');s.e.stop();assert.equal(s.c.suspended,true);await s.c.resume();assert.equal(s.e.running,false);
 const next=setup(s.saved);await next.c.resume();assert.equal(next.e.running,false);assert.equal(next.c.suspended,true);
});
test('judgment toggle does not silently terminate an automatic run',async()=>{
 const s=setup();await s.c.command('start');await assert.rejects(s.c.command('judgment',{enabled:false}),/종료 버튼/);assert.equal(s.e.running,true);
});
test('normal service shutdown preserves running intent without clearing safety suspension',async()=>{
 const s=setup();await s.c.command('start');s.c.quiesce();assert.equal(s.saved.serverIntent,'auto');assert.equal(s.saved.serverSuspended,false);
});

function liveSetup(){
 const s=setup();s.e.mode='live';s.e.armed=false;s.e.live=null;s.e.assertIdle=()=>{};
 const calls=[];s.e.ledger=()=>s.e.live;s.e.connectUpbit=async()=>{calls.push('exchange');};
 s.e.ensureJev=async()=>{calls.push('jev');};s.e.testLive=async()=>{calls.push('test');};
 s.e.arm=async capital=>{calls.push('arm');s.e.live={initial:capital};s.e.armed=true;};
 s.c.mode='live';s.c.credentials=()=>({access:'fixture',secret:'fixture'});return {...s,calls};
}
test('live start verifies exchange, Jev and dry-run before arming and starting',async()=>{
 const s=liveSetup();await s.c.command('start',{capital:100000});assert.deepEqual(s.calls,['exchange','jev','test','arm']);assert.equal(s.e.running,true);
});
test('live start requires explicit capital and missing keys cannot activate',async()=>{
 const s=liveSetup();await assert.rejects(s.c.command('start'),/운용금/);s.c.credentials=()=>null;await assert.rejects(s.c.command('start',{capital:100000}),/키/);assert.equal(s.e.running,false);
});
test('stop during live exchange verification prevents all later stages',async()=>{
 const s=liveSetup();let finish;s.e.connectUpbit=()=>new Promise(r=>{finish=r;});const pending=s.c.command('start',{capital:100000});await s.c.command('stop');finish();await assert.rejects(pending,/종료/);assert.deepEqual(s.calls,[]);assert.equal(s.e.running,false);assert.equal(s.c.intent,'off');
});
test('exchange test failure never arms or starts real trading',async()=>{
 const s=liveSetup();s.e.testLive=async()=>{throw Error('test rejected');};await assert.rejects(s.c.command('start',{capital:100000}),/test rejected/);assert.equal(s.e.armed,false);assert.equal(s.e.running,false);
});
test('paper account reset cannot reach live account',async()=>{
 const s=liveSetup();await assert.rejects(s.c.command('paper',{capital:100000}),/초기화/);assert.equal(s.e.live,null);
});

test('manual live preparation does not start automatic trading',async()=>{const s=liveSetup();await s.c.command('live/arm',{capital:100000});assert.equal(s.e.armed,true);assert.equal(s.e.running,false);assert.equal(s.c.intent,'off');});
