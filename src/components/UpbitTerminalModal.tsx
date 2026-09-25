"use client";
import {useEffect,useRef,useState} from 'react';
import styles from './UpbitTerminalModal.module.css';
type Mode='paper'|'live';type Status={running:boolean;actualMode:Mode;authRequired?:boolean};
export function UpbitTerminalModal({mode,onClose}:{mode:Mode|null;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),paper=useRef<HTMLIFrameElement>(null),live=useRef<HTMLIFrameElement>(null),close=useRef(onClose);
 const [loaded,setLoaded]=useState<Record<Mode,boolean>>({paper:false,live:false});const [status,setStatus]=useState<Partial<Record<Mode,Status>>>({});const [failed,setFailed]=useState(false);
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>{const d=dialog.current;if(!mode){d?.close();return;}const previous=document.body.style.overflow;document.body.style.overflow='hidden';d?.showModal();return()=>{document.body.style.overflow=previous;};},[mode]);
 if(mode&&!loaded[mode])setLoaded({...loaded,[mode]:true});
 useEffect(()=>{let lastSeen=Date.now();const receive=(event:MessageEvent)=>{if(event.origin!==location.origin)return;const m=event.data?.mode as Mode;if(!['paper','live'].includes(m)||event.source!==(m==='paper'?paper.current:live.current)?.contentWindow||event.data.protocol!==2)return;if(event.data.type==='jev-workspace-close'&&m===mode){close.current();return;}if(event.data.type==='jev-workspace-status'&&typeof event.data.running==='boolean'){setStatus(s=>({...s,[m]:event.data}));if(m===mode){lastSeen=Date.now();setFailed(false);}}};window.addEventListener('message',receive);const t=setInterval(()=>{if(mode&&Date.now()-lastSeen>15000)setFailed(true);},1000);return()=>{window.removeEventListener('message',receive);clearInterval(t);};},[mode]);
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby="upbit-workspace-title" onCancel={e=>{e.preventDefault();onClose();}}><div className={styles.layout}>
 <header className={styles.header}><div className={styles.heading}><strong id="upbit-workspace-title">{mode==='live'?'실전매매원':'모의매매원'} · 업비트</strong><span className={styles.paper}>운영본부 웹 매매</span><span role="status" className={styles.connection}>{mode&&status[mode]?.authRequired?'매매 제어 인증 대기':failed?'화면 실행 확인 필요':mode&&status[mode]?'웹 매매 화면 준비됨':'매매 화면 준비 중…'}</span></div><button type="button" className={styles.close} onClick={onClose} aria-label="매매 화면 닫기">✕ 닫기</button></header>
 <div className={styles.notice}><span>{mode&&status[mode]?.running?'매매 실행 중 · 브라우저를 닫아도 메인 PC에서 계속됩니다.':'직원을 열어도 매매가 자동으로 시작되지 않습니다.'}</span><span>메인 PC 실행부 사용 · 탭을 닫아도 유지 · 종료 버튼으로 정지 · PC 연결 상태를 확인하세요.</span></div>
 <div className={styles.content}>{(['paper','live'] as const).map(m=>loaded[m]&&<iframe key={m} ref={m==='paper'?paper:live} className={styles.frame} style={{display:mode===m?'block':'none'}} title={m==='paper'?'모의매매원 업비트 웹 화면':'실전매매원 업비트 웹 화면'} src={'/trading/index.html?mode='+m} />)}
 {failed&&<div className={styles.webError} role="alert">매매 화면 준비가 지연되고 있습니다. 화면 안 오류를 확인하세요. PC 연결·인증 안내를 확인하세요. 화면 연결 끊김은 매매 종료 확인이 아닙니다.</div>}</div></div></dialog>;
}
