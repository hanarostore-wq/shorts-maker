import { $, $$, h, esc, fmtPrice, fmtKrw, fmtInt, fmtPct, fmtSigned, fmtQty, fmtDur, fmtTime, ago, upDown, sym, bus, S, nameOf, api, setMarket, toast, orderNotice, coinIcon, authUrl } from './core.js?v=1.10.97';
import { decisionPill } from './exchange.js?v=1.10.97';

const coinCell = (code) => `<div class="coin"><img src="${coinIcon(code)}" onerror="this.style.visibility='hidden'" alt=""><div><b>${esc(nameOf(code))}</b> <em>${sym(code)}</em></div></div>`;
const signed = (v) => `<span class="${upDown(v)}">${fmtSigned(v, fmtInt)}</span>`;
const pctCell = (v, d = 2) => `<span class="${upDown(v)}">${fmtPct(v, d)}</span>`;
const KST = 9 * 3600;

function findMarket(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;
  return S.markets.find((m) => m.code.toLowerCase() === `krw-${q}` || sym(m.code).toLowerCase() === q)
    || S.markets.find((m) => m.ko.toLowerCase() === q)
    || S.markets.find((m) => m.ko.toLowerCase().includes(q) || m.en.toLowerCase().includes(q));
}

// =====================================================================================
// 자동매매 dashboard
// =====================================================================================
const AP = { eq: null, eqSeries: null, filter: 'all' };

function buildAuto() {
  $('#view-auto').innerHTML = `
    <div class="page-title"><h2>자동매매</h2><span class="sub" id="apSub"></span>
      <div class="right"><button class="btn primary" id="apToggle">-</button></div></div>
    <div class="cards" id="apCards"></div>
    <div class="two">
      <div class="panel"><div class="ph"><h3>자산 추이</h3><span class="sub">모의 계좌 총 평가자산 · 1분 단위</span></div><div class="pb"><div class="eq-chart" id="eqChart"></div></div></div>
      <div class="panel"><div class="ph"><h3>보유 포지션</h3><span class="sub" id="apPosSub"></span></div><div class="tbl-wrap" style="max-height:300px"><table class="tbl" id="apPos"></table></div></div>
    </div>
    <div class="panel scr-panel"><div class="ph"><h3 id="scrTitle">실시간 TOP 자동 선별</h3><span class="sub" id="scrSub"></span>
      <div class="right" id="scrMode"></div></div>
      <div class="scr-meta" id="scrMeta"></div>
      <div class="scr-body"><div class="tbl-wrap"><table class="tbl" id="scrTable"></table></div>
        <div class="scr-side"><div class="scr-h">승격 대기</div><div id="scrBench"></div><div class="scr-h" style="margin-top:10px">최근 교체</div><div id="scrChanges"></div></div></div></div>
    <div class="panel"><div class="ph"><h3>감시 코인</h3><span class="sub">자동 TOP + 고정 코인 + 보유 코인 · 실시간 진입 신호 · 행을 누르면 거래소 화면으로 이동</span>
      <div class="right filters"><input id="apAdd" placeholder="고정 코인 추가 (예: 도지, ETH)"><button class="btn sm" id="apAddBtn">고정</button></div></div>
      <div class="tbl-wrap"><table class="tbl" id="apWatch"></table></div></div>
    <div class="panel"><div class="ph"><h3>판단 기록</h3><span class="sub">Jev 보조형 또는 순수 규칙형의 진입·청산 기록 · 최근 200건</span>
      <div class="right filters"><select id="apDecFilter"><option value="all">전체</option><option value="exec">체결된 판단</option><option value="entry">진입 판단</option><option value="exit">청산 판단</option><option value="err">오류</option></select></div></div>
      <div class="tbl-wrap"><table class="tbl" id="apDec"></table></div></div>
    <div class="panel"><div class="ph"><h3>시스템 로그</h3></div><div class="tbl-wrap" style="max-height:220px"><table class="tbl" id="apLog"></table></div></div>`;

  $('#apToggle').addEventListener('click', toggleAuto);
  $('#apDecFilter').addEventListener('change', (e) => { AP.filter = e.target.value; renderDecisions(); });
  const add = async () => {
    const m = findMarket($('#apAdd').value);
    if (!m) return toast('코인을 찾을 수 없습니다', 'err');
    try { S.config = await api('/api/watch', { market: m.code, on: true }); $('#apAdd').value = ''; toast(`${m.ko} 고정 감시 추가`); bus.emit('cfg', S.config); } catch (e) { toast(e.message, 'err'); }
  };
  $('#apAddBtn').addEventListener('click', add);
  $('#apAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const pinClick = async (e) => {
    const b = e.target.closest('[data-pin]');
    if (b) {
      e.stopPropagation();
      const on = b.dataset.on === '1';
      try { S.config = await api('/api/watch', { market: b.dataset.pin, on }); bus.emit('cfg', S.config); toast(on ? `${nameOf(b.dataset.pin)} 고정 감시` : `${nameOf(b.dataset.pin)} 고정 해제`); } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const tr = e.target.closest('tr[data-code], [data-go]');
    if (tr) { setMarket(tr.dataset.code || tr.dataset.go); location.hash = '#/exchange'; }
  };
  $('#apWatch').addEventListener('click', pinClick);
  $('#scrTable').addEventListener('click', pinClick);
  $('#scrBench').addEventListener('click', pinClick);
  $('#apPos').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sell]');
    if (b) {
      e.stopPropagation();
      try { await api('/api/order', { market: b.dataset.sell, side: 'sell', ratio: 1 }); } catch (err) { orderNotice('cancel', { market: b.dataset.sell, message: err.message }); }
      return;
    }
    const tr = e.target.closest('tr[data-code]');
    if (tr) { setMarket(tr.dataset.code); location.hash = '#/exchange'; }
  });
}

export async function toggleAuto() {
  if (!S.config) {
    try {
      const initView = await api('/api/state');
      if (initView?.config) S.config = initView.config;
    } catch (e) {
      return toast('서버 연결 대기 중입니다 · 잠시 후 다시 눌러주세요', 'err');
    }
  }
  if (!S.config) return toast('설정 정보를 불러오는 중입니다', 'err');
  if (S.config.mode === 'live') return toast('실전 자동매매는 안전 잠금 상태입니다. Binance 잔고 조회와 수동 주문만 사용할 수 있습니다.', 'err');
  if (S.config.autoTrading) return toast('자동매매는 항상 켜짐으로 유지됩니다');
  try {
    S.config = await api('/api/auto', { on: true });
    bus.emit('cfg', S.config);
    toast('자동매매를 켰습니다 · 이후에도 켜짐으로 유지됩니다');
  } catch (e) { toast(e.message, 'err'); }
}

function kpi(k, v, s = '', cls = '') { return `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`; }

function orderPlan(c, availableKrw = null) {
  const t = c?.trade || {};
  if (t.orderMode === 'percent') {
    const pct = Number(t.orderPct || 0);
    return availableKrw == null ? `가용원화 ${pct}%` : `가용원화 ${pct}% (${fmtInt(Math.floor(availableKrw * pct / 100))}원)`;
  }
  return `${fmtInt(t.orderKrw || 0)}원`;
}

function estimateScreenerCost(c) {
  const sc = c?.screener || {}, cost = c?.cost || {};
  const batch = Math.max(1, Number(sc.batchSize) || 1);
  const perMin = sc.enabled ? (Math.max(0, Number(sc.candidates) || 0) / batch) * (60 / Math.max(15, Number(sc.refreshSec) || 60)) : 0;
  const tokens = Math.max(0, Number(cost.estimatorBaseTokens) || 0) + batch * Math.max(0, Number(cost.estimatorTokensPerCoin) || 0);
  const usd = perMin * 60 * 24 * 30 * tokens * Math.max(0, Number(cost.inputUsdPerMTokens) || 0) / 1e6;
  return { perMin, tokens, usd, krw: usd * Math.max(0, Number(cost.usdKrw) || 0) };
}

