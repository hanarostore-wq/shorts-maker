export function marketPath(raw){
 if(typeof raw!=='string'||raw.length>500)throw Error('시세 요청 경로 오류');
 const u=new URL(raw,'https://api.upbit.com');if(u.origin!=='https://api.upbit.com')throw Error('외부 주소는 허용하지 않습니다.');
 const paths=['/v1/market/all','/v1/ticker/all','/v1/trades/ticks','/v1/candles/seconds','/v1/candles/days','/v1/candles/weeks','/v1/candles/months','/v1/candles/years',...['1','3','5','10','15','30','60','240'].map(x=>'/v1/candles/minutes/'+x)];
 if(!paths.includes(u.pathname))throw Error('허용되지 않은 시세 경로');
 if([...u.searchParams.keys()].some(k=>!['market','count','is_details','quote_currencies'].includes(k)))throw Error('시세 요청 항목 오류');
 if(u.searchParams.has('market')&&!/^KRW-[A-Z0-9]+$/.test(u.searchParams.get('market')))throw Error('원화 종목 코드 오류');
 if(u.searchParams.has('count')&&!/^(?:[1-9]\d?|1\d\d|200)$/.test(u.searchParams.get('count')))throw Error('시세 개수 오류');
 if(u.pathname==='/v1/ticker/all'&&u.searchParams.get('quote_currencies')!=='KRW')throw Error('원화 시세만 지원');
 return u.pathname+u.search;
}
