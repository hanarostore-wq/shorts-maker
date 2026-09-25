import {workspaceMode} from './workspace.js';
let listener,bootPromise,lastState,connected=false,timer,registration;
const endpoint='/api/coin/terminal/worker?mode='+workspaceMode;
const authEndpoint='/api/coin/terminal/auth';
async function call(method='GET',payload){
 const response=await fetch(endpoint,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
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
 const started=performance.now();
 try{const x=await call();document.getElementById('pcConnectionError')?.remove();listener?.(x);}
 catch(error){connectionError(error);if(error.status===401){await authenticate();document.getElementById('pcConnectionError')?.remove();}}
 // One request at a time; do not add a full second to every network round trip.
 timer=setTimeout(poll,document.visibilityState==='hidden'?15000:Math.max(250,1000-(performance.now()-started)));
}
export function subscribe(fn){listener=fn;}
export function boot(){
 return bootPromise ||= (async()=>{
  const status=await fetch(authEndpoint,{credentials:'same-origin',cache:'no-store'});
  if(status.status===401)await authenticate();else if(!status.ok)throw Error('브라우저 등록 확인에 실패했습니다. 잠시 후 다시 연결하세요.');
  const x=await call();addForgetButton();timer=setTimeout(poll,1000);return x;
 })();
}
function authenticate(){
 if(registration)return registration;
 registration=new Promise(resolve=>{
 const notify=()=>{if(parent!==window)parent.postMessage({type:'jev-workspace-status',protocol:2,mode:workspaceMode,actualMode:workspaceMode,running:false,authRequired:true},location.origin);};notify();const heartbeat=setInterval(notify,5000);
 document.getElementById('pcConnectionError')?.remove();
 const form=document.createElement('form');form.className='web-boot-error';form.id='deviceRegistration';
 const title=document.createElement('h2');title.textContent='이 PC의 브라우저 등록';
 const label=document.createElement('label');label.textContent='매매 인증키 ';const input=document.createElement('input');input.type='password';input.autocomplete='off';input.required=true;label.append(input);
 const button=document.createElement('button');button.type='submit';button.textContent='한 번 등록하고 이 브라우저 기억하기';
 const message=document.createElement('p');message.textContent='바탕화면 ‘운영본부 매매 인증키 복사’를 실행한 뒤 붙여넣으세요. 등록하면 다음부터 입력하지 않아도 됩니다. 공용 PC에서는 등록하지 마세요.';
 const note=document.createElement('p');note.textContent='등록하지 않은 브라우저에서는 매수·매도·자동매매 시작이 차단됩니다. 브라우저를 바꾸거나 사이트 데이터를 지우면 다시 등록해야 합니다.';
 form.append(title,label,button,message,note);document.body.append(form);
 form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try{
  const r=await fetch(authEndpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-trading-operator':input.value},body:'{}',cache:'no-store'});
  const x=await r.json();if(!r.ok)throw Error(x.error||'브라우저 등록 실패');
  input.value='';clearInterval(heartbeat);form.remove();registration=null;resolve();
 }catch(error){message.textContent=error.message;button.disabled=false;}};
 });return registration;
}
function addForgetButton(){
 if(document.getElementById('forgetTradingDevice'))return;
 const button=document.createElement('button');button.id='forgetTradingDevice';button.type='button';button.textContent='이 브라우저 등록 지우기';button.title='이 브라우저에서 다음 접속 시 인증키가 다시 필요합니다. 실행 중인 매매는 유지됩니다.';
 button.onclick=async()=>{button.disabled=true;try{const r=await fetch(authEndpoint,{method:'DELETE',credentials:'same-origin'});if(!r.ok)throw Error('브라우저 등록 해제 실패');clearTimeout(timer);location.reload();}catch(error){button.disabled=false;connectionError(error);}};
 document.querySelector('.nav').append(button);
}
export async function command(name,body={}){
 if(!connected&&name!=='stop')throw Error('PC 현재 상태를 확인하기 전에는 새 주문을 보낼 수 없습니다.');
 const x=await call('POST',{name,body});listener?.(x);return x;
}
export async function exportRecords(){
 const r=await fetch(endpoint+'&export=1',{credentials:'same-origin',cache:'no-store'});const x=await r.json();if(!r.ok)throw Error(x.error);
 const url=URL.createObjectURL(new Blob([JSON.stringify(x,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='main-pc-trading-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Closing a viewer never sends a stop command to the background PC worker.
window.addEventListener('pagehide',()=>clearTimeout(timer));