function renderAutoCards() {
  const m = S.summary, c = S.config;
  if (!m || !c || !$('#apCards')) return;
  const j = m.jev;
  const ruleMode = m.effectiveDecisionMode === 'rule';
  const modeName = ruleMode ? '순수 규칙형 · Jev API 0회' : 'Jev 보조형';
  const monthly = estimateScreenerCost(c);
  const fx = Number(c.cost?.usdKrw) || 0;
  const live = c.mode === 'live' ? S.liveAccount : null;
  $('#apSub').innerHTML = '<span class="pill buy">항상 켜짐</span> · ' + `${modeName} · 시작 ${fmtTime(m.startedAt, true)}`;
  $('#apToggle').textContent = '자동매매 ON';
  $('#apToggle').className = 'btn primary';
  if (c.mode === 'live') {
    if (!live) {
      $('#apCards').innerHTML = kpi('Binance 실전계좌', '불러오는 중', 'Binance API 잔고 조회 중');
      return;
    }
    if (!live.configured || live.error) {
      $('#apCards').innerHTML = kpi('Binance 실전계좌', '연결 필요', live.error || '설정에서 Access Key와 Secret Key를 저장하세요', 'down');
      return;
    }
    const assetValue = (live.positions || []).reduce((a, p) => a + Number(p.value || 0), 0);
    $('#apCards').innerHTML = [
      kpi('Binance 총 평가자산', `${fmtInt(live.equity)}<small>KRW</small>`, `실계좌 · ${fmtTime(live.updatedAt)}`),
      kpi('주문 가능 원화', `${fmtInt(live.krw)}<small>KRW</small>`, live.lockedKrw ? `주문 잠금 ${fmtInt(live.lockedKrw)}원` : '주문 가능 잔고'),
      kpi('실전 보유자산', `${fmtInt(assetValue)}<small>KRW</small>`, `${live.positions.length}개 코인 보유`),
      kpi('보유 평가손익', live.totalPnl == null ? '-' : `${fmtSigned(live.totalPnl, fmtInt)}<small>KRW</small>`, live.totalPnlPct == null ? '매수평균가 없는 자산 포함' : `수익률 ${fmtPct(live.totalPnlPct)}`, upDown(live.totalPnl)),
      kpi('Jev 호출', `${fmtInt(j.totalCalls)}<small>회</small>`, ruleMode ? '순수 규칙형 · 새 호출 없음' : `오류 ${fmtInt(j.totalErrors)}회`),
      kpi('Jev 월 선별 예상', ruleMode ? '₩0' : `₩${fmtInt(monthly.krw)}`, ruleMode ? '순수 규칙형 · Jev API 0회' : `$${monthly.usd.toFixed(2)} · 매도 신호 발생 시만 Jev 청산 판단`),
      kpi('1회 자동 주문', orderPlan(c, live.krw), c.trade.orderMode === 'percent' ? `가용 원화 ${c.trade.orderPct}%` : '고정 주문금액'),
      kpi('비상 손절', c.trade.hardStopLossPct > 0 ? `-${c.trade.hardStopLossPct}<small>%</small>` : '기술 신호형', c.trade.hardStopLossPct > 0 ? '손실률 도달 즉시 시장가 매도' : ruleMode ? '기술 매도신호 즉시 규칙 매도' : '기술 매도신호 뒤 Jev가 최종 매도')
    ].join('');
    return;
  }
  $('#apCards').innerHTML = [
    kpi('총 평가자산', `${fmtInt(m.equity)}<small>KRW</small>`, `시작 자금 ${fmtInt(m.initialKrw)}원`),
    kpi('총 손익', `${fmtSigned(m.totalPnl, fmtInt)}<small>KRW</small>`, `수익률 ${fmtPct(m.totalPnlPct)}`, upDown(m.totalPnl)),
    kpi('실현 손익', `${fmtSigned(m.realizedPnl, fmtInt)}<small>KRW</small>`, `누적 수수료 ${fmtInt(m.feesPaid)}원`, upDown(m.realizedPnl)),
    kpi('승률', m.winRate == null ? '-' : `${(m.winRate * 100).toFixed(1)}<small>%</small>`, `${m.wins}승 ${m.losses}패`),
    kpi('완료 거래', `${fmtInt(m.trades)}<small>회</small>`, `평균 보유 ${fmtDur(m.avgHoldSec)}`),
    kpi('보유 포지션', `${m.positions.length}<small>/ ${c.trade.maxPositions}</small>`, `주문가능 ${fmtInt(m.krw)}원`),
    kpi('Jev 호출', `${fmtInt(j.totalCalls)}<small>회</small>`, ruleMode ? '순수 규칙형 · 새 호출 없음' : `오류 ${fmtInt(j.totalErrors)}회${j.lastError ? ` · 최근: ${esc(j.lastError.msg).slice(0, 40)}` : ''}`, !ruleMode && j.lastError && Date.now() - j.lastError.at < 60000 ? 'down' : ''),
    kpi(ruleMode ? '규칙 판단' : 'Jev 응답 속도', ruleMode ? 'EMA 리본' : j.avgLatency == null ? '-' : `${Math.round(j.avgLatency)}<small>ms</small>`, ruleMode ? `판단 중 ${m.inflight.length}건 · 실시간 규칙 실행` : `최근 ${j.lastLatency == null ? '-' : Math.round(j.lastLatency) + 'ms'} · 판단 중 ${m.inflight.length}건`),
    kpi('Jev 누적 비용', ruleMode ? '₩0 추가' : `₩${fmtKrw((j.totalCostUsd || 0) * fx, 1)}`, ruleMode ? '순수 규칙형 · API 호출 없음' : `$${(j.totalCostUsd || 0).toFixed(4)} · 입력 ${fmtInt(j.tokens)} 토큰`),
    kpi('Jev 월 선별 예상', ruleMode ? '₩0' : `₩${fmtInt(monthly.krw)}`, ruleMode ? '순수 규칙형 · 비용 없음' : `$${monthly.usd.toFixed(2)} · 분당 ${monthly.perMin.toFixed(1)}회 · 진입/청산 별도`),
    kpi('감시 코인', `${S.watch.filter((w) => w.watched).length}<small>개</small>`, `${c.screener?.enabled ? `자동 TOP ${S.screener?.rows?.length ?? 0}` : '선별 꺼짐'} · 고정 ${c.markets.length} · 1회 ${orderPlan(c, m.krw)}`)
  ].join('');
}

function renderAutoPositions() {
  const m = S.summary;
  if (!m || !$('#apPos')) return;
  if (S.config?.mode === 'live') {
    const live = S.liveAccount;
    if (!live) {
      $('#apPosSub').textContent = '조회 중';
      $('#apPos').innerHTML = '<tbody><tr><td class="empty">Binance 실전 보유자산을 불러오는 중입니다</td></tr></tbody>';
      return;
    }
    if (!live.configured || live.error) {
      $('#apPosSub').textContent = 'API 연결 필요';
      $('#apPos').innerHTML = `<tbody><tr><td class="empty">${esc(live.error || '설정에서 Binance API 키를 입력하세요')}</td></tr></tbody>`;
      return;
    }
    $('#apPosSub').textContent = `실전 ${live.positions.length}개 · ${fmtTime(live.updatedAt)}`;
    $('#apPos').innerHTML = `<thead><tr><th class="l">실전 보유 코인</th><th>매수평균가</th><th>현재가</th><th>보유수량</th><th>평가금액</th><th>평가손익</th></tr></thead><tbody>${
      live.positions.map((p) => `<tr class="click" data-code="${p.market}"><td class="l">${coinCell(p.market)}</td><td>${fmtPrice(p.avgPrice)}</td><td>${fmtPrice(p.mark)}</td><td>${fmtQty(p.qty)}</td><td>${fmtInt(p.value)}원</td><td>${p.pnl == null ? '-' : `${pctCell(p.pnlPct)}<small>${fmtSigned(p.pnl, fmtInt)}원</small>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">실전 보유 코인이 없습니다</td></tr>'
    }</tbody>`;
    return;
  }
  $('#apPosSub').textContent = `${m.positions.length}개`;
  $('#apPos').innerHTML = `<thead><tr><th class="l">코인</th><th>매수가</th><th>현재가</th><th>수익률</th><th>최고</th><th>보유</th><th></th></tr></thead><tbody>${
    m.positions.map((p) => `<tr class="click" data-code="${p.market}"><td class="l">${coinCell(p.market)}</td><td>${fmtPrice(p.avgPrice)}</td><td>${fmtPrice(p.mark)}</td><td>${pctCell(p.pnlPct)}</td><td>${pctCell(p.peakPct)}</td><td>${fmtDur(p.heldSec)}</td><td><button class="btn sm" data-sell="${p.market}">매도</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">보유 중인 포지션이 없습니다</td></tr>'
  }</tbody>`;
}

function renderWatch() {
  if (!$('#apWatch') || !S.config) return;
  const s = S.config.signal;
  const r = S.config.ribbon || {};
  const rows = S.watch.map((w) => {
    let st;
    if (w.position) st = `<span class="pill buy">보유 ${fmtPct(w.position.pnlPct)}</span>`;
    else if (w.judging) st = '<span class="pill run">판단 중</span>';
    else if (!w.watched) st = '<span class="pill skip">TOP 이탈 · 청산 관리</span>';
    else if (!w.warm) st = '<span class="pill skip">수집 중</span>';
    else if (w.blocked) st = '<span class="pill err">진입 제한</span>';
    else if (!S.config.autoTrading) st = '<span class="pill skip">정지</span>';
    else st = '<span class="pill run">감시 중</span>';
    const touch = (w.ema30LowDistances || []).slice(-r.pullbackLookbackBars).some((d) => Math.abs(d) <= r.maxPullbackDistancePct);
    const setup = w.ema30Breakout ? '<b class="up">EMA30 돌파</b>' : touch && w.candleBull && (w.ema30DistancePct ?? -1) >= 0 ? '<b class="up">EMA30 재지지</b>' : '<span class="muted">대기</span>';
    const align = w.ribbonBull ? '<b class="up">완전 정배열</b>' : w.ribbonBear ? '<b class="down">역배열</b>' : w.ema30 > w.ema60 ? '<b class="up">초기 상승</b>' : '<span class="muted">미정렬</span>';
    const last = S.lastDec.get(w.market) || w.last;
    const lastTxt = last ? `${last.kind === 'entry' ? '진입' : '청산'} ${last.p != null ? (last.p * 100).toFixed(0) + '%' : ''} · ${ago(last.t)}` : '-';
    return `<tr class="click" data-code="${w.market}">
      <td class="l">${coinCell(w.market)}</td>
      <td class="c">${w.rank ? `<span class="rank-b">TOP ${w.rank}</span>` : ''}${w.pinned ? '<span class="pin-b">고정</span>' : ''}${!w.rank && !w.pinned && w.position ? '<span class="pin-b">보유</span>' : ''}</td>
      <td class="${upDown(S.tickers.get(w.market)?.scr)}">${fmtPrice(w.price)}</td>
      <td>${w.ema30 != null ? fmtPrice(w.ema30) : '-'}</td>
      <td>${w.ema60 != null ? fmtPrice(w.ema60) : '-'}</td>
      <td>${w.ema100 != null ? fmtPrice(w.ema100) : '-'}</td>
      <td>${w.ema200 != null ? fmtPrice(w.ema200) : '-'}</td>
      <td class="c">${align}<small class="muted"> ${w.ribbonWidthPct != null ? w.ribbonWidthPct.toFixed(3) + '%' : ''}</small></td>
      <td class="c">${setup}</td>
      <td class="${upDown(w.ema30SlopePct)}">${w.ema30SlopePct != null ? fmtPct(w.ema30SlopePct, 3) : '-'}</td>
      <td class="${upDown(w.ema30DistancePct)}">${w.ema30DistancePct != null ? fmtPct(w.ema30DistancePct, 3) : '-'}</td>
      <td class="${w.candleBull ? 'up' : 'down'}">${w.candleBodyPct != null ? fmtPct(w.candleBodyPct, 3) : '-'}</td>
      <td class="${(w.tickPct ?? 0) > s.maxTickPct ? 'down' : ''}">${w.tickPct != null ? w.tickPct.toFixed(3) + '%' : '-'}</td>
      <td class="c">${st}</td>
      <td>${lastTxt}</td>
      <td><button class="btn sm" data-pin="${w.market}" data-on="${w.pinned ? '0' : '1'}">${w.pinned ? '고정 해제' : '고정'}</button></td></tr>`;
  });
  rows.sort((a, b) => 0);
  const mode = S.summary?.effectiveDecisionMode === 'rule' ? '순수 규칙' : 'Jev 보조';
  const restoring = S.screener?.restored ? `저장 TOP ${S.screener.restoredRows}개를 유지 중입니다 · 새 체결·호가 확인 뒤 진입 판단을 다시 시작합니다` : null;
  $('#apWatch').innerHTML = `<thead><tr><th class="l">코인</th><th class="c">구분</th><th>현재가</th><th>EMA30</th><th>EMA60</th><th>EMA100</th><th>EMA200</th><th class="c">리본 정렬·폭</th><th class="c">진입 구조</th><th>EMA30 기울기</th><th>EMA30 거리</th><th>캔들 몸통</th><th>호가 간격</th><th class="c">상태</th><th>최근 판단</th><th></th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="16" class="empty">${S.config.screener?.enabled ? (restoring || `${mode} 모드가 Binance USDT 마켓 전체를 실시간 분석 중입니다 · 약 1분 뒤 자동 감시 목록이 채워집니다`) : '감시 코인이 없습니다. TOP 자동 선별을 켜거나 코인을 고정하세요'}</td></tr>`}</tbody>`;
}

