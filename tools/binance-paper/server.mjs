import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const kind = process.env.PAPER_KIND === "futures" ? "futures" : "spot";
const port = Number(process.env.PORT || (kind === "spot" ? 7081 : 7082));
const dataDir = process.env.PAPER_DATA_DIR || `C:/ProgramData/BinancePaper/${kind}`;
const statePath = path.join(dataDir, "paper-state.json");
const symbol = "BTCUSDT";
const isFutures = kind === "futures";
const title = isFutures ? "BINANCE 선물 · PAPER" : "BINANCE 현물 · PAPER";
const accent = isFutures ? "#a78bfa" : "#37d67a";
const marketApi = isFutures ? "https://fapi.binance.com/fapi/v1" : "https://data-api.binance.vision/api/v3";

fs.mkdirSync(dataDir, { recursive: true });

const emptyState = () => ({
  initialKrw: 100_000_000,
  krw: 100_000_000,
  position: null,
  trades: [],
  realizedKrw: 0,
  orderKrw: 1_000_000,
  autoTrading: false,
  updatedAt: new Date().toISOString(),
});

function loadState() {
  try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(statePath, "utf8")) }; }
  catch { return emptyState(); }
}
let paper = loadState();
function saveState() { paper.updatedAt = new Date().toISOString(); fs.writeFileSync(statePath, JSON.stringify(paper, null, 2), "utf8"); }

let market = {
  ok: false, priceUsd: 0, priceKrw: 0, changePct: 0, highUsd: 0, lowUsd: 0,
  volumeUsd: 0, usdKrw: 0, bidUsd: 0, askUsd: 0, candles: [],
  markUsd: 0, indexUsd: 0, fundingRate: 0, nextFundingTime: 0, openInterest: 0,
  updatedAt: null, error: "시세를 불러오는 중입니다",
};

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "BLACK-BinancePaper/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function refreshMarket() {
  try {
    const fxUrl = "https://open.er-api.com/v6/latest/USD";
    if (isFutures) {
      const [premium, ticker, interest, candles, fx] = await Promise.all([
        json(`${marketApi}/premiumIndex?symbol=${symbol}`),
        json(`${marketApi}/ticker/24hr?symbol=${symbol}`),
        json(`${marketApi}/openInterest?symbol=${symbol}`),
        json(`${marketApi}/klines?symbol=${symbol}&interval=1m&limit=40`),
        json(fxUrl),
      ]);
      const usdKrw = Number(fx.rates?.KRW || 0);
      market = {
        ...market,
        ok: true, error: "", usdKrw,
        priceUsd: Number(premium.markPrice), priceKrw: Number(premium.markPrice) * usdKrw,
        markUsd: Number(premium.markPrice), indexUsd: Number(premium.indexPrice),
        changePct: Number(ticker.priceChangePercent), highUsd: Number(ticker.highPrice), lowUsd: Number(ticker.lowPrice), volumeUsd: Number(ticker.quoteVolume),
        fundingRate: Number(premium.lastFundingRate) * 100, nextFundingTime: Number(premium.nextFundingTime), openInterest: Number(interest.openInterest),
        candles: candles.map((row) => ({ t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5]) })),
        updatedAt: new Date().toISOString(),
      };
    } else {
      const [ticker, book, candles, fx] = await Promise.all([
        json(`${marketApi}/ticker/24hr?symbol=${symbol}`),
        json(`${marketApi}/ticker/bookTicker?symbol=${symbol}`),
        json(`${marketApi}/klines?symbol=${symbol}&interval=1m&limit=40`),
        json(fxUrl),
      ]);
      const usdKrw = Number(fx.rates?.KRW || 0);
      market = {
        ...market,
        ok: true, error: "", usdKrw,
        priceUsd: Number(ticker.lastPrice), priceKrw: Number(ticker.lastPrice) * usdKrw,
        bidUsd: Number(book.bidPrice), askUsd: Number(book.askPrice),
        changePct: Number(ticker.priceChangePercent), highUsd: Number(ticker.highPrice), lowUsd: Number(ticker.lowPrice), volumeUsd: Number(ticker.quoteVolume),
        candles: candles.map((row) => ({ t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5]) })),
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    market = { ...market, ok: false, error: `시세 연결 문제: ${error instanceof Error ? error.message : "확인 필요"}` };
  }
}

