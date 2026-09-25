import { command, boot, subscribe, exportRecords } from "./runtime.js";
import { parseMoney, groupedMoneyInput, money, moneyLabel, formatMoneyField } from "./money-format.js";
import { rankMarkets, sortMarketRows } from "./market-ranking.js";
import { TradingChart } from "./trading-chart.js";
import { periodLabel } from "./indicators.js";
import { percentValue } from "./order-math.js";
import { workspaceMode, apiRoot, setupWorkspace, renderWorkspace } from "./workspace.js";
const $ = (id) => document.getElementById(id);
let state = null,
  csrf = "",
  side = "buy",
  sellPct = 100,
  source,
  toastTimer,
  visibleCandles = 90,
  hover = null,
  sort = "volume",
  lastMarketRender = 0,
  busy = false,
  startPending = false,
  judgmentPending = false,
  selectedPercent = null;
const won = (x) =>
  Number.isFinite(Number(x))
    ? Number(x).toLocaleString("ko-KR", {
        maximumFractionDigits: Number(x) < 10 ? 4 : Number(x) < 100 ? 2 : 0,
      })
    : "—";
const fixed = (x, n = 2) =>
  x === null || x === undefined ? "—" : Number(x).toFixed(n);
const pct = (x) =>
  x === null || x === undefined ? "—" : (x * 100).toFixed(1) + "%";
const tm = (x) =>
  x ? new Date(x).toLocaleTimeString("ko-KR", { hour12: false }) : "—";
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const signed = (x) => (x > 0 ? "+" : "") + won(x);
const color = (x) => (x > 0 ? "up" : x < 0 ? "down" : "");
function toast(text, error = false) {
  $("toast").textContent = text;
  $("toast").className = "toast" + (error ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 6500);
}
async function api(path,data={}) {const x=await command(path,data);if(x.engine){state=x;render();renderWorkspace(state);}return x;}

async function act(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy = false;
  }
}
function showSettings() {
  const e = state.engine;
  for (const key of Object.keys(configLabels))
    $("cfg-" + key).value = (key.endsWith("Probability") || key.endsWith("Score"))
      ? e.config[key] * 100
      : key.endsWith("Bps")
        ? e.config[key] / 100
        : e.config[key];
  document.querySelectorAll("[data-money]").forEach(formatMoneyField);
  $("strategyPrompt").value = e.prompt;
  $("settingsDialog").showModal();
}
const scoreNames = {
  quote_environment: [
    "주문하기 어려움",
    "물량이나 가격이 불안정함",
    "보통",
    "물량과 가격이 안정적임",
  ],
  inventory_pressure: [
    "팔아야 할 위험 거의 없음",
    "약간 주의",
    "줄여야 할 위험 높음",
    "빠른 정리가 필요함",
  ],
  execution_health: [
    "데이터나 주문 확인에 문제 있음",
    "확인할 정보가 부족함",
    "정상적으로 처리 가능함",
    "실제 체결까지 좋게 확인됨",
  ],
};
const configLabels = {
  strategyEnabled: ["매매 방식", 1],
  autoScan: ["모의 자동 종목 탐색", 1],
  entryScore: ["종합 매수 기준 (100점 만점 · 연구 설정)", 1],
  weaknessExitScore: ["흐름 약화 매도 기준 (100점 만점)", 1],
  atrMultiplier: ["초기 손절 여유 (평소 흔들림의 배수)", 0.1],
  trailAtrMultiplier: ["오른 가격을 따라갈 손절 여유 (배수)", 0.1],
  crashBps: ["최근 5초 급락 시 청산 (%)", 0.01],
  pendingTimeoutSeconds: ["미체결 주문 취소 확인 시작 (초)", 1],
  orderKrw: ["기본 주문 테스트 금액 (원) · 자동투자는 근거별 비율 사용", 1],
  maxPositionKrw: ["코인을 가지고 있을 최대 금액 (원)", 1],
  dailyLossKrw: ["하루 손실 한도 (원)", 1],
  maxDrawdownPct: ["자산이 최고점에서 줄어들면 멈춤 (%)", 0.1],
  stopLossPct: ["절대 손실 한도 (%) · 실제 체결가는 달라질 수 있음", 0.1],
  takeProfitPct: ["기존 방식 전용: 고정 익절 (%)", 0.1],
  maxHoldSeconds: ["기존 방식 전용: 최대 보유시간 (초)", 1],
  cooldownSeconds: ["자동 주문 사이 최소 시간 (초)", 1],
  intervalSeconds: ["Jev 갱신 간격 (초)", 1],
  horizonSeconds: ["방향 전망 구간 (초 · 갱신 간격과 별개)", 1],
  feePct: ["모의 매수·매도 각각의 수수료 (%)", 0.001],
  slippageBps: ["시장가 모의체결의 추가 가격 차이 (%)", 0.001],
  maxSpreadBps: ["살 가격·팔 가격 차이 허용치 (%)", 0.001],
  entryProbability: ["기존 방식 전용: 상승 판단 매수 (%)", 1],
  exitProbability: ["기존 방식 전용: 하락 판단 매도 (%)", 1],
};
$("configFields").innerHTML = Object.entries(configLabels)
  .map(
    ([k, [label, step]]) =>
      ["strategyEnabled","autoScan"].includes(k)
      ? '<label>'+label+'<select id="cfg-'+k+'"><option value="1">'+(k==='strategyEnabled'?'1분 흐름 전략':'ON · 보유 없을 때 후보로 전환')+'</option><option value="0">'+(k==='strategyEnabled'?'기존 고정 목표 방식':'OFF · 선택한 종목 유지')+'</option></select></label>'
      : "<label>" +
      label +
      '<input ' + (k.endsWith('Krw') ? 'type="text" inputmode="numeric" data-money' : 'type="number"') + ' id="cfg-' +
      k +
      '" step="' +
      step +
      '" required></label>',
  )
  .join("");
