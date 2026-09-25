import {workspaceMode} from './workspace.js';
let listener,bootPromise,lastState,connected=false,timer;
const endpoint='/api/coin/terminal/worker?mode='+workspaceMode;
// The operator token is entered by the operator and held in memory only.
let operatorToken='';
export function setOperatorToken(value){operatorToken=value;}
async function call(method='GET',payload){
 const response=await fetch(endpoint,{method,headers:{'Content-Type':'application/json','x-trading-operator':operatorToken},body:payload?JSON.stringify(payload):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
 const x=await response.json();if(!response.ok){const e=new Error(x.error||'메인 PC 응답 확인 실패');e.status=response.status;throw e;}
 connected=true;lastState=x;return x;
}
function connectionError(error){
 connected=false;
 let box=document.getElementById('pcConnectionError');
 if(!box){box=document.createElement('div');box.id='pcConnectionError';box.className='web-boot-error';box.setAttribute('role','alert');document.body.append(box);}
 box.textContent=error.message+' · 브라우저 연결이 끊겨도 PC 매매가 종료됐다는 뜻은 아닙니다.';
 if(lastState){lastState={...lastState,worker:{...lastState.worker,connectionLost:true}};listener?.(lastState);}
}
async function poll(){
 try{const x=await call();document.getElementById('pcConnectionError')?.remove();listener?.(x);}catch(error){connectionError(error);}
 timer=setTimeout(poll,document.visibilityState==='hidden'?15000:1000);
}
export function subscribe(fn){listener=fn;}
export function boot(){
 return bootPromise ||= call().catch(error=>{if(error.status!==401)throw error;return authenticate();}).then(x=>{timer=setTimeout(poll,1000);return x;});
}
function authenticate(){return new Promise(resolve=>{
 const form=document.createElement('form');form.className='web-boot-error';
 const label=document.createElement('label');label.textContent='매매 제어 비밀번호 ';const input=document.createElement('input');input.type='password';input.autocomplete='current-password';input.required=true;label.append(input);
 const button=document.createElement('button');button.type='submit';button.textContent='매매 화면 연결';const message=document.createElement('p');message.textContent='거래소·Jev API 키가 아닌 운영본부 매매 제어용 비밀번호를 입력하세요.';form.append(label,button,message);document.body.append(form);
 form.onsubmit=async event=>{event.preventDefault();button.disabled=true;operatorToken=input.value;try{const x=await call();input.value='';form.remove();resolve(x);}catch(error){operatorToken='';message.textContent=error.message;button.disabled=false;}};
});}
export async function command(name,body={}){
 if(!connected&&name!=='stop')throw Error('PC 현재 상태를 확인하기 전에는 새 주문을 보낼 수 없습니다.');
 const x=await call('POST',{name,body});listener?.(x);return x;
}
export async function exportRecords(){
 const r=await fetch(endpoint+'&export=1',{headers:{'x-trading-operator':operatorToken},cache:'no-store'});const x=await r.json();if(!r.ok)throw Error(x.error);
 const url=URL.createObjectURL(new Blob([JSON.stringify(x,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='main-pc-trading-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// No unload, pagehide or visibility handler sends a stop command.
window.addEventListener('pagehide',()=>clearTimeout(timer));
