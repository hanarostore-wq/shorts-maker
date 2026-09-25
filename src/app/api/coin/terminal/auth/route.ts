import {deviceCookie,issueDevice,matchesOperator,requestDevice,sameOrigin,verifyDevice} from '@/lib/terminal/device-auth.mjs';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request){
 const key=process.env.TRADING_OPERATOR_TOKEN;
 if(!verifyDevice(requestDevice(request),key))return Response.json({authenticated:false},{status:401,headers:{'Cache-Control':'no-store'}});
 // Renew a valid registration when reopening the screen. No plaintext key in the cookie.
 return Response.json({authenticated:true},{headers:{'Cache-Control':'no-store','Set-Cookie':deviceCookie(issueDevice(key))}});
}
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'운영본부 화면에서만 브라우저를 등록할 수 있습니다.'},{status:403});
 const key=process.env.TRADING_OPERATOR_TOKEN;
 if(!matchesOperator(request.headers.get('x-trading-operator')||'',key))return Response.json({error:'인증키가 맞지 않습니다. 바탕화면의 인증키 복사 도구를 사용하세요.'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json({authenticated:true},{headers:{'Cache-Control':'no-store','Set-Cookie':deviceCookie(issueDevice(key))}});
}
export async function DELETE(request:Request){
 if(!sameOrigin(request))return Response.json({error:'운영본부 화면에서만 이 브라우저 등록을 지울 수 있습니다.'},{status:403});
 // Forget only this browser. Trading on the PC keeps its current user-selected state.
 return Response.json({authenticated:false},{headers:{'Cache-Control':'no-store','Set-Cookie':deviceCookie('',true)}});
}
