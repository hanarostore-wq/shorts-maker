export const workspaceMode=new URL(location.href).searchParams.get('mode')==='live'?'live':'paper';
export const apiRoot='/api/coin/terminal/';
function send(type,data={}){if(parent!==window)parent.postMessage({type,protocol:2,mode:workspaceMode,...data},location.origin);}
export function setupWorkspace(api){
 document.documentElement.dataset.theme='dark';
 document.querySelector('.local-label').textContent=workspaceMode==='paper'?'모의매매원 · 메인 PC 가상계좌':'실전매매원 · 메인 PC 실전계좌';
 const form=document.getElementById('jevKeyForm');form.querySelectorAll('label').forEach(x=>x.hidden=true);
 form.querySelector('p').textContent='메인 PC 실행부에 등록된 TypeSafe 키로 7가지 판단을 받습니다. 키는 브라우저에 저장되지 않습니다.';
 form.onsubmit=async e=>{e.preventDefault();try{await api('keys/jev');}catch(error){document.getElementById('jevConnected').textContent=error.message;}};
 const uf=document.getElementById('upbitKeyForm');uf.querySelectorAll('label,button').forEach(x=>x.hidden=true);
 uf.querySelector('p').textContent='메인 PC에 암호화 등록된 업비트 키를 사용합니다. 시작 버튼에서 잔고와 주문 가능 여부를 자동 확인합니다.';
 if(workspaceMode==='live'){const n=document.createElement('div');n.className='workspace-live-notice';n.textContent='실전 화면 · 설정한 운용금으로 실제 원화 주문을 실행합니다. 시작 전 연결과 주문 가능 여부를 자동 검사합니다.';document.querySelector('.nav').after(n);}
 document.getElementById('paperMode').hidden=true;document.getElementById('liveMode').hidden=true;
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))send('jev-workspace-close');});
}
export function renderWorkspace(state){
 const lost=!!state.worker?.connectionLost;
 for(const id of ['startBtn','submitOrder','analyzeBtn','judgmentToggle','capitalBtn','reconcileBtn','cancelPendingBtn','testLiveBtn']){
  const button=document.getElementById(id);
  if(lost){if(!button.hasAttribute('data-connection-disabled'))button.dataset.connectionDisabled=String(button.disabled);button.disabled=true;}
  else if(button.hasAttribute('data-connection-disabled')){if(!['startBtn','submitOrder','analyzeBtn'].includes(id))button.disabled=button.dataset.connectionDisabled==='true';delete button.dataset.connectionDisabled;}
 }
 // Settings can be inspected while offline. Saving still requires connectivity.
 document.getElementById('settingsBtn').disabled=false;
 const save=document.querySelector('#strategyPane button');
 if(save){save.disabled=lost;save.title=lost?'PC 연결 복구 후 저장할 수 있습니다.':'';}
 send('jev-workspace-status',{actualMode:workspaceMode,running:!!(state.engine.running||state.engine.startRequested||state.engine.tracking?.active),liveLocked:!!state.worker?.liveLocked});
}