const pctTxt = (v, d = 2) => (v == null ? '-' : fmtPct(v, d));
const krwShort = (v) => (v == null ? '-' : v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);
const EXCL = [['warning', '유의·경고'], ['lowValue', '거래대금 부족'], ['tick', '호가 한 칸 큼'], ['stable', '스테이블'], ['inactive', '거래 정지'], ['warming', '수집 중']];

function renderScreener() {
  const v = S.screener;
  if (!$('#scrTable') || !S.config) return;
  if (!v) { $('#scrMeta').innerHTML = '<span class="muted">선별기 연결 대기 중</span>'; return; }
  const c = v.counts || {};
  const held = new Set((S.summary?.positions || []).map((p) => p.market));
  const judging = new Set(S.summary?.inflight || []);
  $('#scrTitle').textContent = `${v.mode === 'jev' ? 'Jev 보조' : '순수 규칙'} 실시간 선별 TOP ${v.topN}`;
  $('#scrSub').textContent = v.enabled ? `Binance USDT 마켓 ${c.total ?? '-'}개 전체를 체결마다 다시 계산 · 동시 보유 ${S.config.trade.maxPositions}개까지만 매수` : '꺼짐 · 설정에서 켤 수 있습니다';
  $('#scrMode').innerHTML = !v.enabled ? '<span class="pill skip">선별 꺼짐</span>' : v.mode === 'jev' ? '<span class="pill buy">Jev 보조</span>' : '<span class="pill warn">순수 규칙 · API 0회</span>';
  const lb = v.lastBatch;
  const excl = EXCL.filter(([k]) => c[k]).map(([k, t]) => `${t} ${c[k]}`).join(' · ');
  $('#scrMeta').innerHTML = `
    <span><b>${c.tracked ?? 0}</b> 수신</span><span><b>${c.eligible ?? 0}</b> 조건 통과</span><span><b>${c.candidates ?? 0}</b> 후보</span>
    ${v.mode === 'jev' ? `<span>Jev 채점 <b>${c.jevScored ?? 0}</b>개 · 분당 ${v.stats.callsPerMin}회</span><span>${lb ? `최근 채점 ${ago(lb.t)} · ${lb.ok ? `${lb.got}/${lb.n}개 · ${lb.latencyMs}ms` : `<b class="down">실패</b> ${esc(lb.error || '')}`}` : '첫 채점 대기'}</span><span>선별 비용 $${(v.stats.costUsd || 0).toFixed(4)}</span>` : '<span>규칙 점수 = 모멘텀 · 거래대금 가속 · 매수 비중 · 변동폭 · 유동성 · 호가 비용</span>'}
    ${excl ? `<span class="muted">제외: ${excl}</span>` : ''}
    ${v.restored ? `<span class="warm">저장 TOP ${v.restoredRows}개 유지 · 새 체결·호가 ${v.warmupLeft}초 재확인 중 · 저장본만으로 매수하지 않음</span>` : v.warmupLeft > 0 ? `<span class="warm">워밍업 ${v.warmupLeft}초 · 1분치 실시간 데이터가 쌓이면 TOP이 채워집니다</span>` : ''}`;
  const rows = (v.rows || []).map((r) => {
    const mv = r.isNew ? '<i class="rk new">NEW</i>' : r.delta > 0 ? `<i class="rk up">▲${r.delta}</i>` : r.delta < 0 ? `<i class="rk down">▼${-r.delta}</i>` : '<i class="rk">-</i>';
    const st = held.has(r.code) ? '<span class="pill buy">보유</span>' : judging.has(r.code) ? '<span class="pill run">판단 중</span>' : S.config.autoTrading ? '<span class="pill run">감시</span>' : '<span class="pill skip">정지</span>';
    const pinned = S.config.markets.includes(r.code);
    const score = Math.round(r.final * 100);
    return `<tr class="click" data-code="${r.code}">
      <td class="c"><b>${r.rank}</b> ${mv}</td>
      <td class="l">${coinCell(r.code)}</td>
      <td class="l"><div class="sbar"><i style="width:${Math.max(3, Math.min(100, score))}%"></i><span>${score}</span></div></td>
      <td>${r.jevP != null ? `${Math.round(r.jevP * 100)}%<small class="muted"> ${Math.round(r.jevAge)}초</small>` : v.mode === 'jev' ? '<span class="muted">대기</span>' : '<span class="muted">-</span>'}</td>
      <td class="${upDown(r.r1)}">${pctTxt(r.r1)}</td>
      <td class="${upDown(r.r5)}">${pctTxt(r.r5)}</td>
      <td class="${upDown(r.r15)}">${pctTxt(r.r15)}</td>
      <td class="${(r.accel5 ?? 0) >= 2 ? 'up' : ''}">${krwShort(r.v5)}<small class="muted"> ${r.accel5 != null ? r.accel5.toFixed(1) + '배' : ''}</small></td>
      <td class="${(r.buy5 ?? 0) >= 0.6 ? 'up' : (r.buy5 ?? 0.5) < 0.45 ? 'down' : ''}">${r.buy5 != null ? Math.round(r.buy5 * 100) + '%' : '-'}</td>
      <td>${r.rng5 != null ? r.rng5.toFixed(2) + '%' : '-'}</td>
      <td>${r.tickPct != null ? r.tickPct.toFixed(3) + '%' : '-'}</td>
      <td class="l">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td>${ago(r.since)}</td>
      <td class="c">${st}</td>
      <td><button class="btn sm" data-pin="${r.code}" data-on="${pinned ? '0' : '1'}">${pinned ? '고정됨' : '고정'}</button></td></tr>`;
  });
  const empty = !v.enabled ? 'TOP 자동 선별이 꺼져 있습니다 · 설정에서 켜세요' : v.restored ? `저장 TOP ${v.restoredRows}개를 유지하며 새 실시간 데이터를 재확인 중입니다` : v.warmupLeft > 0 ? `Binance USDT 마켓 전체 실시간 데이터를 모으는 중 · ${v.warmupLeft}초 뒤 TOP ${v.topN}이 채워집니다` : '조건을 통과한 코인이 없습니다 · 최소 거래대금이나 최대 호가 간격 기준을 확인하세요';
  $('#scrTable').innerHTML = `<thead><tr><th class="c">순위</th><th class="l">코인</th><th class="l">선별 점수</th><th>${v.mode === 'jev' ? 'Jev' : '규칙'}</th><th>1분</th><th>5분</th><th>15분</th><th>5분 거래대금</th><th>매수 비중</th><th>5분 변동</th><th>호가 한 칸</th><th class="l">선정 근거</th><th>편입</th><th class="c">상태</th><th></th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="15" class="empty">${empty}</td></tr>`}</tbody>`;
  $('#scrBench').innerHTML = (v.bench || []).map((b) => `<div class="bench" data-go="${b.code}"><span><b>${esc(nameOf(b.code))}</b> <em>${sym(b.code)}</em></span><span class="muted">${Math.round(b.final * 100)}점 · 5분 ${pctTxt(b.r5, 1)}</span></div>`).join('') || '<div class="muted" style="padding:6px 0">-</div>';
  $('#scrChanges').innerHTML = (v.changes || []).slice().reverse().slice(0, 8).map((e) => `<div class="chg"><span class="muted">${fmtTime(e.t)}</span>${e.added.length ? ` <b class="up">+${e.added.length > 3 ? e.added.length + '개' : e.added.map((x) => esc(nameOf(x))).join(', ')}</b>` : ''}${e.removed.length ? ` <b class="down">-${e.removed.length > 3 ? e.removed.length + '개' : e.removed.map((x) => esc(nameOf(x))).join(', ')}</b>` : ''}</div>`).join('') || '<div class="muted" style="padding:6px 0">아직 교체 없음</div>';
}

function renderDecisions() {
  if (!$('#apDec')) return;
  let list = S.decisions.slice(-400).reverse();
  if (AP.filter === 'exec') list = list.filter((d) => d.executed);
  else if (AP.filter === 'entry') list = list.filter((d) => d.kind === 'entry');
  else if (AP.filter === 'exit') list = list.filter((d) => d.kind === 'exit');
  else if (AP.filter === 'err') list = list.filter((d) => !d.ok);
  list = list.slice(0, 200);
  $('#apDec').innerHTML = `<thead><tr><th class="l">시간</th><th class="l">코인</th><th class="c">유형</th><th class="l">신호</th><th>확률</th><th>가짜 급등</th><th>응답</th><th class="c">결과</th><th class="l">사유</th></tr></thead><tbody>${
    list.map((d) => `<tr><td class="l">${fmtTime(d.t)}</td><td class="l"><b>${esc(nameOf(d.market))}</b></td><td class="c">${d.kind === 'entry' ? '진입' : '청산'}</td><td class="l">${esc((d.trigger || []).join(', '))}</td><td>${d.p != null ? (d.p * 100).toFixed(0) + '%' : '-'}</td><td>${d.fake != null ? (d.fake * 100).toFixed(0) + '%' : '-'}</td><td>${d.latencyMs}ms</td><td class="c">${decisionPill(d)}</td><td class="l" style="white-space:normal;min-width:220px">${esc(d.reason || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">아직 판단 기록이 없습니다</td></tr>'
  }</tbody>`;
}

function renderLogs() {
  if (!$('#apLog')) return;
  $('#apLog').innerHTML = `<tbody>${S.logs.slice(-80).reverse().map((l) => `<tr><td class="l" style="width:90px">${fmtTime(l.t)}</td><td class="l ${l.level === 'warn' ? 'down' : ''}" style="white-space:normal">${esc(l.msg)}</td></tr>`).join('')}</tbody>`;
}

function initEquityChart() {
  const el = $('#eqChart');
  if (!el || AP.eq) return;
  AP.eq = window.LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#fff' }, textColor: '#333', fontSize: 11 },
    grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
    rightPriceScale: { borderColor: '#e1e3e8' },
    timeScale: { borderColor: '#e1e3e8', timeVisible: true },
    localization: { locale: 'ko-KR', priceFormatter: (p) => fmtInt(p) }
  });
  AP.eqSeries = AP.eq.addAreaSeries({ lineColor: '#093687', topColor: 'rgba(9,54,135,0.25)', bottomColor: 'rgba(9,54,135,0.02)', lineWidth: 2 });
}

