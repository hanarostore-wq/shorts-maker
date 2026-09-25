import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {Engine} from './core/engine.mjs';
import {MarketFeed} from './core/market.mjs';
import {Store} from './core/store.mjs';
import {TradingController} from './controller.mjs';
import {readSecrets,writeSecrets} from './windows-secrets.mjs';

const token=process.env.TRADING_WORKER_TOKEN;
if(!token||token.length<32)throw Error('메인 PC 연결 인증 설정이 필요합니다. 32자 이상 연결키를 환경변수로 지정하세요.');
const dir=process.env.TRADING_DATA_DIR;
if(!dir||!path.isAbsolute(dir))throw Error('별도의 절대 경로 TRADING_DATA_DIR가 필요합니다. 원래 업비트 data 폴더를 사용하지 마세요.');
const port=Number(process.env.PORT||18780);
fs.mkdirSync(dir,{recursive:true});
const lockfile=path.join(dir,'worker.lock');
try {fs.writeFileSync(lockfile,String(process.pid),{flag:'wx',mode:0o600});}
catch {throw Error('동일 데이터 폴더의 실행 잠금이 있습니다. 기존 실행 여부를 확인하세요. 자동으로 중복 실행하지 않습니다.');}
let liveCredentials={access:process.env.UPBIT_ACCESS_KEY||'',secret:process.env.UPBIT_SECRET_KEY||''};
const workers={};
for(const mode of ['paper','live']){
 const feed=new MarketFeed();const store=new Store(path.join(dir,mode));const engine=new Engine(feed,store);
 engine.mode=mode;engine.jevKey=process.env.TYPESAFE_API_KEY||'';
 const controller=new TradingController(engine,feed,store,{mode,credentials:()=>liveCredentials});
 workers[mode]={feed,store,engine,controller};
}
const recovery=setInterval(()=>{for(const w of Object.values(workers))void w.controller.resume();},1000);
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const digest=value=>createHash('sha256').update(value).digest();
const expected=digest('Bearer '+token);
const server=http.createServer(async(req,res)=>{
  if(!timingSafeEqual(digest(req.headers.authorization||''),expected))return send(res,401,{error:'메인 PC 연결 인증 실패'});
  // Only fixed authenticated trading commands. Never expose files, shell or withdrawal routes.
  try{
    const url=new URL(req.url,'http://localhost');
    const mode=url.searchParams.get('mode')||'paper';
    if(!['paper','live'].includes(mode))return send(res,400,{error:'모의·실전 구분 오류'});
    const {controller}=workers[mode];
    if(req.method==='GET'&&url.pathname==='/state')return send(res,200,controller.snapshot());
    if(req.method==='GET'&&url.pathname==='/export')return send(res,200,controller.export());
    if(req.method==='POST'&&['/command','/credentials'].includes(url.pathname)){
      if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSON 명령만 허용됩니다.'});
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return send(res,413,{error:'매매 명령 크기 초과'});}
      const parsed=JSON.parse(raw);
      if(url.pathname==='/credentials'){
        const {access,secret}=parsed;
        if(typeof access!=='string'||typeof secret!=='string'||!access||!secret||access.length>1000||secret.length>1000)throw Error('업비트 연결키 형식 오류');
        if(access===liveCredentials.access&&secret===liveCredentials.secret)return send(res,200,{ok:true});
        const live=workers.live;
        live.engine.assertIdle();await live.engine.connectUpbit(access,secret);
        if(!process.env.TRADING_SECRETS_FILE)throw Error('PC 암호화 저장 경로가 설정되지 않았습니다.');
        const saved=await readSecrets(process.env.TRADING_SECRETS_FILE);
        await writeSecrets(process.env.TRADING_SECRETS_FILE,{...saved,upbit:{access,secret}});
        liveCredentials={access,secret};return send(res,200,{ok:true});
      }
      const {name,body}=parsed;
      return send(res,200,await controller.command(name,body));
    }
    return send(res,404,{error:'지원하지 않는 실행부 경로'});
  }catch(error){return send(res,400,{error:error.message});}
});
server.on('error',()=>{shutdown();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{console.log('MAIN_PC_TRADING_READY port='+port+' modes=paper,live');for(const w of Object.values(workers))void w.feed.init();});
let closing=false;
function shutdown(){
  if(closing)return;closing=true;
  // Preserve the user's desired mode across service restarts, but stop this process.
  for(const w of Object.values(workers)){w.controller.quiesce();clearInterval(w.engine.timer);w.feed.stop();}clearInterval(recovery);server.close();
  if(fs.existsSync(lockfile)&&fs.readFileSync(lockfile,'utf8')===String(process.pid))fs.unlinkSync(lockfile);
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
