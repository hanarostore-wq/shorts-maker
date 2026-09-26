import {randomUUID} from 'node:crypto';
import {tradingAccessError} from '@/lib/terminal/device-auth.mjs';
import {askJev} from '@/lib/terminal/jev.mjs';
import {getSharedRedis} from '@/lib/store';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(){return Response.json({configured:Boolean(process.env.TYPESAFE_API_KEY)},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
 const denied=tradingAccessError(request);if(denied)return denied;
 try{
 const text=await request.text();if(text.length>24000)return Response.json({error:'판단 입력 크기 초과'},{status:413});
 const {state,prompt}=JSON.parse(text);if(!state||state.execution?.mode!=='paper'||!/^KRW-[A-Z0-9]+$/.test(state.market?.market)||!Number.isFinite(state.market?.asOf)||Math.abs(Date.now()-state.market.asOf)>10000||typeof prompt!=='string'||prompt.length>4000)return Response.json({error:'현재 모의 시장 데이터와 분석 문맥을 확인하세요.'},{status:400});
 const key=process.env.TYPESAFE_API_KEY;if(!key)return Response.json({error:'운영본부 서버에 TypeSafe 키가 없습니다. 서버 연결 설정이 필요합니다.'},{status:503});
 const redis=getSharedRedis();if(!redis)return Response.json({error:'중복 판단 방지용 공유 저장소 연결을 확인하세요.'},{status:503});
 const token=randomUUID();const lock=await redis.set('moneyos:terminal:judgment-lock',token,{nx:true,ex:15});if(!lock)return Response.json({error:'다른 판단 요청 처리 중입니다. 잠시 후 다시 시도하세요.'},{status:429});
 try {
  const decision=await askJev(key,state,prompt);
  if(!decision||typeof decision!=='object')return Response.json({error:'TypeSafe가 빈 판단 응답을 반환했습니다. 잠시 후 다시 시도하세요.'},{status:502,headers:{'Cache-Control':'no-store'}});
  return Response.json({decision},{headers:{'Cache-Control':'no-store'}});
 } finally {await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",['moneyos:terminal:judgment-lock'],[token]);}
 }catch(e){return Response.json({error:e instanceof Error?`Jev 연결 실패: ${e.message}`:'Jev 판단 서버 오류'},{status:502});}
}