function round(value) { return Math.round(Number(value) || 0); }
function totalEquity() {
  if (!paper.position || !market.priceKrw) return paper.krw;
  const multiplier = paper.position.side === "SHORT" ? -1 : 1;
  const unrealized = (market.priceKrw - paper.position.entryKrw) * paper.position.qty * multiplier;
  return paper.krw + paper.position.marginKrw + unrealized;
}
function positionView() {
  if (!paper.position || !market.priceKrw) return null;
  const multiplier = paper.position.side === "SHORT" ? -1 : 1;
  const pnlKrw = (market.priceKrw - paper.position.entryKrw) * paper.position.qty * multiplier;
  return { ...paper.position, currentKrw: round(market.priceKrw), pnlKrw: round(pnlKrw), pnlPct: paper.position.marginKrw ? (pnlKrw / paper.position.marginKrw) * 100 : 0 };
}
function apiState() {
  const position = positionView();
  return {
    kind, title, paperOnly: true, localServer: true, market,
    account: {
      initialKrw: paper.initialKrw, availableKrw: round(paper.krw), totalKrw: round(totalEquity()),
      realizedKrw: round(paper.realizedKrw), position, orderKrw: paper.orderKrw, autoTrading: paper.autoTrading,
      trades: paper.trades.slice(0, 8),
    },
  };
}
function reset(initialKrw) {
  paper = { ...emptyState(), initialKrw, krw: initialKrw, orderKrw: Math.min(1_000_000, Math.max(10_000, Math.floor(initialKrw / 100))) };
  saveState();
}
function order(action) {
  if (!market.ok || !market.priceKrw) throw new Error("실시간 시세를 받은 뒤 가상 주문을 할 수 있습니다");
  const amount = Math.max(10_000, Math.min(paper.orderKrw, paper.krw));
  const current = positionView();
  const now = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
  if (action === "reset") { reset(paper.initialKrw); return; }
  if (!paper.position) {
    const side = isFutures && action === "short" ? "SHORT" : "LONG";
    if (amount > paper.krw) throw new Error("가상 원화 잔고가 부족합니다");
    const qty = amount / market.priceKrw;
    paper.krw -= amount;
    paper.position = { side, qty, entryKrw: market.priceKrw, marginKrw: amount, openedAt: now, leverage: isFutures ? 1 : 1 };
    paper.trades.unshift({ time: now, type: side === "SHORT" ? "가상 숏 시작" : "가상 매수", amountKrw: round(amount), detail: "실제 주문 없음" });
  } else {
    const pnlKrw = current?.pnlKrw || 0;
    paper.krw += paper.position.marginKrw + pnlKrw;
    paper.realizedKrw += pnlKrw;
    paper.trades.unshift({ time: now, type: isFutures ? "가상 포지션 종료" : "가상 매도", amountKrw: round(paper.position.marginKrw + pnlKrw), detail: `손익 ${round(pnlKrw).toLocaleString("ko-KR")}원` });
    paper.position = null;
  }
  paper.trades = paper.trades.slice(0, 40);
  saveState();
}

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
const percent = (value) => `${Number(value || 0).toFixed(2)}%`;

