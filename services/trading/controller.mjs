// One persistent engine owns the account. Browser connections never own its lifetime.
export class TradingController {
  constructor(engine, feed, store, options={}) {
    this.mode=options.mode || 'paper';
    this.credentials=options.credentials || (()=>null);
    this.epoch=0;
    this.liveCapital=store.load()?.serverLiveCapital || null;
    this.engine = engine;
    this.feed = feed;
    this.store = store;
    this.intent = store.load()?.serverIntent || 'off';
    this.busy = false;
    this.recovering = false;
    this.lastRecovery = 0;
    this.suspended = Boolean(store.load()?.serverSuspended);
    this.quiescing = false;
    const save = store.save.bind(store);
    store.save = value => save({...value, serverIntent:this.intent,serverSuspended:this.suspended,serverLiveCapital:this.liveCapital});
    const stop=engine.stop.bind(engine);
    engine.stop=(...args)=>{stop(...args);if(this.intent!=='off'&&!this.quiescing){this.suspended=true;engine.save();}};
  }
  snapshot() {
    return {at:Date.now(), engine:this.engine.snapshot(), market:this.feed.snapshot(),
      worker:{kind:'main-pc', intent:this.intent, suspended:this.suspended, browserIndependent:true, liveLocked:this.mode==='live'&&!this.engine.armed}};
  }
  async resume() {
    const e=this.engine;
    if(this.intent==='off'||this.suspended||this.busy||this.recovering||e.running||e.judgmentRunning||e.startRequested||Date.now()-this.lastRecovery<30000)return;
    this.recovering=true;this.lastRecovery=Date.now();
    try {
      if(!e.dataReady())return;
      if(this.intent==='auto'){
        const epoch=this.epoch;
        if(this.mode==='live')await this.prepareLive(this.liveCapital,epoch);
        if(epoch===this.epoch&&this.intent==='auto')await e.startConnected();
      }else await e.setJudgment(true);
    } catch(error) {e.fail(error);} finally {this.recovering=false;}
  }
  async command(name, body={}) {
    const e=this.engine;
    // Stop remains available while authentication/analysis is pending.
    if(name==='judgment'&&body.enabled===false&&(e.running||e.startRequested))throw Error('자동매매를 끄려면 자동매매 종료 버튼을 사용하세요.');
    if(name==='stop'||(name==='judgment'&&body.enabled===false)){
      this.epoch++;this.intent='off';this.suspended=false;e.stop();e.save();
      return {ok:true,...this.snapshot()};
    }
    if(this.busy||this.recovering)throw Error('이전 매매 요청 처리 중입니다. 종료 버튼은 바로 사용할 수 있습니다.');
    this.busy=true;
    try {
      switch(name){
        case 'paper': if(this.mode!=='paper')throw Error('실전 계좌는 모의 시작금으로 초기화할 수 없습니다.');e.createPaper(body.capital);break;
        case 'market': await e.select(body.market);break;
        case 'candles': await this.feed.loadCandles(body.units);break;
        case 'config': e.configure(body.config||{},body.prompt);break;
        case 'keys/jev': await e.connectJev(e.jevKey);break;
        case 'start': {
          const epoch=this.epoch;
          if(this.mode==='live'&&!e.running&&!e.startRequested)await this.prepareLive(body.capital??this.liveCapital,epoch);
          if(epoch!==this.epoch)throw Error('시작 준비 중 사용자가 종료했습니다.');
          if(!e.ledger())throw Error('모의 시작금을 먼저 설정하세요.');
          if(!e.jevKey)throw Error('메인 PC 실행부에 Jev 키 연결이 필요합니다.');
          if(e.running||e.startRequested)break;
          e.assertIdle?.();this.suspended=false;this.intent='auto';e.save();await e.startConnected();break;
        }
        case 'judgment':
          if(body.enabled!==true)throw Error('판단 ON/OFF 값 오류');
          if(e.running||e.startRequested)break;
          if(!e.jevKey)throw Error('메인 PC 실행부에 Jev 키 연결이 필요합니다.');
          this.intent='judgment';e.save();await e.setJudgment(true);break;
        case 'analyze': {const verified=e.jevVerified;await e.ensureJev();if(verified)await e.analyze();break;}
        case 'track': e.tracker.start(body.side,body.amount,body.sellPct,body.sellAmount??null);break;
        case 'order': await e.order(body.side,body.amount,body.sellPct);break;
        case 'live/arm': if(this.mode!=='live')throw Error('실전 화면에서만 허용됩니다.');await this.prepareLive(body.capital,this.epoch);break;
        case 'keys/upbit': await this.connectExchange();break;
        case 'live/test': if(this.mode!=='live')throw Error('실전 화면에서만 가능합니다.');await this.connectExchange();await e.testLive();break;
        case 'reconcile': await e.reconcile();break;
        case 'cancel': await e.cancelPending();break;
        case 'mode': if(body.mode!==this.mode)throw Error('모의·실전은 각각의 직원 화면에서 사용하세요.');break;
        default:throw Error('허용되지 않은 매매 명령');
      }
      return {ok:true,...this.snapshot()};
    } finally {this.busy=false;}
  }
  async connectExchange(){
    if(this.mode!=='live')throw Error('실전 화면에서만 연결할 수 있습니다.');
    const key=this.credentials();
    if(!key?.access||!key?.secret)throw Error('메인 PC에 업비트 키가 등록되지 않았습니다.');
    await this.engine.connectUpbit(key.access,key.secret);
  }
  async prepareLive(capital,epoch){
    const e=this.engine;
    if(!Number.isSafeInteger(capital)||capital<5000)throw Error('실전 운용금을 5,000원 이상 직접 설정하세요.');
    e.assertIdle();
    const check=()=>{if(epoch!==this.epoch)throw Error('실전 시작 준비 중 사용자가 종료했습니다.');};
    await this.connectExchange();check();
    await e.ensureJev();check();
    await e.testLive();check();
    await e.arm(capital,'실제 원화로 거래합니다');check();
    this.liveCapital=capital;e.save();
  }
  quiesce(){this.quiescing=true;this.engine.stop();this.engine.save();}
  export(){return {version:1,exportedAt:new Date().toISOString(),paper:this.engine.paper,live:this.engine.live,archives:this.engine.archives};}
}
