export async function askJev(_key,state,prompt){
 const r=await fetch('/api/coin/terminal/judgment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,prompt}),signal:AbortSignal.timeout(7000)});
 const x=await r.json();if(!r.ok||!x.decision)throw Error(x.error||'Jev 서버 응답 확인 실패');return x.decision;
}
