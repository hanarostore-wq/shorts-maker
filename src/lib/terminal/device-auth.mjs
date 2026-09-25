import {createHmac,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
export const DEVICE_SECONDS=365*24*60*60;
export const cookieName=(production=process.env.NODE_ENV==='production')=>production?'__Host-moneyos-trading-device':'moneyos-trading-device-dev';
const configured=key=>typeof key==='string'&&key.length>=32;
const digest=value=>createHash('sha256').update(value).digest();
export function matchesOperator(supplied,key){return configured(key)&&typeof supplied==='string'&&timingSafeEqual(digest(supplied),digest(key));}
const sign=(payload,key)=>createHmac('sha256',key).update('moneyos-trading-device-v1.'+payload).digest('base64url');
export function issueDevice(key,now=Date.now()){
 if(!configured(key))throw Error('매매 제어 인증키 설정이 필요합니다.');
 const iat=Math.floor(now/1000);const payload=Buffer.from(JSON.stringify({v:1,id:randomUUID(),iat,exp:iat+DEVICE_SECONDS})).toString('base64url');
 return payload+'.'+sign(payload,key);
}
export function verifyDevice(token,key,now=Date.now()){
 if(!configured(key)||typeof token!=='string'||token.length>1024)return false;
 try{const parts=token.split('.');if(parts.length!==2)return false;const[payload,signature]=parts;
 if(!/^[A-Za-z0-9_-]+$/.test(payload)||!/^[A-Za-z0-9_-]{43}$/.test(signature)||!timingSafeEqual(digest(signature),digest(sign(payload,key))))return false;
 const s=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));const at=Math.floor(now/1000);
 return s.v===1&&typeof s.id==='string'&&/^[0-9a-f-]{36}$/.test(s.id)&&Number.isSafeInteger(s.iat)&&Number.isSafeInteger(s.exp)&&s.iat<=at+60&&s.exp>at&&s.exp-s.iat===DEVICE_SECONDS;
 }catch{return false;}
}
export function requestDevice(request,production=process.env.NODE_ENV==='production'){
 const name=cookieName(production);const entries=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 return entries.length===1?entries[0].slice(name.length+1):'';
}
export function tradingAuthenticated(request,key=process.env.TRADING_OPERATOR_TOKEN){return matchesOperator(request.headers.get('x-trading-operator')||'',key)||verifyDevice(requestDevice(request),key);}
export function sameOrigin(request){return request.headers.get('origin')===new URL(request.url).origin;}
export function deviceCookie(value,clear=false,production=process.env.NODE_ENV==='production'){
 return cookieName(production)+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(clear?0:DEVICE_SECONDS)+(production?'; Secure':'');
}
export function tradingAccessError(request){
 if(!tradingAuthenticated(request))return Response.json({error:'등록된 브라우저가 아닙니다. 매매 인증키로 처음 한 번 등록하세요.'},{status:401,headers:{'Cache-Control':'no-store'}});
 if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return Response.json({error:'운영본부 화면에서 보낸 매매 명령만 허용합니다.'},{status:403});
 return null;
}
