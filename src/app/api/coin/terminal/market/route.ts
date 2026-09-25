import {fetchViaFixedIp} from '@/lib/proxyFetch';
import {marketPath} from '@/lib/terminal/market-path.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const path=marketPath(new URL(request.url).searchParams.get('path'));
 const r=await fetchViaFixedIp('https://api.upbit.com'+path,{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return Response.json({error:'업비트 시세 응답 오류 '+r.status},{status:r.status===429?429:502});
 return Response.json(await r.json(),{headers:{'Cache-Control':'no-store','Date':r.headers.get('date')||new Date().toUTCString()}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'시세 조회 실패'},{status:400});}}
