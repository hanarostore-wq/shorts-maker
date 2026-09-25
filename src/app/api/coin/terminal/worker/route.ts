import {loadUpbitCredentials} from '@/lib/coinCredentials';
import {timingSafeEqual,createHash} from 'node:crypto';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// This is a server-to-server bridge. Never send the worker credential to the browser.
async function proxy(request:Request,method:'GET'|'POST'){
  const endpoint=process.env.TRADING_WORKER_URL;
  const key=process.env.TRADING_WORKER_TOKEN;
  if(!endpoint||!key)return Response.json({error:'메인 PC 연결 설정이 아직 완료되지 않았습니다. 매매를 시작하지 않았습니다.'},{status:503});
  // Operator authentication must be configured before exposing remote control.
  const operator=process.env.TRADING_OPERATOR_TOKEN;
  const supplied=request.headers.get('x-trading-operator')||'';
  const hash=(x:string)=>createHash('sha256').update(x).digest();
  if(!operator||operator.length<32||!timingSafeEqual(hash(supplied),hash(operator)))return Response.json({error:'매매 제어 인증이 필요합니다.'},{status:401});
  if(method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'운영본부 화면의 명령만 허용합니다.'},{status:403});
  try{
    const base=new URL(endpoint);
    const loopback=['localhost','127.0.0.1'].includes(base.hostname);
    if(base.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&loopback))throw Error('PC 연결은 인증된 HTTPS 주소가 필요합니다.');
    const raw=method==='POST'?await request.text():undefined;
    if(raw&&Buffer.byteLength(raw)>16000)return Response.json({error:'매매 명령 크기 초과'},{status:413});
    const target=method==='POST'?'/command':new URL(request.url).searchParams.get('export')==='1'?'/export':'/state';
    const mode=new URL(request.url).searchParams.get('mode')||'paper';
    if(!['paper','live'].includes(mode))return Response.json({error:'모의·실전 구분 오류'},{status:400});
    if(method==='POST'&&mode==='live'&&raw){
      const name=JSON.parse(raw).name;
      if(['start','keys/upbit','live/test','live/arm'].includes(name)){
        const saved=await loadUpbitCredentials();
        const access=process.env.UPBIT_ACCESS_KEY||saved?.accessKey;
        const secret=process.env.UPBIT_SECRET_KEY||saved?.secretKey;
        if(!access||!secret)return Response.json({error:'운영본부 업비트 연결에 등록된 키가 없습니다. 업비트파견 직원에서 먼저 연결하세요.'},{status:409});
        const synced=await fetch(new URL('/credentials',base),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({access,secret}),cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(!synced.ok)return new Response(await synced.text(),{status:synced.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }
    }
    const upstream=new URL(target,base);upstream.searchParams.set('mode',mode);
    const result=await fetch(upstream,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:raw,cache:'no-store',signal:AbortSignal.timeout(12000)});
    return new Response(await result.text(),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return Response.json({error:'메인 PC 응답을 확인하지 못했습니다. 실행 여부를 단정할 수 없으므로 새 주문을 반복하지 마세요. PC 전원·연결 상태를 확인하세요.'},{status:502});}
}
export async function GET(request:Request){return proxy(request,'GET');}
export async function POST(request:Request){return proxy(request,'POST');}