function drawEquity() {
  if (!AP.eqSeries) return;
  const pts = new Map();
  for (const [t, v] of S.equity) pts.set(Math.floor(t / 60000) * 60 + KST, v);
  if (S.summary) pts.set(Math.floor(Date.now() / 60000) * 60 + KST, Math.round(S.summary.equity));
  const data = [...pts.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
  AP.eqSeries.setData(data);
  if (S.summary) AP.eqSeries.applyOptions({ lineColor: S.summary.totalPnl >= 0 ? '#c84a31' : '#1261c4', topColor: S.summary.totalPnl >= 0 ? 'rgba(200,74,49,0.22)' : 'rgba(18,97,196,0.22)' });
}

function renderAutoPage() {
  if (!$('#view-auto').classList.contains('on')) return;
  renderAutoCards();
  renderAutoPositions();
  renderWatch();
  renderScreener();
}

// =====================================================================================
// 투자내역
// =====================================================================================
const IV = { tab: 'hold', side: 'all', q: '', holdScrollLeft: 0, holdScrollTop: 0, holdScrolling: false, holdPending: false, holdScrollTimer: null };

function buildInvest() {
  $('#view-investments').innerHTML = `
    <div class="page-title"><h2>투자내역</h2><span class="sub">모의투자 계좌 · 실제 자산과 무관</span>
      <div class="right"><a class="btn" id="csvLink" href="/api/trades.csv" style="display:inline-flex;align-items:center">거래내역 CSV 받기</a></div></div>
    <div class="box" style="margin-bottom:10px"><div class="tabs left" id="ivTabs"><a class="on" data-iv="hold">보유자산</a><a data-iv="pnl">투자손익</a><a data-iv="hist">거래내역</a></div></div>
    <div id="iv-hold"></div><div id="iv-pnl" style="display:none"></div>
    <div id="iv-hist" style="display:none">
      <div class="panel"><div class="ph"><h3>거래내역</h3><span class="sub" id="ivHistSub"></span>
        <div class="right filters"><select id="ivSide"><option value="all">전체</option><option value="buy">매수</option><option value="sell">매도</option></select><input id="ivQ" placeholder="코인 검색"></div></div>
        <div class="tbl-wrap" style="max-height:640px"><table class="tbl" id="ivHist"></table></div></div>
    </div>`;
  $$('#ivTabs a').forEach((a) => a.addEventListener('click', () => {
    IV.tab = a.dataset.iv;
    $$('#ivTabs a').forEach((x) => x.classList.toggle('on', x === a));
    for (const k of ['hold', 'pnl', 'hist']) $(`#iv-${k}`).style.display = k === IV.tab ? '' : 'none';
    renderInvest(true);
  }));
  $('#ivSide').addEventListener('change', (e) => { IV.side = e.target.value; renderInvHist(); });
  $('#ivQ').addEventListener('input', (e) => { IV.q = e.target.value.trim().toLowerCase(); renderInvHist(); });
  $('#iv-hold').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sell]');
    if (!b) return;
    try { await api('/api/order', { market: b.dataset.sell, side: 'sell', ratio: 1 }); } catch (err) { orderNotice('cancel', { market: b.dataset.sell, message: err.message }); }
  });
}

function bindHoldingsScroll(wrap) {
  const remember = () => {
    IV.holdScrollLeft = wrap.scrollLeft;
    IV.holdScrollTop = wrap.scrollTop;
  };
  const begin = () => {
    remember();
    IV.holdScrolling = true;
    clearTimeout(IV.holdScrollTimer);
  };
  const end = () => {
    remember();
    clearTimeout(IV.holdScrollTimer);
    IV.holdScrollTimer = setTimeout(() => {
      IV.holdScrolling = false;
      if (IV.holdPending) {
        IV.holdPending = false;
        renderInvHold();
      }
    }, 120);
  };
  wrap.addEventListener('scroll', remember, { passive: true });
  wrap.addEventListener('touchstart', begin, { passive: true });
  wrap.addEventListener('touchend', end, { passive: true });
  wrap.addEventListener('touchcancel', end, { passive: true });
}

function renderInvHold() {
  const m = S.summary;
  if (!m) return;
  const oldWrap = $('#iv-hold .holdings-scroll');
  if (oldWrap) {
    IV.holdScrollLeft = oldWrap.scrollLeft;
    IV.holdScrollTop = oldWrap.scrollTop;
  }
  if (IV.holdScrolling) {
    IV.holdPending = true;
    return;
  }
  const buyTotal = m.positions.reduce((a, p) => a + p.cost, 0);
  const valTotal = m.positions.reduce((a, p) => a + p.value, 0);
  const pnl = valTotal - buyTotal;
  $('#iv-hold').innerHTML = `
    <div class="inv-summary">
      <div class="col">
        <div class="big">보유 KRW <b>${fmtInt(m.krw)}<small>KRW</small></b></div>
        <div class="rows">
          <div><span>총 매수</span><b>${fmtInt(buyTotal)}<small>KRW</small></b></div>
          <div><span>총 평가손익</span><b class="${upDown(pnl)}">${fmtSigned(pnl, fmtInt)}<small>KRW</small></b></div>
          <div><span>총 평가</span><b>${fmtInt(valTotal)}<small>KRW</small></b></div>
          <div><span>총 평가수익률</span><b class="${upDown(pnl)}">${buyTotal ? fmtPct((pnl / buyTotal) * 100) : '0.00%'}</b></div>
        </div>
      </div>
      <div class="col">
        <div class="big">총 보유자산 <b>${fmtInt(m.equity)}<small>KRW</small></b></div>
        <div class="rows">
          <div><span>주문가능</span><b>${fmtInt(m.krw)}<small>KRW</small></b></div>
          <div><span>누적 실현손익</span><b class="${upDown(m.realizedPnl)}">${fmtSigned(m.realizedPnl, fmtInt)}<small>KRW</small></b></div>
          <div><span>시작 자금</span><b>${fmtInt(m.initialKrw)}<small>KRW</small></b></div>
          <div><span>누적 수익률</span><b class="${upDown(m.totalPnl)}">${fmtPct(m.totalPnlPct)}</b></div>
        </div>
      </div>
    </div>
    <div class="panel"><div class="ph"><h3>보유자산 목록</h3></div>
      <div class="tbl-wrap holdings-scroll"><table class="tbl"><thead><tr><th class="l">보유자산</th><th>보유수량</th><th>매수평균가</th><th>매수금액</th><th>평가금액</th><th>평가손익(%)</th><th>보유시간</th><th></th></tr></thead><tbody>${
        m.positions.map((p) => `<tr><td class="l">${coinCell(p.market)}</td><td>${fmtQty(p.qty)} <span class="muted">${sym(p.market)}</span></td><td>${fmtPrice(p.avgPrice)} <span class="muted">KRW</span></td><td>${fmtInt(p.cost)} <span class="muted">KRW</span></td><td>${fmtInt(p.value)} <span class="muted">KRW</span></td><td>${pctCell(p.pnlPct)}<br>${signed(p.value - p.cost)}</td><td>${fmtDur(p.heldSec)}</td><td><button class="btn sm" data-sell="${p.market}">매도</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">보유 중인 코인이 없습니다</td></tr>'
      }</tbody></table></div></div>`;
  const nextWrap = $('#iv-hold .holdings-scroll');
  if (nextWrap) {
    nextWrap.scrollLeft = IV.holdScrollLeft;
    nextWrap.scrollTop = IV.holdScrollTop;
    bindHoldingsScroll(nextWrap);
    requestAnimationFrame(() => {
      nextWrap.scrollLeft = IV.holdScrollLeft;
      nextWrap.scrollTop = IV.holdScrollTop;
    });
  }
}

function groupStats(sells, keyFn) {
  const g = new Map();
  for (const t of sells) {
    const k = keyFn(t);
    const s = g.get(k) || { n: 0, w: 0, pnl: 0, pct: 0, fee: 0, hold: 0 };
    s.n++; if (t.pnl >= 0) s.w++; s.pnl += t.pnl; s.pct += t.pnlPct; s.fee += t.fee; s.hold += t.holdSec || 0;
    g.set(k, s);
  }
  return [...g.entries()];
}

function renderInvPnl() {
  const sells = S.trades.filter((t) => t.side === 'sell' && t.pnl != null);
  const wins = sells.filter((t) => t.pnl >= 0), losses = sells.filter((t) => t.pnl < 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const avgW = wins.length ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : null;
  const avgL = losses.length ? losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length : null;
  const byCoin = groupStats(sells, (t) => t.market).sort((a, b) => b[1].pnl - a[1].pnl);
  const byReason = groupStats(sells, (t) => t.reasonKo || t.reason).sort((a, b) => b[1].n - a[1].n);
  const byDay = groupStats(sells, (t) => fmtTime(t.t, true).slice(0, 10)).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const row = ([k, s], label) => `<tr><td class="l">${label}</td><td>${s.n}</td><td>${((s.w / s.n) * 100).toFixed(0)}%</td><td>${signed(s.pnl)}</td><td>${pctCell(s.pct / s.n, 3)}</td><td>${fmtDur(s.hold / s.n)}</td><td>${fmtInt(s.fee)}</td></tr>`;
  const head = (first) => `<thead><tr><th class="l">${first}</th><th>거래</th><th>승률</th><th>실현손익</th><th>평균 수익률</th><th>평균 보유</th><th>매도 수수료</th></tr></thead>`;
  $('#iv-pnl').innerHTML = `
    <div class="cards">
      ${kpi('누적 실현손익', `${fmtSigned(gw - gl, fmtInt)}<small>KRW</small>`, `최근 ${sells.length}건 기준`, upDown(gw - gl))}
      ${kpi('승률', sells.length ? `${((wins.length / sells.length) * 100).toFixed(1)}<small>%</small>` : '-', `${wins.length}승 ${losses.length}패`)}
      ${kpi('손익비 (PF)', gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? '∞' : '-', '총 이익 ÷ 총 손실 · 1 이상이면 흑자')}
      ${kpi('평균 수익 거래', avgW == null ? '-' : fmtPct(avgW, 3), '수수료 포함', 'up')}
      ${kpi('평균 손실 거래', avgL == null ? '-' : fmtPct(avgL, 3), '수수료 포함', 'down')}
    </div>
    <div class="two">
      <div class="panel"><div class="ph"><h3>코인별 손익</h3></div><div class="tbl-wrap"><table class="tbl">${head('코인')}<tbody>${byCoin.map((x) => row(x, coinCell(x[0]))).join('') || '<tr><td colspan="7" class="empty">완료된 거래가 없습니다</td></tr>'}</tbody></table></div></div>
      <div class="panel"><div class="ph"><h3>청산 사유별</h3><span class="sub">어떤 청산이 돈을 버는지</span></div><div class="tbl-wrap"><table class="tbl">${head('사유')}<tbody>${byReason.map((x) => row(x, esc(x[0]))).join('') || '<tr><td colspan="7" class="empty">완료된 거래가 없습니다</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="panel"><div class="ph"><h3>일별 손익</h3></div><div class="tbl-wrap"><table class="tbl">${head('일자')}<tbody>${byDay.map((x) => row(x, x[0])).join('') || '<tr><td colspan="7" class="empty">완료된 거래가 없습니다</td></tr>'}</tbody></table></div></div>`;
}

