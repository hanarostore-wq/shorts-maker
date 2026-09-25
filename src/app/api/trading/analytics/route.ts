import {tradingAccessError} from '@/lib/terminal/device-auth.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';
async function proxy(request:Request,method:'GET'|'POST'){
 const denied=tradingAccessError(request);if(denied)return denied;
 const endpoint=process.env.TRADING_WORKER_URL,key=process.env.TRADING_WORKER_TOKEN;
 if(!endpoint||!key)return Response.json({error:'매매분석 서버 연결 설정이 없습니다.'},{status:503});
 try{const base=new URL(endpoint);if(base.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('HTTPS 설정 필요');
 const query=new URL(request.url).searchParams;const target=new URL(method==='GET'?'/analytics':'/analytics/report',base);target.search=query.toString();
 const body=method==='POST'?await request.text():undefined;if(body&&Buffer.byteLength(body)>8000)return Response.json({error:'분석 조건이 너무 큽니다.'},{status:413});
 const r=await fetch(target,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body,cache:'no-store',signal:AbortSignal.timeout(15000)});
 return new Response(await r.text(),{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return Response.json({error:'매매분석 조회 실패: 메인 PC 연결 및 분석 저장소 상태를 확인하세요.'},{status:502});}}
export function GET(r:Request){return proxy(r,'GET');}export function POST(r:Request){return proxy(r,'POST');}