function shell() {
  const futureBlocks = isFutures
    ? '<section class="metric"><small>사용 중인 돈</small><b id="margin">-</b><p>가상 돈 중 거래에 묶인 돈</p></section><section class="metric"><small>펀딩비</small><b id="funding">-</b><p>선물 계약을 오래 들고 있을 때 생기는 비용/보상</p></section><section class="metric"><small>청산 위험</small><b id="risk">낮음</b><p>강제로 거래가 끝날 가능성</p></section>'
    : '<section class="metric"><small>보유 코인</small><b id="holding">없음</b><p>가상으로 사 둔 코인</p></section><section class="metric"><small>오늘 변동</small><b id="change">-</b><p>어제와 비교한 가격 움직임</p></section><section class="metric"><small>가상 거래 횟수</small><b id="tradeCount">0회</b><p>실제 돈은 전혀 움직이지 않음</p></section>';
  const futureButton = isFutures ? '<button class="sell" id="short" onclick="paperOrder(\'short\')">가상으로 가격 하락에 걸기</button>' : '';
  const cardTitle = isFutures ? '선물 위험 쉽게 보기' : '시장 움직임 쉽게 보기';
  const cardHint = isFutures ? '레버리지와 청산은 위험이 커서 처음에는 1배만 씁니다' : '호가 = 지금 바로 사고팔 수 있는 가격 목록';
  const script = String.raw`
const isFutures = ${JSON.stringify(isFutures)};
const won = function(n){ return Math.round(Number(n || 0)).toLocaleString('ko-KR') + '원'; };
const per = function(n){ return Number(n || 0).toFixed(2) + '%'; };
function drawChart(candles){
  const svg=document.getElementById('chartSvg'); if(!candles || !candles.length){ svg.innerHTML=''; return; }
  const min=Math.min.apply(null,candles.map(function(x){return x.l;})); const max=Math.max.apply(null,candles.map(function(x){return x.h;})); const w=1000/candles.length; let out='';
  candles.forEach(function(x,i){ const y=function(v){return 260-(v-min)/(max-min||1)*230;}; const color=x.c>=x.o?'#36d990':'#f05c72'; const cx=i*w+w/2; out += '<line x1="'+cx+'" y1="'+y(x.h)+'" x2="'+cx+'" y2="'+y(x.l)+'" stroke="'+color+'" stroke-width="2"/><rect x="'+(cx-w*.27)+'" y="'+Math.min(y(x.o),y(x.c))+'" width="'+(w*.54)+'" height="'+Math.max(3,Math.abs(y(x.o)-y(x.c)))+'" fill="'+color+'"/>'; });
  svg.innerHTML=out;
}
function row(a,b,c){ return '<div class="row"><strong>'+a+'</strong><span>'+b+'</span><span>'+c+'</span></div>'; }
async function load(){
  try{
    const response=await fetch('api/state',{cache:'no-store'}); const state=await response.json(); const a=state.account; const m=state.market; const p=a.position;
    const connection=document.getElementById('connection'); connection.textContent=m.ok?'● 시세 수신 정상':'● 시세 연결 확인 중'; connection.className='pill '+(m.ok?'live':'');
    document.getElementById('initial').textContent=won(a.initialKrw); document.getElementById('equity').textContent=won(a.totalKrw);
    const pnl=document.getElementById('pnl'); pnl.textContent=(a.realizedKrw>=0?'+':'')+won(a.realizedKrw); pnl.className=a.realizedKrw>=0?'good':'bad';
    document.getElementById('price').textContent=m.priceKrw?won(m.priceKrw):'-'; document.getElementById('priceInfo').textContent=m.updatedAt?'시세 갱신 '+new Date(m.updatedAt).toLocaleTimeString('ko-KR')+' · 달러 1개 ≈ '+won(m.usdKrw):m.error;
    document.getElementById('chartHint').textContent=m.ok?'최근 40분 가격 흐름':'시세 연결 중'; document.getElementById('orderAmount').textContent=won(a.orderKrw); drawChart(m.candles);
    if(isFutures){ document.getElementById('margin').textContent=p?won(p.marginKrw):'0원'; document.getElementById('funding').textContent=per(m.fundingRate); document.getElementById('risk').textContent=p?'낮음 (1배 연습 중)':'없음'; }
    else { document.getElementById('holding').textContent=p?'BTC 보유 중':'없음'; document.getElementById('change').textContent=(m.changePct>=0?'+':'')+per(m.changePct); document.getElementById('tradeCount').textContent=a.trades.length+'회'; }
    const primary=document.getElementById('primary'); primary.textContent=p?'가상 보유분 정리하기':'가상으로 사 보기'; primary.onclick=function(){paperOrder(p?'close':'buy');}; const short=document.getElementById('short'); if(short) short.disabled=!!p;
    document.getElementById('position').innerHTML=p?row(p.side==='SHORT'?'가격 하락에 건 상태':'BTC 보유 중','시작 '+won(p.entryKrw),(p.pnlKrw>=0?'+':'')+won(p.pnlKrw))+'<p class="hint">'+(p.side==='SHORT'?'가격이 내려가면 이익, 오르면 손실':'가격이 오르면 이익, 내리면 손실')+' · 실제 주문 없음</p>':'<div class="empty">지금 보유한 가상 코인이 없습니다</div>';
    let risk=''; if(isFutures){ risk=row('현재 가격',won(m.priceKrw),'시장가')+row('예상 청산가',p?won(p.entryKrw*.2):'-','1배라 매우 낮음')+row('미결제약정',Math.round(m.openInterest||0).toLocaleString('ko-KR')+' BTC','시장 계약 규모'); }
    else { risk=row('지금 사는 가격',won(m.askUsd*m.usdKrw),'매수 호가')+row('지금 파는 가격',won(m.bidUsd*m.usdKrw),'매도 호가')+row('오늘 거래 규모',won(m.volumeUsd*m.usdKrw),'시장 활발함'); }
    document.getElementById('riskBox').innerHTML=risk; document.getElementById('trades').innerHTML=a.trades.length?a.trades.map(function(t){return row(t.type,won(t.amountKrw),t.time);}).join(''):'<div class="empty">아직 가상 거래가 없습니다</div>';
  } catch(e) { document.getElementById('connection').textContent='● 화면 연결 확인 필요'; }
}
async function paperOrder(action){ const r=await fetch('api/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:action})}); const j=await r.json(); if(!j.ok) alert(j.error||'가상 주문 처리에 실패했습니다'); load(); }
async function resetAccount(){ if(confirm('가상 보유분과 기록을 모두 지우고 처음부터 시작할까요?')) paperOrder('reset'); }
load(); setInterval(load,2000);`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{--bg:#07101b;--line:#1b3047;--text:#eaf2fb;--muted:#8da0b7;--accent:${accent};--good:#36d990;--bad:#f05c72}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#12243d 0,transparent 30%),var(--bg);color:var(--text);font-family:Arial,"Malgun Gothic",sans-serif;font-size:14px}header{height:58px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:0 24px;background:#081321}.brand{font-weight:900;font-size:20px}.brand em{color:var(--accent);font-style:normal}.pills{display:flex;gap:8px}.pill{padding:6px 10px;border:1px solid var(--line);border-radius:6px;color:var(--muted);font-size:12px}.live{color:#bff4d6;border-color:#1e7652;background:#0d2b25}.layout{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 58px)}aside{border-right:1px solid var(--line);padding:16px;background:#081321}.nav{padding:11px 10px;color:var(--muted);border-radius:6px;margin-bottom:4px}.nav.active{color:var(--text);border:1px solid #23526a;background:#0e2032}.side-note{position:fixed;bottom:18px;color:var(--muted);font-size:11px;line-height:1.7;padding-right:20px}main{padding:18px;max-width:1800px;width:100%;margin:auto}.notice{border:1px solid #6d5a1c;background:#251f10;color:#f7d66d;padding:10px 12px;border-radius:7px;margin-bottom:14px;font-weight:700}.metrics{display:grid;grid-template-columns:repeat(${isFutures ? 6 : 5},1fr);gap:12px}.metric,.card{background:linear-gradient(145deg,#0d1b2b,#091522);border:1px solid var(--line);border-radius:8px}.metric{padding:15px;min-height:102px}.metric small,.card small{color:var(--muted);display:block}.metric b{display:block;font-size:24px;margin:6px 0;color:var(--text)}.metric p{margin:0;color:var(--muted);font-size:11px;line-height:1.4}.grid{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(290px,.9fr);gap:12px;margin-top:12px}.card{padding:14px}.card h2{font-size:15px;margin:0 0 4px}.hint{color:var(--muted);font-size:11px;margin:0 0 12px}.chart{height:270px;border:1px solid #1b3651;border-radius:5px;background:repeating-linear-gradient(0deg,transparent 0 48px,#12263c 49px 50px),repeating-linear-gradient(90deg,transparent 0 80px,#12263c 81px 82px);position:relative;overflow:hidden}.chart svg{width:100%;height:100%}.chart-label{position:absolute;left:12px;top:10px;color:var(--muted);font-size:12px}.action{display:grid;gap:8px;margin-top:14px}.action button{border:0;border-radius:6px;background:var(--accent);color:#06121c;padding:11px;font-weight:900;cursor:pointer}.action button.alt{background:#173149;color:var(--text);border:1px solid #2d5575}.action button.sell{background:#6e3142;color:#ffe7ec}.action button:disabled{opacity:.55;cursor:not-allowed}.bottom{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px;margin-top:12px}.rows{display:grid;gap:8px}.row{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:6px;padding:8px;border-bottom:1px solid #14263a;color:var(--muted);font-size:12px}.row strong{color:var(--text)}.empty{padding:26px 6px;color:var(--muted);text-align:center}.large{font-size:20px}.good{color:var(--good)}.bad{color:var(--bad)}.last{color:var(--muted);font-size:11px;text-align:right;margin-top:8px}@media(max-width:1100px){.layout{grid-template-columns:1fr}aside{display:none}.metrics{grid-template-columns:repeat(2,1fr)}.grid,.bottom{grid-template-columns:1fr}}@media(max-width:520px){header{padding:0 12px}.brand{font-size:15px}.pills .pill:last-child{display:none}main{padding:10px}.metric b{font-size:18px}.chart{height:190px}}
</style></head><body><header><div class="brand">${title.replace(" · PAPER", "")} <em>· PAPER</em></div><div class="pills"><span id="connection" class="pill">시세 연결 중</span><span class="pill">BLACK PC 로컬 서버</span></div></header><div class="layout"><aside><div class="nav active">▣ 대시보드</div><div class="nav">◉ 시장 상태</div><div class="nav">◈ 가상 주문</div><div class="nav">◷ 거래 기록</div><div class="nav">⚙ 쉬운 설정</div><div class="side-note">PAPER 전용<br>실제 계정·실제 주문 연결 없음<br>모든 돈 표시는 원화 기준</div></aside><main><div class="notice">⚠ 가상 연습장입니다 · 실제 돈은 절대 움직이지 않습니다 · 어려운 용어는 아래에 쉬운 뜻을 함께 표시합니다</div><section class="metrics"><section class="metric"><small>처음 넣은 가상 돈</small><b id="initial">-</b><p>연습을 위해 정한 시작 금액</p></section><section class="metric"><small>지금 가진 가상 돈</small><b id="equity">-</b><p>현금과 보유 코인을 모두 합친 값</p></section><section class="metric"><small>번 돈 / 잃은 돈</small><b id="pnl">-</b><p>이미 끝난 가상 거래의 결과</p></section>${futureBlocks}</section><section class="grid"><section class="card"><h2>BTC 현재 가격 <span id="price" class="good"></span></h2><p class="hint">1분마다 가격이 어떻게 움직였는지 보여주는 그래프 · 초록은 올랐고 빨강은 내렸다는 뜻</p><div class="chart"><span class="chart-label" id="chartHint">시세를 기다리는 중</span><svg id="chartSvg" viewBox="0 0 1000 270" preserveAspectRatio="none"></svg></div><div class="last" id="priceInfo">-</div></section><section class="card"><h2>지금 할 수 있는 가상 연습</h2><p class="hint">실제 돈은 사용하지 않습니다</p><div class="action"><button id="primary" onclick="paperOrder('buy')">가상으로 사 보기</button>${futureButton}<button class="alt" onclick="resetAccount()">가상 계좌 처음부터 다시 시작</button></div><div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px"><small>가상 한 번 거래 금액</small><b id="orderAmount" class="large">-</b><p class="hint">설정은 다음 단계에서 바꿀 수 있습니다</p></div></section></section><section class="bottom"><section class="card"><h2>현재 보유 상태</h2><p class="hint">현재 가진 코인과 손익</p><div id="position" class="empty">지금 보유한 가상 코인이 없습니다</div></section><section class="card"><h2>${cardTitle}</h2><p class="hint">${cardHint}</p><div id="riskBox" class="rows"></div></section><section class="card"><h2>최근 가상 거래</h2><p class="hint">실제 주문은 하나도 전송하지 않습니다</p><div id="trades" class="empty">아직 가상 거래가 없습니다</div></section></section></main></div><script>${script}</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && (pathname === "/" || pathname === `/${kind}` || pathname === `/binance/${kind}`)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(shell()); return;
  }
  if (req.method === "GET" && (pathname === "/api/state" || pathname.endsWith("/api/state"))) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(apiState())); return;
  }
  if (req.method === "POST" && (pathname === "/api/order" || pathname.endsWith("/api/order"))) {
    let body = ""; for await (const chunk of req) body += chunk;
    try { const { action } = JSON.parse(body || "{}"); order(action); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, state: apiState() })); }
    catch (error) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "가상 주문 처리 실패" })); }
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("찾을 수 없는 로컬 PAPER 주소입니다");
});

refreshMarket(); setInterval(refreshMarket, 2_000).unref();
server.listen(port, "127.0.0.1", () => console.log(`[${new Date().toISOString()}] ${title} local PAPER server listening on 127.0.0.1:${port}`));