function renderInvHist() {
  let list = S.trades.slice().reverse();
  if (IV.side !== 'all') list = list.filter((t) => t.side === IV.side);
  if (IV.q) list = list.filter((t) => t.market.toLowerCase().includes(IV.q) || nameOf(t.market).toLowerCase().includes(IV.q));
  $('#ivHistSub').textContent = `${list.length}건`;
  list = list.slice(0, 500);
  $('#ivHist').innerHTML = `<thead><tr><th class="l">체결시간</th><th class="l">코인</th><th class="c">종류</th><th>거래수량</th><th>거래단가</th><th>거래금액</th><th>수수료</th><th>정산금액</th><th>실현손익</th><th>수익률</th><th>보유</th><th class="l">사유</th><th>Jev 응답</th></tr></thead><tbody>${
    list.map((t) => `<tr><td class="l">${fmtTime(t.t, true)}</td><td class="l"><b>${esc(nameOf(t.market))}</b> <span class="muted">${sym(t.market)}</span></td><td class="c ${t.side === 'buy' ? 'up' : 'down'}"><b>${t.side === 'buy' ? '매수' : '매도'}</b></td><td>${fmtQty(t.qty)}</td><td>${fmtPrice(t.price)}</td><td>${fmtInt(t.gross)}</td><td>${fmtInt(t.fee)}</td><td>${fmtInt(t.net)}</td><td>${t.pnl != null ? signed(t.pnl) : '-'}</td><td>${t.pnlPct != null ? pctCell(t.pnlPct) : '-'}</td><td>${t.holdSec != null ? fmtDur(t.holdSec) : '-'}</td><td class="l">${esc(t.reasonKo || t.reason)}</td><td>${t.latencyMs ? t.latencyMs + 'ms' : '-'}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">거래내역이 없습니다</td></tr>'
  }</tbody>`;
}

function renderInvest(force = false) {
  if (!$('#view-investments').classList.contains('on')) return;
  if (IV.tab === 'hold') renderInvHold();
  else if (IV.tab === 'pnl' && force) renderInvPnl();
  else if (IV.tab === 'hist' && force) renderInvHist();
}

// =====================================================================================
// 설정
// =====================================================================================
const SECTIONS = [
  {
    id: 'general', title: '자동매매 운영 · 투자 모드', sub: '신규 진입 제어와 모의투자 / 실전투자 전환',
    fields: [
      { p: 'autoTrading', label: '자동매매', type: 'select', bool: true, options: [['true', '켜기 · 신규 진입 허용'], ['false', '끄기 · 신규 진입 정지']] },
      { p: 'strategy.decisionMode', label: 'Jev 판단 사용', type: 'select', options: [['jev', '켜기 · Jev 보조형 (선별·진입·청산에 Jev 사용)'], ['rule', '끄기 · 순수 규칙형 (Jev API 호출 0회)']], hint: '끄면 API 키는 저장되지만 전혀 호출하지 않습니다. EMA 리본·호가·실시간 점수 규칙만으로 TOP30·매수·매도를 실행합니다' },
      { p: 'mode', label: '투자 모드', type: 'select', options: [['paper', '모의투자 (실제 주문 없음 · 가상 체결)'], ['live', '실전투자 (Binance 잔고 조회 · 수동 실전 주문)']], hint: '실전 자동매매는 체결·잔고 동기화 검증 전까지 안전 잠금입니다. 실전투자는 아래 Binance API 키와 대시보드 비밀번호가 필요합니다' },
      { p: 'theme', label: '화면 테마', type: 'select', options: [['light', '라이트 모드 (기본)'], ['dark', '다크(블랙) 모드']], hint: '상단 라이트 모드/다크 모드 버튼으로도 즉시 전환 가능' }
    ]
  },
  {
    id: 'binanceKey', title: 'Binance API 연결 (실전투자용)', sub: '실전투자 모드 선택 시 실제 시장가 주문을 발송하는 키입니다',
    fields: [
      { p: 'binance.accessKey', label: 'Binance Access Key', type: 'password', hint: 'Binance 마이페이지 → Open API 관리에서 발급' },
      { p: 'binance.secretKey', label: 'Binance Secret Key', type: 'password', hint: '자산조회 + 주문 권한 필수' }
    ]
  },
  {
    id: 'alerts', title: '체결 알림 · 한국어 음성', sub: '서버가 확정한 매수·매도 체결을 5초 카드와 한국어 음성으로 알려줍니다',
    fields: [
      { p: 'alerts.voiceEnabled', label: '한국어 음성 안내', type: 'select', bool: true, options: [['true', '켜기 · 매수되었습니다 · 매도되었습니다'], ['false', '끄기 · 화면 카드만 표시']] },
      { p: 'alerts.voiceVolume', label: '음성 볼륨', type: 'number', unit: '%', scale: 100, step: 1, hint: '0 = 무음 · 100 = 최대 볼륨' },
      { p: 'alerts.displaySec', label: '알림 표시 시간', type: 'number', unit: '초', step: 1, hint: '기본 5초 · 로그인 카드 크기로 나타났다 사라집니다' }
    ]
  },
  {
    id: 'cost', title: 'Jev 비용 · 원화 환산', sub: 'Jev 보조형에서만 쓰는 추정값 · 순수 규칙형은 Jev 비용 0원',
    fields: [
      { p: 'cost.usdKrw', label: '달러 환율', type: 'number', unit: 'KRW / USD', step: 0.01, hint: 'XE 2026-09-30 기준 1 USD = 1,355.92 KRW · 필요하면 직접 변경' },
      { p: 'cost.inputUsdPerMTokens', label: 'Jev 입력 100만 토큰 가격', type: 'number', unit: 'USD', step: 0.001, hint: '현재 추정값 $0.042 · 공급자 가격이 바뀌면 수정' },
      { p: 'cost.estimatorBaseTokens', label: '선별 요청 기본 토큰', type: 'number', unit: '토큰', step: 10, hint: '월 예상 비용 계산용' },
      { p: 'cost.estimatorTokensPerCoin', label: '후보 1개당 추가 토큰', type: 'number', unit: '토큰', step: 10, hint: '월 예상 비용 계산용' }
    ]
  },
  {
    id: 'jev', title: 'Jev 연결 · 보조형 전용', sub: 'Jev 판단 사용을 켰을 때만 선별·진입·청산에 사용합니다',
    fields: [
      { p: 'jev.provider', label: '판단 엔진', type: 'select', options: [['auto', '자동 · 키가 있으면 Jev 사용 (추천)'], ['typesafe', 'Jev · TypeSafe 직접'], ['openrouter', 'Jev · OpenRouter 경유'], ['rule', '규칙 판단기 고정 (테스트용 · 무료)']] },
      { p: 'jev.typesafeKey', label: 'TypeSafe API 키', type: 'password', hint: 'TypeSafe에서 발급한 키 (apik…) · 추천' },
      { p: 'jev.typesafeModel', label: 'TypeSafe 모델', type: 'text', hint: '기본: jev-latest' },
      { p: 'jev.openrouterKey', label: 'OpenRouter API 키', type: 'password', hint: 'sk-or-로 시작하는 키만 · TypeSafe 키는 위 칸에' },
      { p: 'jev.openrouterModel', label: 'OpenRouter 모델', type: 'text', hint: '기본: typesafe/jev-1.13' },
      { p: 'jev.timeoutMs', label: '응답 제한 시간', type: 'number', unit: 'ms', hint: '이보다 늦으면 해당 신호는 버립니다' }
    ]
  },
  {
    id: 'screener', title: 'TOP 자동 감시 선별', sub: 'Binance USDT 마켓 전체를 실시간 계산합니다. Jev 보조형은 Jev 점수를 합산하고 순수 규칙형은 실시간 규칙 점수만 사용합니다',
    fields: [
      { p: 'screener.enabled', label: 'TOP 자동 선별', type: 'select', bool: true, options: [['true', '켜기 · TOP 코인을 자동 감시'], ['false', '끄기 · 고정 코인만 감시']] },
      { p: 'screener.topN', label: '감시 TOP 개수', type: 'number', unit: '개', hint: '이 중 동시 보유 최대 개수만큼만 진입' },
      { p: 'screener.candidates', label: 'Jev 보조 채점 후보', type: 'number', unit: '개', hint: '10~290 · Jev 보조형에서만 사용 · 높을수록 재검토 범위·비용 증가' },
      { p: 'screener.refreshSec', label: 'Jev 재채점 주기', type: 'number', unit: '초', hint: 'Jev 보조형에서 급변 후보는 이 주기 전에도 재채점' },
      { p: 'screener.batchSize', label: '1회 Jev 채점 코인', type: 'number', unit: '개', hint: 'Jev 보조형에서만 사용 · 많을수록 API 호출 수는 줄고 한 번의 질문은 길어짐' },
      { p: 'screener.minValue24hKrw', label: '최소 24시간 거래대금', type: 'number', unit: '억원', scale: 1e-8, step: 1, hint: '이보다 적은 코인은 후보에서 제외' },
      { p: 'screener.minStaySec', label: 'TOP 최소 유지', type: 'number', unit: '초', hint: '편입 직후 순위가 흔들려도 이 시간 동안 유지' },
      { p: 'screener.excludeStable', label: '스테이블코인', type: 'select', bool: true, options: [['true', '제외 (USDT, USDC 등)'], ['false', '포함']] }
    ]
  },
  {
    id: 'screenerAdvanced', title: 'TOP 유지 · 수집 · Jev 보조 고급 규칙', sub: 'TOP 교체 속도·데이터 수집·Jev 보조형 재채점 제어 · 순수 규칙형의 직접 점수 기준은 아래 섹션에서 조정합니다',
    fields: [
      { p: 'screener.jevWeight', label: 'Jev 점수 비중', type: 'number', step: 0.05, hint: '최종 TOP 점수의 Jev 확률 가중치' },
      { p: 'screener.liveWeight', label: '실시간 점수 비중', type: 'number', step: 0.05, hint: '최종 TOP 점수의 체결·거래대금 가중치' },
      { p: 'screener.scoreFreshMultiplier', label: 'Jev 점수 유효 주기 배수', type: 'number', step: 0.5, hint: '재채점 주기 × 이 값 동안 기존 점수를 사용' },
      { p: 'screener.rescoreLiveDelta', label: '급변 재채점 점수 변화', type: 'number', step: 0.1, hint: '실시간 점수가 이만큼 변하면 정기주기 전에도 재채점' },
      { p: 'screener.keepRankMultiplier', label: 'TOP 유지 버퍼 배수', type: 'number', step: 0.1, hint: 'TOP 30이면 1.5 = 순위 45위까지 유지 가능' },
      { p: 'screener.replaceRankFraction', label: '즉시 승격 순위 비율', type: 'number', unit: '× TOP', step: 0.05, hint: 'TOP 30 · 0.5 = 상위 15위 새 후보만 즉시 교체' },
      { p: 'screener.maxSwapPerTick', label: '한 번에 TOP 교체 최대', type: 'number', unit: '개', hint: '높을수록 TOP이 빠르게 바뀜' },
      { p: 'screener.warmupSec', label: '시작 워밍업', type: 'number', unit: '초' },
      { p: 'screener.bucketSec', label: '실시간 데이터 묶음', type: 'number', unit: '초', hint: '짧을수록 반응은 빠르나 노이즈 증가' },
      { p: 'screener.historySec', label: '선별 지표 보관', type: 'number', unit: '초' },
      { p: 'screener.batchGapSec', label: 'Jev 호출 최소 간격', type: 'number', unit: '초', step: 0.5 },
      { p: 'screener.tickRefreshSec', label: '호가단위 갱신', type: 'number', unit: '초' },
      { p: 'screener.batchRateCapMultiplier', label: '급변 재채점 호출 여유', type: 'number', step: 0.1, hint: '정기 호출량 대비 급변 재채점 허용 배수' }
    ]
  },
  {
    id: 'scoreWeights', title: '순수 규칙형 TOP 점수 · 기준 · 가중치', sub: 'Jev를 끄면 아래 규칙 점수가 290개 Binance USDT 마켓의 최종 TOP 순위를 직접 결정합니다 · 가중치 0 = 해당 요소 미반영',
    fields: [
      { p: 'screener.liveScoreBias', label: '규칙 점수 통과 기준', type: 'number', step: 0.1, hint: '낮출수록 더 많은 코인이 상위 후보가 되고, 높일수록 강한 흐름만 TOP에 남습니다' },
      { p: 'screener.momentum1mWeight', label: '1분 모멘텀 가중치', type: 'number', step: 0.1, hint: '즉시 상승 속도 비중 · 너무 높으면 급등 추격 성향 증가' },
      { p: 'screener.momentum5mWeight', label: '5분 모멘텀 가중치', type: 'number', step: 0.1, hint: '단기 추세 지속성 비중' },
      { p: 'screener.momentum15mWeight', label: '15분 모멘텀 가중치', type: 'number', step: 0.1, hint: '조금 더 긴 상승 추세 비중' },
      { p: 'screener.valueAccel5mWeight', label: '5분 거래대금 가속 가중치', type: 'number', step: 0.1, hint: '최근 5분 거래대금이 평소 대비 늘어난 정도' },
      { p: 'screener.valueAccel1mWeight', label: '1분 거래대금 가속 가중치', type: 'number', step: 0.1, hint: '방금 유입된 거래대금 급증 비중' },
      { p: 'screener.buyerWeight', label: '매수 체결 비중 가중치', type: 'number', step: 0.1, hint: '최근 5분 매수 체결 우위 비중' },
      { p: 'screener.rangeWeight', label: '5분 변동폭 가중치', type: 'number', step: 0.05, hint: '움직임이 너무 없는 코인을 낮추는 변동성 비중' },
      { p: 'screener.liquidityWeight', label: '24시간 유동성 가중치', type: 'number', step: 0.05, hint: '24시간 거래대금이 큰 코인 선호도' },
      { p: 'screener.tickPenalty', label: '호가 한 칸 비용 감점', type: 'number', step: 0.1, hint: '호가 한 칸이 클수록 감점 · 초단타 수수료·슬리피지 방어' },
      { p: 'screener.overextended15mPct', label: '15분 과열 기준', type: 'number', unit: '%', step: 0.5, hint: '15분 상승률이 이 값을 넘으면 과열 감점 시작' },
      { p: 'screener.overextended15mPenalty', label: '15분 과열 감점', type: 'number', step: 0.1, hint: '급등 추격 방지 강도' },
      { p: 'screener.dayChangePct', label: '24시간 급등 감점 기준', type: 'number', unit: '%', step: 1, hint: '하루 급등 종목의 추격 진입을 줄이는 기준' },
      { p: 'screener.dayChangePenalty', label: '24시간 급등 감점', type: 'number', step: 0.1, hint: '하루 급등 감점 강도' },
      { p: 'screener.inactiveSec', label: '체결 없음 감점 기준', type: 'number', unit: '초', hint: '이 시간 이상 새 체결이 없으면 유동성 저하로 판단' },
      { p: 'screener.inactivePenalty', label: '체결 없음 감점', type: 'number', step: 0.1, hint: '체결 공백 감점 강도' }
    ]
  },
  {
    id: 'trade', title: '주문 금액 · 안전장치', sub: '주문 금액과 매수 직후 바로 팔리는 문제를 제어합니다',
    fields: [
      { p: 'trade.orderMode', label: '1회 주문 방식', type: 'select', options: [['fixed', '고정 금액 (아래 KRW 사용)'], ['percent', '가용 원화 비율 (아래 % 사용)']], hint: '퍼센트는 매수 시점에 주문 가능한 원화 잔고 기준으로 계산' },
      { p: 'trade.orderKrw', label: '고정 주문금액', type: 'number', unit: 'KRW', step: 1000, hint: '주문 방식이 고정 금액일 때 사용' },
      { p: 'trade.orderPct', label: '가용 원화 주문비율', type: 'number', unit: '%', step: 0.1, hint: '주문 방식이 가용 원화 비율일 때 사용 · 예: 10 = 잔고의 10%' },
      { p: 'trade.maxPositions', label: '동시 보유 최대', type: 'number', unit: '개' },
      { p: 'trade.minHoldSec', label: '매수 직후 매도 방지 시간', type: 'number', unit: '초', hint: '이 시간 동안 작은 가격 흔들림으로는 팔지 않습니다. 비상 손절만 즉시 실행됩니다' },
      { p: 'trade.entryProb', label: 'Jev 진입 확률 기준', type: 'number', unit: '%', scale: 100, step: 1, hint: 'Jev 보조형에서만 사용 · Jev 매수 확률이 이 이상일 때만 매수' },
      { p: 'trade.exitProb', label: 'Jev 하락 확률 기준', type: 'number', unit: '%', scale: 100, step: 1, hint: 'Jev 보조형에서만 사용 · Jev 매도 확률이 이 이상일 때만 실제 매도' },
      { p: 'trade.fakeMax', label: 'Jev 가짜 돌파 허용치', type: 'number', unit: '%', scale: 100, step: 1, hint: 'Jev 보조형에서만 사용 · Jev가 가짜로 볼 확률이 높으면 진입하지 않음' },
      { p: 'trade.hardStopLossPct', label: '비상 손절', type: 'number', unit: '%', step: 0.1, hint: '0 = 기본 기술 청산 규칙 사용 · 0보다 크면 해당 손실률에서 Jev 보조 여부와 무관하게 즉시 시장가 매도' }
    ]
  },
  {
    id: 'rule', title: 'Jev 없이 매수 · 매도하는 기준', sub: 'Jev 판단 사용을 끄면 아래 조건만으로 거래합니다. 숫자가 클수록 신중해지고 거래 횟수는 줄어듭니다',
    fields: [
      { p: 'rule.maxEntryRank', label: '매수 허용 순위', type: 'number', unit: '위 이내', step: 1, hint: '자동 선정 TOP30 중 이 순위 안의 코인만 삽니다' },
      { p: 'rule.minRet30Pct', label: '최근 30초 가격 상승', type: 'number', unit: '%', step: 0.01, hint: '이만큼도 오르지 않으면 힘없는 움직임으로 보고 사지 않습니다' },
      { p: 'rule.minBuyRatio30', label: '최근 30초 매수 힘', type: 'number', unit: '%', scale: 100, step: 1, hint: '전체 체결 중 시장가 매수 비율 · 55 = 매수가 매도보다 조금 더 많아야 함' },
      { p: 'rule.minImbalance15', label: '호가창 매수 우세', type: 'number', unit: '%', scale: 100, step: 1, hint: '상위 15호가의 매수 잔량 우세 기준 · 0 = 매수·매도가 최소 동등' },
      { p: 'rule.minVolSpike', label: '최근 10초 거래 활발함', type: 'number', unit: '배', step: 0.1, hint: '최근 10초 거래금액(KRW) ÷ 직전 290초 거래금액을 10초 기준으로 환산한 평균 · 0.8 = 평소의 80% 이상' },
      { p: 'rule.exitConfirmBars', label: '매도 신호 확인 횟수', type: 'number', unit: '개 완료 1분봉', step: 1, hint: '하락 신호가 이만큼의 1분봉이 끝날 때까지 유지되어야 매도합니다 · 2 = 2분 동안 확인 후 매도' },
      { p: 'rule.minProfitExitPct', label: '일반 매도 최소 순이익', type: 'number', unit: '%', step: 0.01, hint: '비상 손절을 제외한 모든 EMA·위험선·고점 기술 매도와 Jev 매도에 공통 적용 · 수수료·슬리피지 포함 예상 순이익이 이보다 낮으면 보유' }
    ]
  },
  {
    id: 'ribbon', title: 'EMA 리본 · 영상 기반 진입', sub: '영상에서 공개된 EMA 30·60·100·200만 사용합니다. 비공개 라즈 리본 공식은 포함하지 않습니다',
    fields: [
      { p: 'ribbon.enabled', label: 'EMA30 상승 전략', type: 'select', bool: true, options: [['true', '켜기 · EMA30 돌파·재지지 신호 사용'], ['false', '끄기 · 신규 진입 정지']] },
      { p: 'ribbon.entryStructure', label: 'EMA30 진입 조건 엄격도', type: 'select', options: [
        ['relaxed', '완화 (추천 · EMA30 위 지지 상승 허용, 거래 활성화)'],
        ['strict', '엄격 (영상 기준 · 돌파 또는 4봉 내 눌림목 재지지 필수)'],
        ['free', '자유 (Jev 보조형 전용 · 리본 정렬 시 Jev에게 전권 위임)']
      ], hint: '순수 규칙형에서는 자유를 선택해도 안전하게 완화 조건으로 적용됩니다' },
      { p: 'ribbon.requireFullBullAlignment', label: '완전 정배열만 진입', type: 'select', bool: true, options: [['true', 'EMA30 > EMA60 > EMA100 > EMA200 일 때만'], ['false', '초기 상승 · EMA30 > EMA60부터 허용 (기본)']] },
      { p: 'ribbon.blockBearRibbon', label: '완전 역배열 차단', type: 'select', bool: true, options: [['true', '차단 · EMA30 < EMA60 < EMA100 < EMA200에서 매수 안 함'], ['false', '허용']] },
      { p: 'ribbon.minRibbonWidthPct', label: '상승 줄 간격', type: 'number', unit: '%', step: 0.01, hint: 'EMA30·EMA60·EMA100·EMA200이 너무 붙어 있으면 방향 없는 구간으로 보고 사지 않습니다' },
      { p: 'ribbon.minEma30SlopePct', label: 'EMA30 최근 방향', type: 'number', unit: '%', step: 0.001, hint: '최근 5분 동안 EMA30이 이만큼은 올라야 합니다 · 0 = 내려가는 EMA30만 차단' },
      { p: 'ribbon.minBreakoutPct', label: 'EMA30 위로 올라선 거리', type: 'number', unit: '%', step: 0.01 },
      { p: 'ribbon.pullbackLookbackBars', label: 'EMA30 재지지 확인 구간', type: 'number', unit: '개 1분봉', step: 1 },
      { p: 'ribbon.maxPullbackDistancePct', label: 'EMA30 근처 허용 거리', type: 'number', unit: '%', step: 0.01 },
      { p: 'ribbon.minCandleBodyPct', label: '진입 직전 상승 힘', type: 'number', unit: '%', step: 0.01, hint: '1분봉 몸통이 이보다 작으면 힘없는 움직임으로 보고 사지 않습니다' },
      { p: 'ribbon.swingLookbackBars', label: '위험선 찾는 최근 구간', type: 'number', unit: '개 1분봉', step: 1, hint: '매수 후 하락을 판단할 최근 저점 구간입니다' },
      { p: 'ribbon.trailArmPct', label: '수익 보호선 활성화 순이익', type: 'number', unit: '%', step: 0.01, hint: '수수료·슬리피지 포함 예상 순이익이 이 값 이상이면 위험선을 진입봉 저점까지 올립니다 · 이 값만으로 매도하지는 않습니다' },
      { p: 'ribbon.targetLookbackBars', label: '직전 저항 탐색 봉', type: 'number', unit: '개', step: 1 },
      { p: 'ribbon.targetProximityPct', label: '직전 저항 접근 거리', type: 'number', unit: '%', step: 0.01, hint: '해당 거리 이내면 Jev가 수익 보호·보유를 판단' },
      { p: 'ribbon.ema30LossPct', label: 'EMA30 하락 확인 여유', type: 'number', unit: '%', step: 0.01, hint: 'EMA30 아래로 이만큼 더 내려가야 하락 신호로 봅니다 · 작은 흔들림 매도를 줄입니다' },
      { p: 'ribbon.riskLineBreakPct', label: '위험선 하락 확인 여유', type: 'number', unit: '%', step: 0.01, hint: '최근 저점 아래로 이만큼 더 내려가야 위험 신호로 봅니다' }
    ]
  },
  {
    id: 'signal', title: '사자마자 손해 보는 코인 차단', sub: '매수 가격과 바로 되팔 가격이 너무 멀면 시작부터 불리하므로 신규 매수를 막습니다',
    fields: [
      { p: 'signal.callGapSec', label: '같은 코인 재질문 간격', type: 'number', unit: '초', step: 1 },
      { p: 'signal.exitSignalRepeatSec', label: '일반 매도신호 재확인', type: 'number', unit: '초', step: 1, hint: '직전 저항 접촉 등 일반 매도신호가 계속될 때만 다시 Jev에 묻는 간격' },
      { p: 'signal.urgentExitRepeatSec', label: '긴급 매도신호 재확인', type: 'number', unit: '초', step: 1, hint: 'EMA30 이탈·스윙 저점 이탈·역배열처럼 위험한 신호가 유지될 때 Jev 재확인 간격' },
      { p: 'signal.maxTickPct', label: '가격 한 칸의 최대 손해', type: 'number', unit: '%', step: 0.01, hint: '가격이 한 칸만 움직여도 이보다 많이 손해면 사지 않습니다' },
      { p: 'signal.maxSpreadPct', label: '매수·매도 가격 차이 한도', type: 'number', unit: '%', step: 0.01, hint: '사자마자 되팔 때의 가격 차이입니다 · 작을수록 시작 손해가 적습니다' }
    ]
  },
  {
    id: 'paper', title: '모의투자 체결', sub: 'Binance Binance USDT 마켓 기준 · 실제 주문은 절대 전송하지 않습니다',
    fields: [
      { p: 'paper.feePct', label: '거래 수수료', type: 'number', unit: '%', step: 0.01, hint: 'Binance Binance USDT 마켓 기본 0.05%' },
      { p: 'paper.slippagePct', label: '슬리피지', type: 'number', unit: '%', step: 0.01, hint: '호가를 따라 체결한 뒤 추가로 불리하게 반영' }
    ]
  }
];

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);

function buildSettings() {
  const sec = (s) => `<div class="panel" id="set-${s.id}"><div class="ph"><h3>${s.title}</h3><span class="sub">${s.sub}</span></div><div class="pb">${
    s.fields.map((f) => `<div class="field"><label for="f-${f.p}">${f.label}${f.hint ? `<small>${f.hint}</small>` : ''}</label><div class="ctl">${
      f.type === 'select'
        ? `<select id="f-${f.p}" data-p="${f.p}" ${f.bool ? 'data-bool="1"' : ''}>${f.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`
        : `<input id="f-${f.p}" data-p="${f.p}" type="${f.type}" ${f.step ? `step="${f.step}"` : ''} ${f.scale ? `data-scale="${f.scale}"` : ''} autocomplete="off">`
    }${f.unit != null ? `<span class="unit">${f.unit}</span>` : ''}</div></div>`).join('')
  }${s.id === 'jev' ? `
      <div class="field"><label>연결 테스트<small>저장 후 실제로 한 번 물어봅니다</small></label><div class="ctl"><button class="btn primary" id="jevTest">Jev 연결 테스트</button><span class="muted" id="jevTestMsg"></span></div></div>
      <div class="test-out" id="jevOut"></div>
      <div class="hint" style="margin-top:12px"><b>Jev 키 받는 법</b><br>
        1. <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> 에서 로그인 후 키 생성 (또는 <a href="https://typesafe.ai" target="_blank" rel="noopener">typesafe.ai</a>에서 직접 발급)<br>
        2. 크레딧 충전 · Jev는 입력 100만 토큰당 약 $0.042<br>
        3. 위 칸에 키 붙여넣기 → 판단 엔진을 Jev로 변경 → 저장 → 연결 테스트</div>` : ''}
    ${s.id === 'screener' ? `<div class="hint" id="scrCost" style="margin-top:10px"></div>` : ''}
    ${s.id === 'scoreWeights' ? `<div class="hint" style="margin-top:12px"><b>순수 규칙형 점수식</b><br>규칙 점수 = 모멘텀(1·5·15분) + 거래대금 가속(1·5분) + 매수 체결 비중 + 5분 변동폭 + 24시간 유동성 − 호가 한 칸 비용 − 과열 − 체결 공백<br><span class="muted">Jev OFF에서는 이 점수를 확률형 점수로 변환해 TOP 순위를 정합니다. 최소 24시간 거래대금·스테이블 제외는 TOP 자동 감시 선별에서, 최대 호가 한 칸·최대 스프레드는 EMA 리본 진입 공통 호가비용·청산 신호에서 조정합니다.</span></div>` : ''}
    ${s.id === 'paper' ? `
      <div class="field"><label>계좌 초기화<small>잔고, 보유, 거래내역을 비우고 새로 시작 · 금액 제한 없음</small></label><div class="ctl"><input type="text" id="resetKrw" inputmode="numeric" placeholder="예: 10,000,000" autocomplete="off"><span class="unit">KRW</span><button class="btn danger" id="resetBtn">초기화</button></div></div>` : ''}
  </div></div>`;
  const left = SECTIONS.filter((s) => ['general', 'binanceKey', 'alerts', 'cost', 'jev', 'screener', 'screenerAdvanced', 'scoreWeights', 'paper'].includes(s.id)).map(sec).join('');
  const right = SECTIONS.filter((s) => ['trade', 'rule', 'ribbon', 'signal'].includes(s.id)).map(sec).join('');
  $('#view-settings').innerHTML = `
    <div class="page-title"><h2>설정</h2><span class="sub">변경 후 아래 [저장]을 누르면 즉시 반영됩니다</span></div>
    <div class="set-grid">
      <div>${left}
        <div class="panel"><div class="ph"><h3>고정 감시 코인</h3><span class="sub">선택 · 자동 선별 순위와 상관없이 항상 감시 · 최대 30개</span></div><div class="pb">
          <div class="chips" id="setChips"></div>
          <div class="filters" style="margin-top:12px"><input id="setAdd" placeholder="코인 추가 (예: 리플, SOL)" style="flex:1"><button class="btn sm" id="setAddBtn">추가</button></div>
          <div class="hint" style="margin-top:10px">초단타에는 거래대금이 크고 호가 한 칸이 작은 코인이 유리합니다. 1원 단위로 움직이는 100원대 코인은 한 칸이 0.5~1%라서 손절선보다 커질 수 있습니다.</div>
        </div></div>
      </div>
      <div>${right}</div>
    </div>
    <div class="save-bar"><span class="msg" id="saveMsg"></span><button class="btn" id="setRevert">되돌리기</button><button class="btn primary" id="setSave">저장</button></div>`;

  $('#setSave').addEventListener('click', () => saveSettings());
  $('#setRevert').addEventListener('click', () => { fillSettings(); toast('저장된 값으로 되돌렸습니다'); });
  $('#jevTest').addEventListener('click', testJev);
  $('#resetKrw').addEventListener('input', (e) => {
    const raw = Number(String(e.target.value).replace(/[^\d]/g, ''));
    e.target.value = raw ? raw.toLocaleString('ko-KR') : '';
  });
  $('#resetBtn').addEventListener('click', async () => {
    const krw = Math.floor(Number(String($('#resetKrw').value).replace(/[^\d]/g, '')));
    if (!(krw >= 10000)) return toast('초기 자금은 10,000원 이상', 'err');
    if (!confirm(`모의 계좌를 ${krw.toLocaleString('ko-KR')}원으로 초기화할까요?\n보유 포지션과 거래내역이 모두 지워집니다.`)) return;
    try { await api('/api/reset', { initialKrw: krw }); toast('모의 계좌를 초기화했습니다'); } catch (e) { toast(e.message, 'err'); }
  });
  const add = async () => {
    const m = findMarket($('#setAdd').value);
    if (!m) return toast('코인을 찾을 수 없습니다', 'err');
    try { S.config = await api('/api/watch', { market: m.code, on: true }); $('#setAdd').value = ''; bus.emit('cfg', S.config); } catch (e) { toast(e.message, 'err'); }
  };
  $('#setAddBtn').addEventListener('click', add);
  $('#setAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $('#setChips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    try { S.config = await api('/api/watch', { market: b.dataset.rm, on: false }); bus.emit('cfg', S.config); } catch (err) { toast(err.message, 'err'); }
  });
  $('#view-settings').addEventListener('input', (e) => { if (e.target.dataset.p) { $('#saveMsg').textContent = '저장하지 않은 변경사항이 있습니다'; $('#saveMsg').style.color = 'var(--up)'; renderScrCost(); } });
  $('#view-settings').addEventListener('change', (e) => { if (e.target.dataset.p) renderScrCost(); });
}

function fillSettings() {
  const c = S.config;
  if (!c) return;
  $$('#view-settings [data-p]').forEach((el) => {
    let v = getPath(c, el.dataset.p);
    if (el.dataset.scale) v = Math.round(v * Number(el.dataset.scale) * 100) / 100;
    el.value = el.dataset.bool ? String(!!v) : v ?? '';
    if (el.type === 'password') el.placeholder = v ? '저장됨 · 바꾸려면 새 키 입력' : '키를 붙여넣으세요';
  });
  $('#resetKrw').value = c.paper.initialKrw ? Number(c.paper.initialKrw).toLocaleString('ko-KR') : '';
  $('#saveMsg').textContent = '';
  renderChips();
  renderScrCost();
}

/** Live cost estimate for the screener with the values currently in the form. */
function renderScrCost() {
  const el = $('#scrCost');
  if (!el) return;
  const value = (p, fallback = 0) => {
    const raw = Number($(`[data-p="${p}"]`)?.value);
    return Number.isFinite(raw) ? raw : fallback;
  };
  const on = $('[data-p="screener.enabled"]')?.value === 'true';
  const cfg = {
    screener: {
      enabled: on,
      candidates: value('screener.candidates', S.config?.screener?.candidates),
      batchSize: value('screener.batchSize', S.config?.screener?.batchSize),
      refreshSec: value('screener.refreshSec', S.config?.screener?.refreshSec)
    },
    cost: {
      usdKrw: value('cost.usdKrw', S.config?.cost?.usdKrw),
      inputUsdPerMTokens: value('cost.inputUsdPerMTokens', S.config?.cost?.inputUsdPerMTokens),
      estimatorBaseTokens: value('cost.estimatorBaseTokens', S.config?.cost?.estimatorBaseTokens),
      estimatorTokensPerCoin: value('cost.estimatorTokensPerCoin', S.config?.cost?.estimatorTokensPerCoin)
    }
  };
  const e = estimateScreenerCost(cfg);
  const decisionMode = $('[data-p="strategy.decisionMode"]')?.value || S.config?.strategy?.decisionMode || 'jev';
  const provider = $('[data-p="jev.provider"]')?.value;
  const hasKey = !!(S.config?.jev?.hasTypesafeKey || S.config?.jev?.hasOpenrouterKey || $('[data-p="jev.typesafeKey"]')?.value || $('[data-p="jev.openrouterKey"]')?.value);
  el.innerHTML = !on ? 'TOP 자동 선별이 꺼져 있으면 고정 코인만 감시합니다.'
    : decisionMode === 'rule' ? `<b>순수 규칙형</b> · Jev API 호출 <b>0회</b> · 선별 비용 <b>0원</b><br><span class="muted">실시간 모멘텀·거래대금 가속·매수 체결 비중·변동폭·유동성·호가 비용 규칙만으로 TOP을 정합니다.</span>`
    : provider === 'rule' || !hasKey ? `Jev 보조형이지만 연결 가능한 Jev 키가 없어 현재는 <b>규칙 점수</b> 선별입니다. 키를 저장하면 Jev 점수를 합산합니다.`
    : `TOP 선별 예상: 분당 약 <b>${e.perMin.toFixed(1)}회</b> · 요청당 약 <b>${fmtInt(e.tokens)} 토큰</b> · 월 <b>$${e.usd.toFixed(2)} · 약 ${fmtInt(e.krw)}원</b><br><span class="muted">입력 100만 토큰당 $${cfg.cost.inputUsdPerMTokens} · 환율 ${fmtKrw(cfg.cost.usdKrw, 2)}원/USD 기준 · 급변 재채점과 개별 진입·청산 Jev 호출은 별도입니다.</span>`;
}

function renderChips() {
  if (!$('#setChips') || !S.config) return;
  $('#setChips').innerHTML = S.config.markets.map((m) => `<span class="c">${esc(nameOf(m))} <span class="muted">${sym(m)}</span><button data-rm="${m}" title="해제">×</button></span>`).join('') || '<span class="muted">감시 코인이 없습니다</span>';
}

async function saveSettings(silent = false) {
  const patch = {};
  for (const el of $$('#view-settings [data-p]')) {
    const parts = el.dataset.p.split('.');
    const [a, b] = parts;
    if (parts.length > 1) patch[a] ||= {};
    let v = el.value;
    if (el.dataset.bool) v = v === 'true';
    else if (el.type === 'number') { v = Number(v); if (el.dataset.scale) v = Math.round((v / Number(el.dataset.scale)) * 1e4) / 1e4; }
    if (el.type === 'password') { if (!v || v.includes('•')) continue; }
    if (parts.length === 1) patch[a] = v;
    else patch[a][b] = v;
  }
  try {
    S.config = await api('/api/config', patch);
    bus.emit('cfg', S.config);
    fillSettings();
    $('#saveMsg').textContent = `저장됨 · ${fmtTime(Date.now())}`;
    $('#saveMsg').style.color = 'var(--ok)';
    if (!silent) toast('설정을 저장했습니다');
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

async function testJev() {
  $('#jevTestMsg').textContent = '저장 후 테스트 중…';
  if (!(await saveSettings(true))) return;
  try {
    const r = await api('/api/jev/test', {});
    const out = $('#jevOut');
    out.classList.add('on');
    if (!r.ok) {
      $('#jevTestMsg').innerHTML = '<span class="down">실패</span>';
      out.textContent = `판단기: ${r.label}\n오류: ${r.error}\n응답 시간: ${Math.round(r.latencyMs)}ms`;
      return;
    }
    const a = r.answers;
    $('#jevTestMsg').innerHTML = `<span class="up">성공 · ${Math.round(r.latencyMs)}ms</span>`;
    out.textContent = `판단기: ${r.label}\n모델: ${r.model}\n응답 시간: ${Math.round(r.latencyMs)}ms\n테스트 코인: ${nameOf(r.market)}\n판단: ${a.action?.choice} (매수 ${(a.action?.probabilities?.buy * 100).toFixed(0)}% / 대기 ${(a.action?.probabilities?.wait * 100).toFixed(0)}%)\n가짜 급등 확률: ${a.fake?.noul != null ? (a.fake.noul * 100).toFixed(0) + '%' : '-'}${r.usage ? `\n토큰: 입력 ${r.usage.input_tokens} · 출력 ${r.usage.output_tokens}` : ''}`;
  } catch (e) { $('#jevTestMsg').innerHTML = `<span class="down">${esc(e.message)}</span>`; }
}

// =====================================================================================
export function initPages() {
  buildAuto();
  buildInvest();
  buildSettings();
  bus.on('init', () => { fillSettings(); renderAutoPage(); renderDecisions(); renderLogs(); drawEquity(); renderInvest(true); const a = $('#csvLink'); if (a) a.href = authUrl('/api/trades.csv'); });
  bus.on('scr', () => { if ($('#view-auto').classList.contains('on')) renderScreener(); });
  bus.on('sum', () => { renderAutoPage(); renderInvest(); if ($('#view-auto').classList.contains('on')) drawEquity(); });
  bus.on('cfg', () => { renderChips(); renderAutoPage(); });
  bus.on('live-account', () => { renderAutoPage(); renderInvest(true); });
  bus.on('dec', (d) => { if (!d.quiet && $('#view-auto').classList.contains('on')) renderDecisions(); });
  bus.on('log', () => { if ($('#view-auto').classList.contains('on')) renderLogs(); });
  bus.on('fill', () => renderInvest(true));
}

export function onRoute(route) {
  if (route === 'auto') { initEquityChart(); renderAutoPage(); renderDecisions(); renderLogs(); drawEquity(); }
  if (route === 'investments') renderInvest(true);
  if (route === 'settings') fillSettings();
}