function renderStrategy() {
  const e=state.engine,s=e.features?.strategy, risk=e.safety, intent=risk?.intent;
  const labels={ENTRY:'매수 기회',WATCH:'관찰 중',HOLD:'보유 유지',WEAKEN:'상승 힘 약해짐',EXIT:'청산 중'};
  $('strategyMode').textContent='직원별 편집 근거 · 모의/실전 공통';
  $('entryState').textContent=labels[e.action.state] || (e.account?.mark?.quantity>0?'보유 감시':'진입 대기');
  $('entryDetail').textContent=s?.ready?'가격 흐름 '+fixed(s.groups.trend*100,0)+' · 매수세 '+fixed(s.groups.flow*100,0)+' · 순간 힘 '+fixed(s.groups.impulse*100,0)+'점':s?.reason||'시장 자료 준비 중';
  $('holdState').textContent=s?.ready?'흐름 약화 '+fixed(s.weakness*100,0)+' / 100점':'흐름 확인 대기';
  $('holdDetail').textContent='Jev 매도근거와 별도 위험 감시로 보유·청산 판단';
  $('safetyState').textContent=risk?.status||'정지';
  $('safetyDetail').textContent=intent&&intent.phase!=='complete'?'남은 봇 수량 '+fixed(e.account?.quantity,8)+' · '+intent.reason:risk?.risk?'현재 손절 기준 '+moneyLabel(risk.risk.stopNet/(1-e.config.feePct/100))+' · 수수료 반영':'최대 손실 '+e.config.stopLossPct+'% · Jev와 별도 감시';
  $('scanState').textContent=e.strategy?.scanning?'새 종목 자료 준비 중':e.strategy?.autoScan?(Number(e.account?.quantity)>0?'보유 중 · 현재 종목 유지':e.account?.pending||e.tracking?.active?'주문 확인 중 · 현재 종목 유지':'1위 자동 따라가기 ON · 포지션 없을 때 전환'):'자동 탐색 OFF';
  const inv=e.investment;
  $('investmentDetail').textContent=inv?'주문가능 '+moneyLabel(inv.availableKrw,0)+' · 목표 '+fixed(inv.targetPct,1)+'% → 적용 '+fixed(inv.ratioPct,1)+'% · '+moneyLabel(inv.amount,0)+' · '+inv.reason:'매수 조건을 충족하면 주문가능 원화와 근거별 비율로 계산합니다.';
  $('evidenceResults').replaceChildren(...(e.action.evidence||[]).map(r=>{const li=document.createElement('li');li.textContent=r.text+' — '+({supported:'충족',opposed:'반대',unknown:'자료 부족'}[r.status]||'대기')+' · 충족 판단 '+fixed(r.support*100,1)+'%';return li;}));
  const candidates=e.strategy?.candidates||[];
  $('scanCandidates').innerHTML=candidates.length?candidates.slice(0,5).map((x,i)=>'<li>'+ (i+1)+'. '+esc(x.name)+' <b>'+fixed(x.score,0)+'점</b> · 최근 1분 '+moneyLabel(x.activity.recentKrw,0)+'</li>').join(''):'<li>시장 자료 약 2분 수집 중 · 최신 시세·투자유의 제외 조건 적용</li>';
  $('strategyMetrics').innerHTML=s?.ready?[
    ['최근 1분 거래금액',moneyLabel(s.turnover60s,0)],
    ['완성된 봉 거래금액 증가',fixed(s.turnoverGrowth)+'배'],
    ['최근 5초 매수 체결 비중',pct(s.fastBuyShare)],
    ['평소 1분 가격 흔들림 (ATR)',moneyLabel(s.atr)],
    ['가격 흐름',({trend:'추세가 이어짐',range:'오르내림 반복',volatile:'크게 흔들림'})[s.regime]],
    ['직전 고점',s.breakout?'돌파 중':s.highFailure?'돌파 뒤 밀림':'관찰 중']
  ].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join(''):'';
}
function render() {
  if (!state) return;
  const e = state.engine,
    m = state.market,
    a = e.account,
    f = e.features,
    t = m.ticker;
  document.body.classList.toggle("live-mode", e.mode === "live");
  $("paperMode").className = e.mode === "paper" ? "selected" : "";
  $("liveMode").className = e.mode === "live" ? "selected live" : "";
  $("feedStatus").textContent = m.status;
  $("feedDot").className =
    "dot " + (f && f.bookAgeMs < 3000 ? "connected" : "bad");
  $("dataAge").textContent = f
    ? "호가 수신 후 " +
      Math.max(0, Math.round(state.at - (m.book?.receivedAt || state.at))) +
      "ms"
    : "";
  $("modeNotice").textContent =
    e.mode === "paper"
      ? "실제 업비트 시세 · 가상 자금으로 거래합니다"
      : e.armed
        ? "실전 주문 활성화 · 실제 원화가 사용됩니다"
        : "실전 화면 · 주문 잠금";
  $("clock").textContent = tm(state.at);
  $("accountLabel").textContent =
    e.mode === "paper" ? "모의 계좌" : "실전 봇 운용 계좌";
  $("capitalBtn").innerHTML =
    (a ? moneyLabel(a.initial, 0) : "시작금 설정") + " <span>↗</span>";
  $("equity").innerHTML = a?.mark
    ? moneyLabel(a.mark.equity, 0)
    : "—";
  $("pnl").textContent = a?.mark
    ? moneyLabel(a.mark.pnl) +
      " (" +
      signed(Number(a.mark.pnlPct.toFixed(2))) +
      "%)"
    : "—";
  $("pnl").className = color(a?.mark?.pnl || 0);
  $("cash").textContent = a ? moneyLabel(a.cash, 0) : "—";
  $("realized").textContent = a
    ? moneyLabel(a.realized) + " / " + moneyLabel(a.fees)
    : "—";
  const name =
    m.markets.find((x) => x.market === m.symbol)?.korean_name || m.symbol;
  const coin = m.symbol.split("-")[1];
  $("marketName").innerHTML =
    esc(name) + " <small>" + esc(coin) + "/KRW</small>";
  $("coinIcon").textContent = coin === "BTC" ? "₿" : coin.slice(0, 1);
  if (t) {
    $("price").textContent = won(t.trade_price);
    $("price").className = color(t.signed_change_rate);
    $("change").textContent =
      (t.signed_change_rate > 0 ? "+" : "") +
      fixed(t.signed_change_rate * 100) +
      "%  " +
      signed(t.signed_change_price);
    $("change").className = color(t.signed_change_rate);
    $("high").textContent = won(t.high_price);
    $("low").textContent = won(t.low_price);
    $("volume").textContent = money(t.acc_trade_volume_24h, 3) + " " + coin;
    $("turnover").textContent = moneyLabel(t.acc_trade_price_24h, 0);
  } else {
    for (const id of ["price", "change", "high", "low", "volume", "turnover"])
      $(id).textContent = "—";
  }
  $("chartEmpty").style.display = m.candles.length ? "none" : "grid";
  document
    .querySelectorAll("[data-unit]")
    .forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.unit) === m.units),
    );
  $("chartTime").textContent = periodLabel(m.units) + " 봉 · 한국시간";
  drawChart();
  renderBook(m.book);
  if (Date.now() - lastMarketRender > 1500) {
    renderMarkets();
    lastMarketRender = Date.now();
  }
  $("available").textContent = a
    ? side === "buy"
      ? moneyLabel(e.manualBuyingPower ?? 0, 0) + " · 한도·수수료 반영"
      : fixed(a.quantity, 8) + " " + coin
    : "시작금을 설정하세요";
  $("feeHint").textContent =
    e.mode === "paper"
      ? e.config.feePct + "% / " + (e.config.slippageBps / 100).toFixed(3) + "%"
      : "업비트 실제 수수료";
  $("limitHint").textContent =
    "근거별 비율 투자 / " + moneyLabel(e.config.maxPositionKrw, 0);
  $("submitOrder").textContent =
    (e.mode === "paper" ? "모의 " : "실전 ") +
    (side === "buy" ? "추적 매수" : "추적 매도");
  $("submitOrder").className = side === "buy" ? "buy-button" : "sell-button";
  $("submitOrder").disabled =
    !a ||
    e.running ||
    e.orderBusy ||
    e.tracking?.active ||
    e.tracking?.busy ||
    !!e.livePending ||
    (e.mode === "live" && !e.armed);
  $("orderNote").innerHTML =
    e.mode === "paper"
      ? "지금 나온 물량의 10%로 모의 거래 · 안 된 나머지만 다시 주문<br>완료/중지까지 계속 · 최소 주문금액 미만 잔여액은 남습니다."
      : "지금 가능한 가격에 주문 → 안 된 부분 취소 확인 → 나머지 즉시 재주문<br>완료/중지까지 계속 · 통신 결과 미확정 시 재전송하지 않습니다.";
  renderOrderDetails();
  $("botState").textContent = e.running
    ? "매매 실행 중"
    : e.judgmentRunning
      ? "판단만 실행 중"
      : "정지";
  $("judgmentToggle").textContent = judgmentPending
    ? "Jev 연결 확인 중…"
    : e.judgmentRunning
      ? "실시간 판단 ON"
      : "실시간 판단 OFF";
  $("judgmentToggle").setAttribute("aria-pressed", String(!!e.judgmentRunning));
  $("judgmentHint").textContent =
    "갱신 " +
    e.config.intervalSeconds +
    "초 · 전망 " +
    e.config.horizonSeconds +
    "초 · " +
    (e.running ? "자동 주문 ON" : "자동 주문 OFF") +
    " · 오늘 " +
    e.calls.count +
    "회 · 횟수 제한 없음";
  $("botDot").className = "dot " + (e.running ? "connected" : "");
  $("startBtn").textContent = e.startRequested ? "자료 준비 중 · 자동 시작 대기" : startPending || e.startBusy
    ? "Jev 연결 확인·시작 중…"
    : e.mode === "live" && !e.armed
      ? "실전 활성화"
      : "자동매매 시작";
  $("startBtn").disabled =
    e.running || e.startRequested || e.startBusy || startPending || !!e.tracking?.active || !!e.tracking?.busy;
  $("analyzeBtn").disabled = e.analysisBusy || !e.keys.jev;
  $("analyzeBtn").textContent = e.analysisBusy ? "분석 중…" : "1회 분석";
  $("pendingTools").classList.toggle("hidden", !e.livePending);
  $("pendingStatus").textContent = e.livePending
    ? "실전 주문 확인 필요: " + e.livePending.status
    : "";
  $("actionReason").textContent = e.action.reason;
  $("jevConnected").textContent = e.keys.jev
    ? "실제 응답 검증됨"
    : e.jevKeyLoaded
      ? "키 저장됨 · 시작 시 자동 검증"
      : "연결 필요";
  $("upbitConnected").textContent = e.keys.upbit ? "인증 확인됨" : "미연결";
  renderStrategy();
  renderJev();
  renderMetrics();
  renderHistory();
  $("holdings").innerHTML = a?.mark
    ? "<b>" +
      esc(name) +
      " / " +
      esc(coin) +
      "</b><dl><div><dt>보유수량</dt><dd>" +
      fixed(a.quantity, 8) +
      "</dd></div><div><dt>수수료 포함 매입단가</dt><dd>" +
      moneyLabel(a.mark.averagePrice) +
      "</dd></div><div><dt>보유 평가금액</dt><dd>" +
      moneyLabel(a.mark.positionKrw) +
      "</dd></div><div><dt>오늘 손익</dt><dd>" +
      moneyLabel(a.mark.dailyPnl) +
      "</dd></div><div><dt>최대점 대비 낙폭</dt><dd>" +
      fixed(a.mark.drawdownPct) +
      "%</dd></div></dl>"
    : "시작금을 설정하세요.";
  $("eventLog").innerHTML = e.events
    .slice(0, 30)
    .map((x) => "<div><time>" + tm(x.at) + "</time><span>" + esc(x.text) + "</span></div>")
    .join("");
  $("clockOffset").textContent = m.clockVerified
    ? "업비트 서버 시각 보정 " +
      fixed(m.clockOffsetMs / 1000, 1) +
      "초 · PC 시계 변경 없음"
    : "시각 검증 대기";
  $("archiveList").innerHTML = e.archives.length
    ? "<b>보관된 계좌 " +
      e.archives.length +
      "개</b>" +
      e.archives
        .slice(-6)
        .reverse()
        .map(
          (x) =>
            "<div>" +
            new Date(x.createdAt).toLocaleDateString("ko-KR") +
            " · " +
            esc(x.market) +
            " · " +
            moneyLabel(x.initial, 0) +
            " · " +
            x.trades +
            "건</div>",
        )
        .join("")
    : "";
  $("liveChecks").innerHTML =
    "TypeSafe: " +
    (e.keys.jev ? "연결됨" : "연결 필요") +
    "<br>업비트: " +
    (e.keys.upbit ? "인증됨" : "연결 필요") +
    "<br>주문 테스트: " +
    (e.liveTest ? tm(e.liveTest.at) + " 통과" : "필요") +
    "<br>미확정 주문: " +
    (e.livePending ? esc(e.livePending.status) : "없음");
}
function renderBook(book) {
  const rows = book?.orderbook_units?.slice(0, 6) || [];
  const max = Math.max(1, ...rows.flatMap((r) => [r.ask_size, r.bid_size]));
  $("asks").innerHTML = [...rows]
    .reverse()
    .map(
      (r) =>
        '<div class="book-row ask"><span class="depth-cell"><i class="depth-fill" style="width:' +
        (r.ask_size / max) * 100 +
        '%"></i>' +
        fixed(r.ask_size, 4) +
        '</span><span class="price">' +
        won(r.ask_price) +
        "</span><span></span></div>",
    )
    .join("");
  $("bids").innerHTML = rows
    .map(
      (r) =>
        '<div class="book-row bid"><span></span><span class="price">' +
        won(r.bid_price) +
        '</span><span class="depth-cell"><i class="depth-fill" style="width:' +
        (r.bid_size / max) * 100 +
        '%"></i>' +
        fixed(r.bid_size, 4) +
        "</span></div>",
    )
    .join("");
  $("midPrice").textContent = state.engine.features
    ? won(state.engine.features.mid)
    : "—";
  $("spread").textContent =
    "살 가격·팔 가격 차이 " + fixed((state.engine.features?.spreadBps ?? 0) / 100, 3) + "%";
  $("bookTotal").innerHTML =
    "<span>매도 " +
    fixed(book?.total_ask_size, 4) +
    "</span><span>매수 " +
    fixed(book?.total_bid_size, 4) +
    "</span>";
}
function marketRankDetail(x) {
  if (sort === 'value') return '<small class="ranking-detail" title="' + esc(x.watchReason) + '">' +
    (x.watchScore === null ? esc(x.watchReason) : x.watchScore + '점 · 1분 ' + moneyLabel(x.activity.recentKrw, 0) +
      ' · 거래 ' + (x.activity.growthRatio === null ? '비교 불가' : fixed(x.activity.growthRatio, 1) + '배') +
      ' · 1분 가격 ' + fixed(x.activity.returnPct, 2) + '%') + '</small>';
  if (sort === 'recent') return '<small class="ranking-detail">' + (x.activity?.ready ? '1분 ' + moneyLabel(x.activity.recentKrw, 0) : esc(x.activity?.reason || '집계 중')) + '</small>';
  return '';
}
function renderMarkets() {
  if (!state) return;
  const q = $("search").value.toLowerCase();
  const ranked = rankMarkets(state.market.markets);
  const rows = sortMarketRows(ranked.filter(x =>
    (x.market + ' ' + x.korean_name + ' ' + x.english_name).toLowerCase().includes(q)), sort);
  const readyCount = ranked.filter(x => sort === 'value' ? x.watchScore !== null : x.activity?.ready).length;
  $('sortDescription').textContent = sort === 'value'
    ? '단타 관찰용 참고 점수 · 준비 ' + readyCount + '/' + ranked.length + '종목 · 수익률·승률 아님'
    : sort === 'recent' ? '최근 1분 거래대금(원) · 준비 ' + readyCount + '/' + ranked.length + '종목 · 처음 1분은 집계 중'
    : sort === 'change' ? '전일 종가 대비 상승률이 높은 순서' : '최근 24시간 원화 거래대금이 많은 순서';
  $("marketCount").textContent = rows.length + " 종목";
  $("marketList").innerHTML = rows
    .map(
      (x) =>
        '<button class="market-row ' +
        (x.market === state.market.symbol ? "selected" : "") +
        '" data-market="' +
        esc(x.market) +
        '"><span>' +
        esc(x.korean_name) +
        "<small>" +
        esc(x.market.split("-")[1]) +
        '/KRW</small>' + marketRankDetail(x) + '</span><span class="' +
        color(x.ticker?.signed_change_rate || 0) +
        '">' +
        (x.ticker ? won(x.ticker.trade_price) : "—") +
        '</span><span class="' +
        color(x.ticker?.signed_change_rate || 0) +
        '">' +
        (x.ticker
          ? (x.ticker.signed_change_rate > 0 ? "+" : "") +
            fixed(x.ticker.signed_change_rate * 100) +
            "%"
          : "—") +
        "</span></button>",
    )
    .join("");
}
const labels = {
  regime: "시장 흐름",
  direction: "방향 판단",
  toxic_flow: "산 뒤 불리해질 위험",
  liquidity_stressed: "거래 물량 부족 위험",
  quote_environment: "매물이 충분하고 고르게 나오는 정도",
  inventory_pressure: "계속 들고 있을 위험",
  execution_health: "거래 준비 상태 · 참고용",
};
const regimeNames = {
  trending: "추세",
  mean_reverting: "평균 회귀",
  high_vol: "고변동",
  crisis: "위기",
};
function renderJev() {
  const e = state.engine,
    d = e.decision;
  const stale =
    !d ||
    d.discarded ||
    Date.now() - d.at > Math.max(10000, e.config.intervalSeconds * 2000);
  $("jevStatus").textContent = e.analysisBusy
    ? "분석 중"
    : !e.keys.jev
      ? "연결 대기"
      : stale
        ? "판단 대기 / 만료"
        : "실제 Jev 응답";
  $("jevStatus").className = "badge " + (!stale ? "ok" : "");
  $("jevModel").textContent = d ? d.model : "TypeSafe 직접 연결";
  $("jevLatency").textContent = d ? d.latencyMs + "ms" : "— ms";
  const ans = !stale ? d.answers : null;
  const dirs = [
    ["up", "상승", "#d64145"],
    ["neutral", "중립", "#9aa8bc"],
    ["down", "하락", "#2465cb"],
  ];
  $("directionBars").innerHTML = dirs
    .map(
      ([k, label, c]) =>
        '<div class="prob-row"><span>' +
        label +
        '</span><div class="bar"><i style="width:' +
        (ans ? ans.direction.probabilities[k] * 100 : 0) +
        "%;background:" +
        c +
        '"></i></div><b style="color:' +
        c +
        '">' +
        (ans ? pct(ans.direction.probabilities[k]) : "—") +
        "</b></div>",
    )
    .join("");
  $("signalGrid").innerHTML =
    "<div>시장 흐름<strong>" +
    (ans ? regimeNames[ans.regime.choice] : "판단 대기") +
    "</strong></div><div>판단이 한쪽에 모인 정도<strong>" +
    (ans ? pct(ans.direction.confidence) : "—") +
    "</strong></div><div>산 뒤 불리해질 위험<strong>" +
    (ans ? pct(ans.toxic_flow.noul) : "—") +
    "</strong></div><div>거래 물량 부족 위험<strong>" +
    (ans ? pct(ans.liquidity_stressed.noul) : "—") +
    "</strong></div>";
  $("scoreList").innerHTML = [
    "quote_environment",
    "inventory_pressure",
    "execution_health",
  ]
    .map(
      (k) =>
        '<div class="score-row"><span>' +
        labels[k] +
        "</span><b>" +
        (ans ? fixed(ans[k].score, 2) + " / 3" : "—") +
        "</b></div>",
    )
    .join("");
  $("allProbabilities").innerHTML = d
    ? Object.entries(d.answers)
        .map(
          ([k, v]) =>
            "<p><b>" +
            labels[k] +
            "</b><br>" +
            (v.type === "noul"
              ? "예 " + pct(v.noul) + " / 아니오 " + pct(1 - v.noul)
              : Object.entries(v.probabilities)
                  .map(
                    ([name, p]) =>
                      esc(
                        scoreNames[k]?.[Number(name)] ||
                          regimeNames[name] ||
                          { up: "상승", down: "하락", neutral: "중립" }[name] ||
                          name,
                      ) +
                      ": " +
                      pct(p),
                  )
                  .join("<br>")) +
            "</p>",
        )
        .join("")
    : "실제 API 응답 후 표시됩니다.";
  $("jevTimestamp").textContent = d
    ? tm(d.at) +
      (d.discarded ? " · 사용 안 함" : stale ? " · 과거 응답" : " · 최신 응답")
    : "아직 분석하지 않았습니다.";
  $("jevBudget").textContent = "오늘 요청 " + e.calls.count + "회 · 제한 없음";
  $("directionTitle").textContent =
    "다음 " + (d?.horizonSeconds || e.config.horizonSeconds) + "초 가격 방향";
  $("decisionAction").textContent =
    (e.running ? "자동매매: " : "판단만 보기: ") +
    ({ buy: "매수 조건 충족", sell: "매도 조건 충족", hold: "기다리는 중" }[
      e.action.side
    ] || "확인 중");
  $("decisionReason").textContent = e.action.reason;
  const usage = e.usageSummary;
  $("usageDetails").innerHTML =
    [
      ["오늘 요청한 횟수", e.calls.count + "회"],
      ["AI가 읽은 글의 양", won(e.calls.inputTokens) + " 토큰"],
      [
        "AI가 답한 글의 양",
        won(e.calls.outputTokens || 0) + " 토큰 · 업데이트 이후",
      ],
      [
        "오늘 예상 비용",
        usage ? "약 $" + usage.estimatedUsd.toFixed(6) : "계산 중",
      ],
      ["계정 잔액·크레딧", "공개 조회 API 확인 안 됨"],
      ["계정 실제 청구액", "TypeSafe 계정에서 확인"],
    ]
      .map(
        ([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>",
      )
      .join("") +
    "<p class=small-note>예상 비용: 받은 입력 토큰 × 100만 토큰당 $0.042 (2026-09-24 확인). 실제 청구액·다른 앱 사용량·할인은 포함하지 않습니다.</p>";
}
function renderMetrics() {
  const f = state.engine.features;
  const items = f
    ? [
        ["살 물량·팔 물량의 치우침", fixed(f.imbalance * 100, 1) + "%"],
        ["바로 사들인 거래 비중 (최근 60초)", pct(f.buyVolumeShare)],
        [
          "많이 거래된 가격의 평균 (최근 60초)",
          f.vwap60s ? won(f.vwap60s) + "원" : "—",
        ],
        ["최근 60초 가격 변화", fixed(f.return60sBps / 100, 3) + "%"],
        ["오름·내림 힘 (최근 14개 1분 봉)", fixed(f.rsi14, 1)],
        ["최근 60초 실제 거래", f.tradeCount60s + "건"],
        ["분석 데이터 준비", f.warm ? "준비 완료" : "수신·검증 중"],
      ]
    : [["실시간 데이터", "수신 대기"]];
  $("metrics").innerHTML = items
    .map(
      ([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>",
    )
    .join("");
}
function renderHistory() {
  const e = state.engine,
    rows = e.account?.history || [];
  $("historyCount").textContent = rows.length;
  $("historyMode").textContent =
    e.mode === "paper" ? "실시세 기반 모의 체결" : "업비트 확인 체결";
  $("historyBody").innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            "<tr><td>" +
            tm(r.at) +
            "</td><td>" +
            esc(r.market) +
            '</td><td class="' +
            (r.side === "buy" ? "up" : "down") +
            '">' +
            (r.side === "buy" ? "매수" : "매도") +
            "</td><td>" +
            moneyLabel(r.price, Number(r.price) < 1 ? 8 : 2) +
            "</td><td>" +
            fixed(r.quantity, 8) +
            "</td><td>" + moneyLabel(r.funds, 2) +
            "</td><td>" +
            moneyLabel(r.fee, 2) +
            '</td><td class="' +
            color(Number(r.realized)) +
            '">' +
            moneyLabel(r.realized) +
            "</td><td>" +
            esc(r.reason) +
            "</td></tr>",
        )
        .join("")
    : '<tr><td colspan="9" class="empty">아직 거래가 없습니다. 실제 시세가 들어오면 모의 거래를 시작할 수 있습니다.</td></tr>';
}
const themeStorageKey = 'jev-spot-theme';
let savedTheme = 'light';
try { savedTheme = localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light'; } catch {}
if (workspaceMode) savedTheme = 'dark';
document.documentElement.dataset.theme = savedTheme;
const tradingChart = new TradingChart();
function applyTheme(value, persist = true) {
  const theme = workspaceMode || value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  tradingChart.setTheme(theme);
  $('themeSelect').value = theme;
  $('themeToggle').setAttribute('aria-pressed', String(theme === 'dark'));
  $('themeToggle').textContent = theme === 'dark' ? '밝은 화면' : '다크모드';
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? '밝은 화면으로 변경' : '다크모드로 변경');
  if (persist) {
    try { if (!workspaceMode) localStorage.setItem(themeStorageKey, theme); }
    catch { toast('화면 색상은 바뀌었지만 저장하지 못했습니다. 다음 실행 때 다시 선택하세요.', true); }
  }
}
$('themeToggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('themeSelect').onchange = () => applyTheme($('themeSelect').value);
window.addEventListener('storage', e => {
  if (e.key === themeStorageKey || e.key === null) applyTheme(e.newValue, false);
});
applyTheme(savedTheme, false);
function drawChart() {
  if (state) tradingChart.update(state.market);
}
$("search").oninput = renderMarkets;
$('sortMarkets').onchange = () => {
  sort = $('sortMarkets').value;
  try { localStorage.setItem('jev-market-sort', sort); } catch {}
  renderMarkets();
};
try { const saved = localStorage.getItem('jev-market-sort'); if (['volume','change','recent','value'].includes(saved)) sort = saved; } catch {}
$('sortMarkets').value = sort;
$("marketList").onclick = (e) => {
  const b = e.target.closest("[data-market]");
  if (b) act(() => api("market", { market: b.dataset.market }));
};
$("intervals").onclick = (e) => {
  const b = e.target.closest("[data-unit]");
  if (b) act(() => api("candles", { units: Number(b.dataset.unit) }));
};
$("settingsBtn").onclick = showSettings;
$("capitalBtn").onclick = () => {
  if (state.engine.mode === "live") {
    if (state.engine.account)
      $("liveCapital").value = groupedMoneyInput(state.engine.account.initial);
    formatMoneyField($("liveCapital"));
    formatMoneyField($("liveCapital"));
      $("liveDialog").showModal();
  } else {
    $("paperCapital").value = groupedMoneyInput(state.engine.account?.initial || "");
    formatMoneyField($("paperCapital"));
    $("paperDialog").showModal();
  }
};
$("paperMode").onclick = () => act(() => api("mode", { mode: "paper" }));
$("liveMode").onclick = () =>
  act(async () => {
    await api("mode", { mode: "live" });
    toast("실전 화면으로 전환했습니다. 주문은 잠겨 있습니다.");
  });
$("paperForm").onsubmit = (e) => {
  e.preventDefault();
  act(async () => {
    await api("paper", { capital: parseMoney($("paperCapital").value) });
    $("paperDialog").close();
    toast("입력한 금액으로 새 모의계좌를 만들었습니다.");
  });
};
document.querySelectorAll("[data-capital]").forEach(
  (b) =>
    (b.onclick = () => {
      $("paperCapital").value = groupedMoneyInput(b.dataset.capital);
      formatMoneyField($("paperCapital"));
    }),
);
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
document.querySelectorAll("[data-pane]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-pane]")
        .forEach((x) => x.classList.toggle("active", x === b));
      for (const p of ["keysPane", "strategyPane"])
        $(p).classList.toggle("hidden", p !== b.dataset.pane);
    }),
);
$("jevKeyForm").onsubmit = (e) => {
  e.preventDefault();
  act(async () => {
    await api("keys/jev", {
      key: $("jevKey").value,
      save: $("saveJev").checked,
    });
    $("jevKey").value = "";
    toast("실제 Jev 응답을 확인했습니다.");
  });
};
$("upbitKeyForm").onsubmit = (e) => {
  e.preventDefault();
  act(async () => {
    await api("keys/upbit", {
      access: $("upbitAccess").value,
      secret: $("upbitSecret").value,
      save: $("saveUpbit").checked,
    });
    $("upbitAccess").value = "";
    $("upbitSecret").value = "";
    toast("업비트 인증 확인 완료. 실전 주문은 잠금 상태입니다.");
  });
};
$("strategyPane").onsubmit = (e) => {
  e.preventDefault();
  act(async () => {
    const config = Object.fromEntries(
      Object.keys(configLabels).map((k) => [
        k,
        (k.endsWith("Krw") ? parseMoney($("cfg-" + k).value) : Number($("cfg-" + k).value)) *
          ((k.endsWith("Probability") || k.endsWith("Score")) ? 0.01 : k.endsWith("Bps") ? 100 : 1),
      ]),
    );
    await api("config", { config, prompt: $("strategyPrompt").value });
    $("settingsDialog").close();
    toast("전략과 한도를 저장했습니다.");
  });
};
$("testLiveBtn").onclick = () =>
  act(async () => {
    await api("live/test");
    toast("실제 주문 없이 업비트 주문 테스트를 통과했습니다.");
  });
$("liveForm").onsubmit = (e) => {
  e.preventDefault();
  act(async () => {
    await api(e.submitter?.value === "manual" ? "live/arm" : "start", {
      capital: parseMoney($("liveCapital").value),
      phrase: $("livePhrase").value,
    });
    $("livePhrase").value = "";
    $("liveDialog").close();
    toast(e.submitter?.value === "manual" ? "실전 수동 주문이 준비됐습니다. 매수·매도 버튼으로 주문하세요." : "실전 자동매매 시작 요청을 처리했습니다. 화면에서 실행 상태를 확인하세요.");
  });
};
$("startBtn").onclick = () =>
  act(async () => {
    if (state.engine.mode === "live" && !state.engine.account) {
      if (state.engine.account)
        $("liveCapital").value = groupedMoneyInput(state.engine.account.initial);
      formatMoneyField($("liveCapital"));
      $("liveDialog").showModal();
      return;
    }
    startPending = true;
    render();
    try {
      await api("start", {capital: state.engine.mode === "live" ? Number(state.engine.account?.initial) : undefined});
      toast(state.engine.startRequested ? "시작 요청을 받았습니다. 자료가 준비되면 자동으로 시작합니다." : "Jev 자동매매를 시작했습니다.");
    } finally {
      startPending = false;
      render();
    }
  });
$("stopBtn").onclick = async () => {
  try {
    await api("stop");
    toast("자동매매를 정지했습니다. 보유자산은 유지됩니다.");
  } catch (e) {
    toast(e.message, true);
  }
};
$("analyzeBtn").onclick = () => act(() => api("analyze"));
$("judgmentToggle").onclick = async () => {
  if (state.engine.judgmentRunning || judgmentPending) {
    try {
      await api("judgment", { enabled: false });
      toast("실시간 판단 OFF · 자동매매도 정지했습니다.");
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  judgmentPending = true;
  render();
  try {
    await api("judgment", { enabled: true });
    toast("실시간 판단 ON · 자동 주문은 하지 않습니다.");
  } catch (err) {
    toast(err.message, true);
  } finally {
    judgmentPending = false;
    render();
  }
};
$("exportBtn").onclick = () => {
  exportRecords();
};
function selectSide(s) {
  side = s;
  $("holdings").classList.add("hidden");
  $("orderForm").classList.remove("hidden");
  $("buyTab").className = s === "buy" ? "active buy" : "";
  $("sellTab").className = s === "sell" ? "active" : "";
  $("holdingsTab").className = "";
  $("amountLabel").innerHTML =
    s === "buy" ? "살 금액 <small>원</small>" : "팔 금액 <small>원</small>";
  $("orderAmount").value =
    s === "buy"
      ? state.engine.config.orderKrw
      : Math.floor(
          Number(state.engine.account?.quantity || 0) *
            (state.market.book?.orderbook_units?.[0]?.bid_price || 0),
        );
  formatMoneyField($("orderAmount"));
  $("orderAmount").min = 5000;
  $("orderAmount").step = 1;
  sellPct = 100;
  selectedPercent = s === "sell" ? 100 : null;
  $("orderAmount").setAttribute(
    "aria-label",
    s === "buy" ? "살 금액" : "팔 금액",
  );
  render();
}
$("buyTab").onclick = () => selectSide("buy");
$("sellTab").onclick = () => selectSide("sell");
$("holdingsTab").onclick = () => {
  $("orderForm").classList.add("hidden");
  $("holdings").classList.remove("hidden");
  $("buyTab").className = "";
  $("sellTab").className = "";
  $("holdingsTab").className = "active";
};
$("percentButtons").onclick = (event) => {
  const button = event.target.closest("[data-pct]");
  if (!button || !state) return;
  selectedPercent = Number(button.dataset.pct);
  $("orderAmount").value = percentValue(
    side === "buy"
      ? state.engine.manualBuyingPower || 0
      : Number(state.engine.account?.quantity || 0) *
          (state.market.book?.orderbook_units?.[0]?.bid_price || 0),
    selectedPercent,
  );
  formatMoneyField($("orderAmount"));
  renderOrderDetails();
};
$("quickOrderAmounts").onclick = (event) => {
  const button = event.target.closest("[data-amount]");
  if (!button) return;
  selectedPercent = null;
  $("orderAmount").value = groupedMoneyInput(button.dataset.amount);
  formatMoneyField($("orderAmount"));
  renderOrderDetails();
};
$("orderAmount").oninput = () => {
  formatMoneyField($("orderAmount"));
  selectedPercent = null;
  renderOrderDetails();
};
function renderOrderDetails() {
  if (!state) return;
  const e = state.engine,
    a = e.account,
    b = state.market.book?.orderbook_units?.[0],
    price = b ? (side === "buy" ? b.ask_price : b.bid_price) : 0;
  const amount = parseMoney($("orderAmount").value),
    quantity =
      side === "sell" && selectedPercent !== null
        ? (Number(a?.quantity || 0) * selectedPercent) / 100
        : price
          ? amount / price
          : 0;
  $("trackingPrice").textContent = price
    ? won(price) +
      " 원 · " +
      (side === "buy" ? "최우선 매도호가" : "최우선 매수호가")
    : "호가 대기";
  $("orderEstimate").textContent =
    fixed(quantity, 8) + " " + state.market.symbol.split("-")[1];
  $("percentBasis").textContent =
    side === "buy"
      ? "비율 기준: 주문가능 " +
        won(e.manualBuyingPower || 0) +
        "원 · 자동 1회 금액으로 자르지 않음"
      : "비율 기준: 이 계좌 보유수량 · 처음 선택한 수량만 추적";
  document.querySelectorAll("[data-pct]").forEach((button) => {
    const chosen = Number(button.dataset.pct) === selectedPercent;
    button.classList.toggle("active", chosen);
    button.setAttribute("aria-pressed", String(chosen));
  });
  const t = e.tracking;
  $("trackingProgress").classList.toggle("hidden", !t);
  if (t) {
    $("trackingPhase").textContent =
      (t.side === "buy" ? "매수" : "매도") + " · " + t.phase;
    $("trackingTotals").textContent =
      t.attempts +
      "회 주문 · 체결 " +
      fixed(t.filled, 8) +
      "개 / " +
      moneyLabel(t.funds) +
      " · 남음 " +
      (t.side === "buy"
        ? moneyLabel(t.remaining)
        : fixed(t.remaining, 8) + "개");
    $("trackingStop").disabled = !t.active;
  }
  let warning = "";
  if (a && (!Number.isFinite(amount) || amount <= 0))
    warning = "주문 금액/비율을 입력하세요.";
  else if (a && side === "buy" && amount < 5000)
    warning = "선택 금액이 최소 주문금액 5,000원 미만입니다.";
  else if (a && side === "buy" && amount > (e.manualBuyingPower || 0))
    warning =
      "주문가능 금액을 초과합니다. 최대 보유 한도는 전략 설정에서 변경합니다.";
  else if (
    a &&
    side === "sell" &&
    (quantity > Number(a.quantity) || quantity * price < 5000)
  )
    warning = "보유량 또는 최소 매도금액 5,000원을 확인하세요.";
  $("orderValidation").textContent = warning;
}
$("trackingStop").onclick = () =>
  act(async () => {
    await api("stop");
    toast(
      "추적을 중지했습니다. 이미 보낸 주문의 거래·취소 결과는 계속 확인합니다.",
    );
  });
$("submitOrder").onclick = () =>
  act(async () => {
    await api("track", {
      side,
      amount: side === "buy" ? parseMoney($("orderAmount").value) : 0,
      sellPct:
        side === "sell" && selectedPercent !== null
          ? String(selectedPercent)
          : "100",
      sellAmount:
        side === "sell" && selectedPercent === null
          ? parseMoney($("orderAmount").value)
          : null,
    });
    toast("현재가 추적 주문 시작 · 미체결분만 계속 재주문합니다.");
  });
$("navHistory").onclick = () =>
  $("historyPanel").scrollIntoView({ behavior: "smooth" });
$("navExchange").onclick = () =>
  window.scrollTo({ top: 0, behavior: "smooth" });
$("analysisJump").onclick = () =>
  $("jevPanel").scrollIntoView({ behavior: "smooth" });
async function init(){try{state=await boot();render();renderWorkspace(state);subscribe(x=>{state=x;render();renderWorkspace(state);});}catch(e){const box=document.createElement('section');box.className='web-boot-error';const message=document.createElement('p');message.textContent='웹 매매 화면 시작 실패: '+e.message;const retry=document.createElement('button');retry.textContent='다시 준비하기';retry.onclick=()=>location.reload();box.append(message,retry);document.body.append(box);}}
document.querySelectorAll('[data-money]').forEach(input => {
  formatMoneyField(input);
  input.addEventListener('input', () => formatMoneyField(input));
});
setupWorkspace(api);
init();

$("reconcileBtn").onclick = () => act(() => api("reconcile"));
$("cancelPendingBtn").onclick = () => act(() => api("cancel"));

const glossary = [
  [
    "봉(캔들)",
    "일정 시간의 시작 가격, 최고 가격, 최저 가격, 마지막 가격을 막대로 보여줍니다. 빨강은 시작보다 오른 봉, 파랑은 내린 봉입니다.",
  ],
  [
    "평균선과 EMA9",
    "가격의 평균 흐름을 선으로 그립니다. EMA9는 최근 9개 봉을 보되 최근 가격에 더 무게를 줍니다. 차트 시간이 바뀌면 9개 봉이 뜻하는 시간도 바뀝니다.",
  ],
  [
    "주문표(호가)",
    "사람들이 사고팔려고 내놓은 가격과 물량입니다. 가장 낮은 팔 가격에 사거나, 가장 높은 살 가격에 팔면 빠르게 거래를 시도할 수 있습니다.",
  ],
  [
    "현재가 추적 주문",
    "누른 매수·매도 방향을 유지하며 남은 양만 계속 주문합니다. 바로 안 된 부분은 거래소에서 취소하고, 확인 후 새 가격으로 다시 주문합니다.",
  ],
  [
    "일부만 거래된 상태(부분 체결)",
    "10개를 주문해 3개만 거래됐다면 다음 주문은 남은 7개입니다. 이미 거래된 3개를 다시 주문하지 않습니다.",
  ],
  [
    "거래 가격 차이(슬리피지)",
    "예상했던 가격과 실제 거래 가격 사이의 차이입니다. 가격이 빠르게 움직이거나 물량이 적을 때 커질 수 있습니다.",
  ],
  [
    "이익·손해 계산",
    "평가손익은 지금 판다고 가정한 이익·손해이고, 실현손익은 실제로 팔아서 확정된 이익·손해입니다. 수수료도 반영합니다.",
  ],
  [
    "판단 퍼센트",
    "Jev가 상승·중립·하락 중 어디에 더 무게를 두는지 보여줍니다. 예를 들어 상승 70%는 돈을 벌 확률이 반드시 70%라는 뜻이 아닙니다.",
  ],
  [
    "판단만 ON과 자동매매",
    "판단만 ON은 분석 화면만 갱신합니다. 자동매매 시작은 판단과 주문을 함께 켭니다. 매매 종료는 둘 다 끕니다.",
  ],
  [
    "갱신 간격과 전망 구간",
    "갱신 1초는 새 판단을 요청하는 간격입니다. 전망 5초는 앞으로 5초 동안의 방향을 묻는 뜻입니다. API 응답이 늦으면 중복 요청을 쌓지 않습니다.",
  ],
  [
    "주문가능 금액",
    "잔액에서 수수료를 남겨두고, 설정한 최대 보유금액까지 살 수 있는 금액입니다. 비율 버튼은 이 금액을 기준으로 계산합니다.",
  ],
  [
    "토큰과 예상 비용",
    "토큰은 AI가 읽고 답한 글의 양을 세는 단위입니다. 표시 비용은 이 앱이 받은 사용량과 공개 요금으로 계산한 예상값입니다. 실제 잔액·청구액은 TypeSafe 계정에서 확인합니다.",
  ],
];
$("glossary").innerHTML = glossary
  .map(
    ([name, meaning]) =>
      "<h3>" + esc(name) + "</h3><p>" + esc(meaning) + "</p>",
  )
  .join("");
$("helpBtn").onclick = () => $("helpDialog").showModal();
