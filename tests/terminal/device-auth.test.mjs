import test from 'node:test';import assert from 'node:assert/strict';
import {issueDevice,verifyDevice,matchesOperator,deviceCookie,cookieName,tradingAccessError,requestDevice,DEVICE_SECONDS} from '../../src/lib/terminal/device-auth.mjs';
const key='test-only-operator-fixture-at-least-32-characters';
const now=1790300000000;
test('valid persistent registration works after browser restart without the original key header',()=>{const t=issueDevice(key,now);assert.equal(verifyDevice(t,key,now+86400000),true);assert.equal(t.includes(key),false);});
test('modified, truncated, expired and differently signed registrations are refused',()=>{const t=issueDevice(key,now);for(const bad of [t+'x',t.slice(1),'true','registered',null])assert.equal(verifyDevice(bad,key,now),false);assert.equal(verifyDevice(t,key,now+DEVICE_SECONDS*1000),false);assert.equal(verifyDevice(t,key+'rotated',now),false);});
test('missing or short server keys cannot authorize a device',()=>{assert.equal(matchesOperator('',''),false);assert.equal(matchesOperator('short','short'),false);assert.equal(verifyDevice(issueDevice(key,now),'',now),false);});
test('cookie cannot be read by page scripts and production cookie is HTTPS host-only',()=>{const c=deviceCookie('fixture',false,true);assert.match(c,/^__Host-/);assert.match(c,/HttpOnly/);assert.match(c,/SameSite=Strict/);assert.match(c,/Secure/);assert.match(c,/Path=\//);assert.doesNotMatch(c,/Domain=/);assert.match(deviceCookie('',true,true),/Max-Age=0/);});
test('duplicate cookie names are not accepted',()=>{const name=cookieName();const r=new Request('https://hq.example/api',{headers:{cookie:name+'=one; '+name+'=two'}});assert.equal(requestDevice(r),'');});
test('unauthenticated direct trading calls are rejected; registered same-origin calls work',()=>{
 const old=process.env.TRADING_OPERATOR_TOKEN;process.env.TRADING_OPERATOR_TOKEN=key;
 try{const url='https://hq.example/api/coin/order';assert.equal(tradingAccessError(new Request(url,{method:'POST',headers:{origin:'https://hq.example'}})).status,401);
 const token=issueDevice(key);const headers={cookie:cookieName()+'='+token,origin:'https://hq.example'};
 assert.equal(tradingAccessError(new Request(url,{method:'POST',headers})),null);
 assert.equal(tradingAccessError(new Request(url,{method:'POST',headers:{...headers,origin:'https://attacker.example'}})).status,403);
 assert.equal(tradingAccessError(new Request(url,{method:'POST',headers:{cookie:headers.cookie}})).status,403);
 }finally{if(old===undefined)delete process.env.TRADING_OPERATOR_TOKEN;else process.env.TRADING_OPERATOR_TOKEN=old;}
});
