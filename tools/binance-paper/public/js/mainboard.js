import { toggleAuto } from './pages.js?v=1.10.56';
import { $, $$, bus, S, api, esc, fmtDur, fmtInt, fmtKrw, fmtPct, fmtPrice, fmtQty, fmtTime, nameOf, sym, setMarket, toast, upDown, coinIcon } from './core.js?v=1.10.56';
import { parseKrwAmount } from './amount.js?v=1.10.56';

// =====================================================================================
// Left Binance Chart in Mainboard
// =====================================================================================
const KST = 9 * 3600;
const MC = { chart: null, candle: null, vol: null, unit: localStorage.getItem('mu-unit') || '1', data: [], market: null, lines: [], reqId: 0 };

const MAIN_VIEW_KEY = 'yujin-main-view-v1';
function storedView() { try { return JSON.parse(localStorage.getItem(MAIN_VIEW_KEY) || '{}'); } catch { return {}; } }
let savedView = storedView();
function saveView(patch = {}) { savedView = { ...savedView, ...patch }; try { localStorage.setItem(MAIN_VIEW_KEY, JSON.stringify(savedView)); } catch { /* storage is optional */ } }

let slotDraft = null;
let exportStatus = null;
let selectedSlotId = Number(savedView.selectedSlotId) || 1;
let recordTab = savedView.recordTab === 'pnl' ? 'pnl' : 'trades';
let recordSlotFilter = savedView.recordSlotFilter === 'all'
  ? 'all'
  : (Number.isInteger(Number(savedView.recordSlotFilter)) && Number(savedView.recordSlotFilter) >= 1 ? Number(savedView.recordSlotFilter) : 'active');
let selectedOrderTab = ['buy', 'sell', 'quick', 'history'].includes(savedView.selectedOrderTab) ? savedView.selectedOrderTab : 'buy';
let lastInteraction = 0;
let renderTimer = null;
let interactionTimer = null;
let renderPending = false;
const SCROLL_IDLE_MS = 650;
let tickerPatchFrame = null;
const tickerPatchMarkets = new Set();
let applyStatus = '';
let trendRange = ['1일', '7일', '30일', '전체'].includes(savedView.trendRange) ? savedView.trendRange : '1일';
let restoredMarket = false;

const money = (v) => `${fmtInt(v)}원`;
const signedMoney = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmtInt(Math.abs(v || 0))}원`;
const stateName = (s) => ({ '통과': '통과', '대기': '대기', '자료 부족': '자료 부족', '자료가 늦음': '자료가 늦음' }[s] || s || '대기');
const activeSlot = () => S.config?.slots?.items?.find((x) => x.id === S.config?.slots?.activeId) || null;
const recordedSlot = (trade) => trade?.slot || trade?.entrySlot || trade?.evidence?.slot || null;
const recordedExitSlot = (trade) => trade?.exitSlot || trade?.evidence?.slot || null;
function recordSlotId() {
  return recordSlotFilter === 'all' ? null : recordSlotFilter === 'active' ? activeSlot()?.id || null : Number(recordSlotFilter);
}
function historyTrades() {
  const slotId = recordSlotId();
  const rows = S.trades || [];
  return slotId ? rows.filter((trade) => Number(recordedSlot(trade)?.id) === slotId) : recordSlotFilter === 'all' ? rows : [];
}
function slotLabel(slot, fallback = '수동 주문') {
  return slot?.id ? `${slot.id}번 슬롯 · ${slot.name || `${slot.id}번 슬롯`}` : fallback;
}
function recordScopeLabel() {
  if (recordSlotFilter === 'all') return '전체 슬롯';
  const id = recordSlotId();
  const slot = S.config?.slots?.items?.find((item) => item.id === id);
  return id ? `${id}번 슬롯 · ${slot?.name || '저장된 전략'}` : '현재 슬롯 없음';
}
function recordSlotTabs() {
  const shelf = S.config?.slots;
  const currentId = recordSlotId();
  const buttons = [`<button data-record-slot="all" class="${recordSlotFilter === 'all' ? 'on' : ''}" type="button">전체</button>`];
  if (activeSlot()) buttons.push(`<button data-record-slot="active" class="${recordSlotFilter === 'active' ? 'on' : ''}" type="button">현재 ${activeSlot().id}번</button>`);
  for (const slot of shelf?.items || []) {
    if (!slot.definition) continue;
    buttons.push(`<button data-record-slot="${slot.id}" class="${recordSlotFilter !== 'active' && currentId === slot.id ? 'on' : ''}" type="button">${slot.id}번</button>`);
  }
  return `<div class="record-slot-tabs" aria-label="슬롯별 거래내역 선택">${buttons.join('')}</div>`;
}
function recordExportControl() {
  const ready = !!S.config?.strategyExport?.ready;
  const label = ready ? '자동 GitHub 공유 · 체결 후 최대 3초' : '자동 공유 서비스 확인 중';
  return `<div class="record-export-control"><span class="record-export-link ${ready ? 'ready' : 'pending'}">${label}</span></div>`;
}
function recordPanelInner() {
  return `<div class="record-head"><div><b>슬롯별 거래내역</b><small>${esc(recordScopeLabel())} · 체결 당시 규칙과 분석 기준선을 고정 보관합니다</small></div><div class="record-head-tools">${recordSlotTabs()}${recordExportControl()}</div></div>${records()}`;
}
function slotRuleRows(active, group, evidence = []) {
  const enabled = new Set(active?.enabledRuleIds || []);
  const live = new Map((evidence || []).filter((r) => r.group === group).map((r) => [r.id, r]));
  return (active?.definition?.[group] || [])
    .filter((r) => r.사용 && enabled.has(r.규칙번호))
    .map((r) => ({
      id: r.규칙번호, name: r.이름, description: r.쉬운설명, group,
      type: r.종류, value: r.값, unit: r.단위, status: '자료 부족', actual: null,
      ...live.get(r.규칙번호)
    }));
}
const holdingRows = () => [...(S.watch || [])].filter((row) => !!row.position).sort((a, b) => {
  // 메인 보유표는 실현 전 현재 손익 금액이 가장 큰 코인을 항상 맨 위에 둔다.
  const profitGap = Number(b.position?.netPnl || 0) - Number(a.position?.netPnl || 0);
  return profitGap || Number(b.position?.netPct || 0) - Number(a.position?.netPct || 0);
});
const watchRows = holdingRows;
const selected = () => holdingRows().find((x) => x.market === S.market) || holdingRows()[0] || null;

function linePath(points, width = 220, height = 54) {
  if (!points?.length) return '';
  const vals = points.map((p) => Number(p[1] ?? p.c ?? 0)).filter(Number.isFinite);
  if (!vals.length) return '';
  const min = Math.min(...vals), max = Math.max(...vals); const span = Math.max(0.000001, max - min);
  return points.map((p, i) => {
    const v = Number(p[1] ?? p.c ?? min); const x = (i / Math.max(1, points.length - 1)) * width;
    const y = height - ((v - min) / span) * (height - 7) - 3;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function miniCandle(candles = []) {
  if (!candles.length) return '<div class="mini-chart-frame"><span class="mini-empty">자료 수집 중</span></div>';
  const n = candles.slice(-18); const hi = Math.max(...n.map((x) => x.h)); const lo = Math.min(...n.map((x) => x.l)); const span = Math.max(0.000001, hi - lo);
  return `<div class="mini-chart-frame"><svg class="mini-candle" viewBox="0 0 118 36" aria-label="최근 1분봉 흐름">${n.map((x, i) => {
    const xx = 3 + i * 6.35; const open = 33 - ((x.o - lo) / span) * 30; const close = 33 - ((x.c - lo) / span) * 30; const high = 33 - ((x.h - lo) / span) * 30; const low = 33 - ((x.l - lo) / span) * 30; const up = x.c >= x.o;
    return `<line x1="${xx}" x2="${xx}" y1="${high.toFixed(1)}" y2="${low.toFixed(1)}" class="${up ? 'c-up' : 'c-down'}"/><rect x="${(xx - 1.7).toFixed(1)}" y="${Math.min(open, close).toFixed(1)}" width="3.4" height="${Math.max(1, Math.abs(close - open)).toFixed(1)}" class="${up ? 'c-up' : 'c-down'}"/>`;
  }).join('')}</svg></div>`;
}

function depthGauge(w) {
  const buy = Math.round(Math.max(0, Math.min(1, Number(w.bidShare15 ?? 0.5))) * 100);
  const sell = 100 - buy;
  const leader = buy === sell ? '팽팽' : buy > sell ? '매수 힘 우세' : '매도 힘 우세';
  const leaderClass = buy === sell ? 'even' : buy > sell ? 'up' : 'down';
  return `<div class="depth-gauge" title="상위 15호가 잔량 기준 · ${leader}"><div class="depth-buy" style="width:${buy}%"><b>매수 ${buy}%</b></div><div class="depth-sell" style="width:${sell}%"><b>매도 ${sell}%</b></div><span class="depth-pin"></span></div><small class="depth-note ${leaderClass}">${leader}</small>`;
}

function scoreBar(w) {
  const score = Math.round(Math.max(0, Math.min(1, Number(w.score ?? 0))) * 100);
  return `<span class="screen-score"><i style="width:${score}%"></i><b>${score}점</b></span><small>1분 ${fmtPct(w.ret30 || 0)} · 5분 ${fmtPct(w.ret60 || 0)}</small>`;
}

function livePriceMarkup(market, fallbackPrice) {
  const tick = S.tickers.get(market);
  const change = Number(tick?.scr ?? 0) * 100;
  return `<b class="${upDown(change)}">${fmtPrice(tick?.tp ?? fallbackPrice)}</b><small class="${upDown(change)}">${fmtPct(change)}</small>`;
}

function liveHoldingPriceMarkup(market, fallbackPrice, pos) {
  const tick = S.tickers.get(market);
  const change = Number(tick?.scr ?? 0) * 100;
  const cur = fmtPrice(tick?.tp ?? fallbackPrice);
  const entry = pos?.avgPrice ? `${fmtPrice(pos.avgPrice)}원` : '-';
  return `<b class="${upDown(change)}">${cur}</b><span class="entry-sub">진입 ${entry}</span><small class="${upDown(change)}">${fmtPct(change)}</small>`;
}

function liveOrderPriceMarkup(market, fallbackPrice) {
  const tick = S.tickers.get(market);
  const change = Number(tick?.scr ?? 0);
  return `<b class="${upDown(change)}" data-live-order-price="${market}">${fmtPrice(tick?.tp ?? fallbackPrice)}원</b>`;
}

function entryShape(w) {
  const rules = w.entryEvidence?.rules || [];
  const waiting = rules.filter((r) => r.status !== '통과');
  if (!w.warm) return '<b class="table-wait">자료 수집</b><small>실시간 자료 확인 중</small>';
  if (!waiting.length) return '<b class="table-ready">진입 조건 통과</b><small>다음 1분봉 확인</small>';
  return `<b class="table-wait">${esc(waiting[0]?.name || '진입 대기')}</b><small>${esc(waiting[0]?.description || '조건 확인 중')}</small>`;
}

function stateBadge(w) {
  if (w.position) {
    const net = Number(w.position.netPct || 0);
    const cls = net > 0 ? 'holding-up' : net < 0 ? 'holding-down' : 'holding';
    return `<span class="row-state ${cls}">보유 ${fmtPct(net)}</span>`;
  }
  if (!activeSlot()) return '<span class="row-state empty">전략 없음</span>';
  if (!S.config?.autoTrading) return '<span class="row-state pause">자동 정지</span>';
  if (!w.warm) return '<span class="row-state wait">자료 수집</span>';
  if (w.blocked) return `<span class="row-state limit">진입 제한</span>`;
  const e = w.entryEvidence;
  const waiting = e?.rules?.filter((r) => r.status !== '통과') || [];
  return waiting.length ? `<span class="row-state watch">감시 중</span><small>${esc(waiting[0]?.name || '신호 대기')}</small>` : '<span class="row-state ready">진입 가능</span>';
}

function topRows() {
  const rows = holdingRows();
  if (!rows.length) return '<div class="table-empty">현재 보유 중인 코인이 없습니다 · 전체 Binance USDT 마켓은 백그라운드에서 계속 분석합니다</div>';
  return rows.map((w) => {
    const p = w.position;
    const latest = w.last?.reason || '상승 중 보유 · 고점 하락 익절 감시';
    const isSel = w.market === (S.market || holdingRows()[0]?.market);
    const held = `<div class="holding-cell"><div class="holding-info"><b class="${upDown(p.netPnl)}">${signedMoney(p.netPnl)}</b><small>${money(p.cost)} · ${Math.floor((p.heldSec || 0) / 60)}분</small></div><button class="row-sell-btn" data-row-sell="${w.market}" type="button">즉시매도</button></div>`;
    return `<div class="top-row ${isSel ? 'selected' : ''}" data-market="${w.market}" role="button" tabindex="0" aria-label="${esc(nameOf(w.market))} 상세 보기">
      <span class="top-coin"><img class="coin-img" src="${coinIcon(w.market)}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(nameOf(w.market))}</b><small>${sym(w.market)}</small></div></span>
      <span class="top-price top-price-with-entry" data-live-price="${w.market}">${liveHoldingPriceMarkup(w.market, w.price, p)}</span>
      <span class="top-holding">${held}</span>
      <span class="top-decision"><b>${w.last?.kind === 'exit' ? '매도 판단' : '수익 보호'}</b><small>${esc(latest)}</small></span>
      <span class="top-depth">${depthGauge(w)}</span>
      <span class="top-state">${stateBadge(w)}</span>
    </div>`;
  }).join('');
}

function assetTrend() {
  const all = [...(S.equity || [])]; const m = S.summary || {};
  const age = { '1일': 86400e3, '7일': 7 * 86400e3, '30일': 30 * 86400e3, '전체': Infinity }[trendRange];
  const eq = all.filter(([t]) => age === Infinity || t >= Date.now() - age).slice(-160);
  const d = linePath(eq, 420, 76); const positive = Number(m.totalPnl || 0) >= 0;
  return `<section class="asset-trend panel-dark"><div class="trend-head"><div><h3>자산 추이</h3><span class="trend-ranges">${['1일','7일','30일','전체'].map((x) => `<button data-trend-range="${x}" class="${x === trendRange ? 'on' : ''}" type="button">${x}</button>`).join('')}</span></div><b>총 자산 ${money(m.equity || 0)}</b><strong class="${positive ? 'up' : 'down'}">${fmtPct(m.totalPnlPct || 0)}</strong></div><svg viewBox="0 0 420 76" preserveAspectRatio="none" aria-label="총 평가 자산 추이"><defs><linearGradient id="assetFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d94a4a" stop-opacity=".34"/><stop offset="1" stop-color="#d94a4a" stop-opacity="0"/></linearGradient></defs><path d="${d} L420,76 L0,76 Z" fill="url(#assetFill)"/><path d="${d}" fill="none" stroke="${positive ? '#ef5350' : '#3c7fe8'}" stroke-width="2.1"/></svg><div class="trend-foot"><span>시작 ${money(m.initialKrw || 0)}</span><span>평가금액 ${money(m.equity || 0)}</span><span>누적 ${signedMoney(m.totalPnl || 0)}</span></div></section>`;
}

function metric(label, value, cls = '') { return `<div class="metric"><span>${label}</span><b class="${cls}">${value}</b></div>`; }
function accountSummary() {
  const m = S.summary || {}; const j = m.jev || {}; const active = m.activeSlot;
  const win = m.winRate == null ? '-' : `${(m.winRate * 100).toFixed(1)}%`;
  const tWin = m.todayWinRate == null ? '-' : `${(m.todayWinRate * 100).toFixed(1)}%`;
  const jevKrw = Number(j.totalCostUsd || 0) * Number(S.config?.cost?.usdKrw || 0);
  const realized = Number(m.realizedPnl || 0);
  const unrealized = Number(m.totalPnl || 0) - realized;
  const avgHold = m.avgHoldSec == null ? '-' : fmtDur(Number(m.avgHoldSec));
  return `<section class="account-summary panel-dark"><div class="summary-title"><b>계좌 한눈에 보기</b><span>${active ? `${active.id}번 슬롯 · ${esc(active.name)} · 규칙 ${active.rules}개` : '적용된 전략 없음'}</span></div><div class="metrics-line">
    ${metric('총 평가자산', money(m.equity || 0))}${metric('누적 평가손익', signedMoney(m.totalPnl || 0), upDown(m.totalPnl))}${metric('보유 원화', money(m.krw || 0))}${metric('실현 손익', signedMoney(realized), upDown(realized))}${metric('평가 중 손익', signedMoney(unrealized), upDown(unrealized))}${metric('가장 크게 내려간 폭', fmtPct(m.maxDrawdownPct || 0), 'down')}${metric('완료 매매 수', `${m.trades || 0}번`)}${metric('보유 종목', `${m.positions?.length || 0}개`)}${metric('평균 보유 시간', avgHold)}
  </div><div class="metrics-line second">
    ${metric('누적 승률', win)}${metric('오늘 승률', tWin)}${metric('오늘 손익', signedMoney(m.todayPnl || 0), upDown(m.todayPnl))}${metric('오늘 완료 매매', `${m.todayTrades || 0}번`)}${metric('오늘 거래대금', money(m.todayVolume || 0))}${metric('누적 수수료', money(m.feesPaid || 0))}${metric('Jev 호출 수', `${j.totalCalls || 0}회`)}${metric('Jev 오류 수', `${j.totalErrors || 0}회`, Number(j.totalErrors || 0) ? 'warn' : '')}${metric('Jev 예상 사용료', money(jevKrw), 'warn')}
  </div></section>`;
}

function monitorNumber(value, suffix = '', digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : '-';
}

function monitorPath(history, key) {
  return linePath((history || []).map((sample) => [sample.t, Number(sample[key]) || 0]), 320, 56);
}

function monitorChart(title, value, suffix, history, key, tone, digits = 0) {
  const path = monitorPath(history, key);
  return `<article class="monitor-chart ${tone}"><div><span>${title}</span><b>${monitorNumber(value, suffix, digits)}</b></div><svg viewBox="0 0 320 56" preserveAspectRatio="none" aria-label="${title} 최근 기록"><path class="monitor-grid" d="M0 14H320M0 28H320M0 42H320"/><path class="monitor-line" d="${path}"/></svg></article>`;
}

function serverMonitor() {
  const monitor = S.monitor || {};
  const history = Array.isArray(monitor.history) ? monitor.history : [];
  const current = monitor.current || history.at(-1) || { latencyMs: S.status?.avgBinanceLatency ?? S.status?.lastBinanceLatency ?? null };
  const distribution = monitor.distribution || {};
  const monitorInt = (value) => value == null || !Number.isFinite(Number(value)) ? '-' : fmtInt(Number(value));
  const monitoredMarkets = Number(distribution.markets) > 0 ? Number(distribution.markets) : S.markets.length;
  const binanceReceiving = distribution.binanceReceiving ?? !!S.status?.binance;
  const cpuTone = Number(current.cpuPct || 0) >= 80 ? 'warn' : 'cpu';
  return `<section class="server-monitor panel-dark" aria-label="BLACK PC 서버 상태">
    <div class="server-monitor-head"><div><h3>BLACK PC 서버 상태</h3><span>5초마다 측정 · 최근 약 6분 기록</span></div><b class="${binanceReceiving ? 'connected' : 'disconnected'}">${binanceReceiving ? 'Binance 수신 중' : 'Binance 재연결 중'}</b></div>
    <div class="monitor-kpis"><span>감시 마켓 <b>${monitorInt(monitoredMarkets)}개</b></span><span>차트 자료 <b>${monitorInt(distribution.seedActive)}/${monitorInt(distribution.seedConcurrency)}개 처리</b></span><span>대기열 <b>${monitorInt(distribution.seedQueue)}개</b></span><span>실시간 수신 <b>${monitorNumber(current.messagesPerSec, '건/초')}</b></span></div>
    <div class="monitor-charts">${monitorChart('CPU 사용률', current.cpuPct, '%', history, 'cpuPct', cpuTone, 1)}${monitorChart('메모리 사용량', current.rssMb, 'MB', history, 'rssMb', 'memory', 1)}${monitorChart('Binance 실제 수신 지연', current.latencyMs, 'ms', history, 'latencyMs', 'latency')}</div>
    <p class="monitor-note">전체 Binance USDT 마켓을 BLACK PC에서 분석합니다 · 실제 수신 지연은 Binance 이벤트 시각과 BLACK PC 수신 시각의 차이 중앙값입니다 · 과거 차트 자료만 최대 ${fmtInt(distribution.seedConcurrency || 0)}개씩 나눠 불러옵니다</p>
  </section>`;
}

const EXIT_PROFIT_TYPES = new Set(['일반매도최소순이익', '수익보호선켜는수익률', '최고점대비하락익절']);
const EXIT_LOSS_TYPES = new Set(['30선이탈폭', '위험선이탈폭', '손절주의손실률', '손절확인시간', '손절회복여유', '비상손절']);
function exitRuleTitleClass(r) {
  if (EXIT_PROFIT_TYPES.has(r.종류)) return 'exit-profit-title';
  if (EXIT_LOSS_TYPES.has(r.종류)) return 'exit-loss-title';
  return '';
}

function ruleCard(title, rules, group = null) {
  const active = activeSlot(); const enabled = new Set(slotDraft?.enabledRuleIds || active?.enabledRuleIds || []);
  const own = active && group ? slotRuleRows(active, group, rules) : (group ? (rules || []).filter((r) => r.group === group) : (rules || []));
  if (!active) return `<section class="rule-card panel-dark"><div class="rule-title"><h3>${title}</h3></div><p class="rule-empty">슬롯 파일을 적용하면 이곳에 쉬운 설명과 현재값이 나옵니다</p></section>`;
  const rows = own.length ? own.map((r) => `<div class="rule-row state-${r.status === '통과' ? 'pass' : r.status === '자료 부족' ? 'empty' : 'wait'}"><label class="rule-check"><input type="checkbox" data-rule="${esc(r.id)}" ${enabled.has(r.id) ? 'checked' : ''}><span class="sr-only">${stateName(r.status)}</span></label><div class="rule-body"><b class="${exitRuleTitleClass(r)}">${esc(r.name)}</b><small>${esc(r.description)}</small>${ruleGraph(r)}</div><button class="rule-toggle ${enabled.has(r.id) ? 'on' : 'off'}" data-rule-toggle="${esc(r.id)}" type="button">${enabled.has(r.id) ? 'ON' : 'OFF'}</button><button class="copy-rule" data-copy-rule="${esc(r.id)}" type="button">복사</button></div>`).join('') : '<p class="rule-empty">이 슬롯에서 선택한 항목이 없습니다</p>';
  return `<section class="rule-card panel-dark"><div class="rule-title"><div><h3>${title}</h3><span>${esc(active.name)} · 슬롯 관리에서 체크를 바꾼 뒤 위 저장 버튼을 누르세요</span></div></div>${rows}</section>`;
}

function formatActual(v, unit) {
  if (v == null || v === '') return '자료 부족';
  if (unit === '%') return `${Number(v).toFixed(3)}%`;
  if (unit === '원') return money(v);
  if (unit === '초') return `${Math.round(v)}초`;
  if (unit === '개' || unit === '위') return `${Math.round(v)}${unit}`;
  if (unit === '배') return `${Number(v).toFixed(1)}배`;
  return String(v);
}

function ruleGraph(r) {
  const status = r.status || '대기';
  let pct = 0;
  if (status === '통과') {
    pct = 100;
  } else if (status === '자료 부족' || status === '자료가 늦음' || r.actual == null) {
    pct = 8;
  } else {
    const act = Number(r.actual);
    const tar = Number(r.value);
    if (Number.isFinite(act) && Number.isFinite(tar) && tar !== 0) {
      if (['가격한칸손해이하', '매수매도가격차이하', '눌림목허용거리이하', '자동순위이내'].includes(r.type)) {
        pct = act <= tar ? 100 : Math.max(10, Math.min(95, Math.round((tar / Math.max(0.0001, act)) * 100)));
      } else {
        pct = act >= tar ? 100 : Math.max(10, Math.min(95, Math.round((act / tar) * 100)));
      }
    } else {
      pct = 50;
    }
  }
  const color = status === '통과' ? 'pass' : status === '자료 부족' || status === '자료가 늦음' ? 'empty' : 'wait';
  return `<div class="rule-graph ${color}" title="현재 ${formatActual(r.actual, r.unit)} · 기준 ${formatActual(r.value, r.unit)}"><i style="width:${pct}%"></i></div>`;
}

function selectedCoinHistory(market) {
  const rows = [...historyTrades()].filter((x) => x.market === market).reverse().slice(0, 5);
  if (!rows.length) return '<p class="selected-history-empty">이 코인의 거래 기록이 없습니다</p>';
  return `<div class="selected-history-list">${rows.map((t) => `<button class="selected-history-row" data-evidence="${esc(t.id)}" type="button"><img src="${coinIcon(t.market)}" alt=""><span>${fmtTime(t.t)}</span><b class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '매수' : '매도'}</b><em>${t.pnl == null ? '-' : signedMoney(t.pnl)}</em></button>`).join('')}</div>`;
}

function selectedCoinOrderBody(w, p, price) {
  const isLive = S.config?.mode === 'live';
  const orderKrw = S.config?.trade?.orderMode === 'percent'
    ? Math.floor(Number(S.summary?.krw || 0) * Number(S.config?.trade?.orderPct || 0) / 100)
    : Number(S.config?.trade?.orderKrw || 0);
  if (selectedOrderTab === 'history') return `<div class="selected-tab-body selected-history">${selectedCoinHistory(w.market)}</div>`;
  if (selectedOrderTab === 'sell') return `<div class="selected-tab-body"><div class="selected-market-line"><span>실시간 시장가</span>${liveOrderPriceMarkup(w.market, price)}</div><div class="selected-order-line"><span>주문 가능</span><b>${p ? `${fmtQty(p.qty)} ${sym(w.market)}` : '보유 수량 없음'}</b></div><button type="button" class="selected-order-main sell" data-quick="sell" ${p ? '' : 'disabled'}>${isLive ? '시장가 전량 매도' : '모의 전량 매도'}</button></div>`;
  if (selectedOrderTab === 'quick') return `<div class="selected-tab-body"><div class="selected-market-line"><span>실시간 시장가</span>${liveOrderPriceMarkup(w.market, price)}</div><div class="selected-quick-actions"><button type="button" class="buy" data-quick="buy">${isLive ? '시장가 매수' : '모의 매수'}</button><button type="button" class="sell" data-quick="sell" ${p ? '' : 'disabled'}>${isLive ? '전량 매도' : '모의 매도'}</button></div></div>`;
  return `<div class="selected-tab-body"><div class="selected-market-line"><span>실시간 시장가</span>${liveOrderPriceMarkup(w.market, price)}</div><div class="selected-order-line"><span>한 번 주문금액</span><b>${money(orderKrw)}</b></div><button type="button" class="selected-order-main buy" data-quick="buy">${isLive ? '시장가 매수' : '모의 시장가 매수'}</button></div>`;
}

function dataCollectionNotice(w) {
  const missing = [...(w.entryEvidence?.rules || []), ...(w.exitEvidence?.rules || [])].filter((r) => r.status === '자료 부족' || r.status === '자료가 늦음');
  return missing.length ? '실시간 자료 수집 중 · 일부 판단을 기다리고 있습니다' : '';
}

function selectedCoinCard() {
  const w = selected(); const p = w?.position; const t = S.tickers.get(w?.market);
  if (!w) return '<section id="selectedCoinCard" class="selected-card panel-dark"><p class="rule-empty">선별 목록을 받는 중입니다</p></section>';
  const price = t?.tp ?? w.price; const change = Number(t?.scr || 0) * 100;
  const tabs = [['buy', '매수'], ['sell', '매도'], ['quick', '간편주문'], ['history', '거래내역']];
  const holding = p ? `<div><span>보유금액</span><b>${money(p.cost)}</b></div><div><span>평가금액</span><b>${money(p.value)}</b></div><div><span>평가손익</span><b class="${upDown(p.netPnl)}">${signedMoney(p.netPnl)}</b></div><div><span>보유 시간</span><b>${Math.floor(p.heldSec / 60)}분</b></div>` : `<div><span>현재 상태</span><b>${activeSlot() ? '매수 신호 확인 중' : '적용된 전략 없음'}</b></div><div><span>최근 판단</span><b>${esc(w.last?.reason || '자료 확인 중')}</b></div>`;
  return `<section id="selectedCoinCard" class="selected-card panel-dark"><div class="selected-head-inline"><span class="selected-badge">선택 코인</span><div class="selected-coin-title"><img class="selected-title-logo" src="${coinIcon(w.market)}" alt="" onerror="this.style.visibility='hidden'"><b>${esc(nameOf(w.market))}</b><small>${sym(w.market)}</small></div><div class="selected-price-inline ${upDown(change)}" data-live-selected-price="${w.market}"><b>${fmtPrice(price)}원</b><small>${fmtPct(change)}</small></div></div><div class="selected-depth">${depthGauge(w)}</div><div class="position-grid">${holding}</div><div class="selected-tabs">${tabs.map(([id, label]) => `<button type="button" data-selected-tab="${id}" class="${selectedOrderTab === id ? 'on' : ''}">${label}</button>`).join('')}</div>${selectedCoinOrderBody(w, p, price)}</section>`;
}


function tradeChunkTrend() {
  const sells = [...historyTrades()].filter((t) => t.side === 'sell' && t.pnl != null);
  if (!sells.length) {
    return `<section class="trade-trend-section panel-dark">
      <div class="trend-panel-head">
        <div>
          <b>거래 건수별 승률 및 손익 추이 (최근 5건 단위 묶음)</b>
          <span>완료된 매매를 5건씩 묶어 최근 전략 개선에 따른 승률 변화와 실현 손익을 비교합니다</span>
        </div>
        <div class="trend-summary-pill">
          <span>완료 거래 기록 준비 중</span>
        </div>
      </div>
      <div class="trend-empty-card">
        <p>아직 완료된 매매가 없습니다 · 매수 후 청산이 체결되면 5건 단위 승률 카드와 실현 손익 추이가 즉시 표시됩니다</p>
      </div>
    </section>`;
  }
  const chunkSize = 5;
  const chunks = [];
  for (let i = 0; i < sells.length; i += chunkSize) {
    const batch = sells.slice(i, i + chunkSize);
    const wins = batch.filter((t) => Number(t.pnl) >= 0).length;
    const pnl = batch.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const avgPct = batch.reduce((sum, t) => sum + Number(t.pnlPct || 0), 0) / batch.length;
    chunks.push({
      range: `${i + 1}~${i + batch.length}건`,
      count: batch.length,
      wins,
      losses: batch.length - wins,
      winRate: Math.round((wins / batch.length) * 100),
      pnl,
      avgPct
    });
  }

  // Last 10 chunks or all if <= 10
  const displayChunks = chunks.slice(-8);

  const bars = displayChunks.map((c) => {
    const isUp = c.pnl >= 0;
    const rateColor = c.winRate >= 60 ? 'up' : c.winRate >= 40 ? 'warn' : 'down';
    return `<div class="trend-chunk-card">
      <div class="trend-chunk-head"><span>${c.range}</span><b class="${rateColor}">승률 ${c.winRate}%</b></div>
      <div class="trend-chunk-bar"><i class="${c.winRate >= 50 ? 'bar-up' : 'bar-down'}" style="width:${Math.max(6, c.winRate)}%"></i></div>
      <div class="trend-chunk-stats">
        <span>${c.wins}승 ${c.losses}패</span>
        <strong class="${isUp ? 'up' : 'down'}">${c.pnl > 0 ? '+' : ''}${fmtInt(c.pnl)}원</strong>
      </div>
      <small class="${c.avgPct >= 0 ? 'up' : 'down'}">평균 ${c.avgPct > 0 ? '+' : ''}${c.avgPct.toFixed(2)}%</small>
    </div>`;
  }).join('');

  return `<section class="trade-trend-section panel-dark">
    <div class="trend-panel-head">
      <div>
        <b>거래 건수별 승률 및 손익 추이 (최근 5건 단위 묶음)</b>
        <span>완료된 매매를 5건씩 묶어 최근 전략 개선에 따른 승률 변화와 실현 손익을 비교합니다</span>
      </div>
      <div class="trend-summary-pill">
        <span>총 ${sells.length}건 완료</span>
      </div>
    </div>
    <div class="trend-chunks-grid">${bars}</div>
  </section>`;
}

function records() {
  const list = [...historyTrades()].reverse();
  const rows = list.map((t) => {
    const entrySlot = recordedSlot(t);
    const exitSlot = recordedExitSlot(t);
    const slotNote = exitSlot?.id && entrySlot?.id && exitSlot.id !== entrySlot.id
      ? ` · 매도 판단 ${exitSlot.id}번`
      : '';
    const ev = t.evidence?.rules || [];
    const exitRules = ev.filter((r) => r.group === '매도규칙');
    const hoverRules = t.side === 'sell' && exitRules.length
      ? `<div class="record-rule-hover" role="tooltip"><div class="record-rule-hover-title">매도 규칙 점검 내역</div>${exitRules.map((r) => `<div class="record-rule-item ${r.status === '통과' ? 'matched' : ''}"><em>${esc(r.name)}</em><span>${r.status === '통과' ? '발동' : '대기'}</span></div>`).join('')}</div>`
      : t.side === 'sell'
      ? `<div class="record-rule-hover" role="tooltip"><div class="record-rule-hover-title">매도 사유</div><div class="record-rule-item matched"><em>${esc(t.reasonKo || t.reason || '체결')}</em><span>체결</span></div></div>`
      : '';
    const gross = Number(t.gross ?? t.value ?? t.krw ?? 0);
    return `<div class="record-row"><span class="record-time">${fmtTime(t.t)}</span><b class="record-coin"><img src="${coinIcon(t.market)}" alt="" onerror="this.style.visibility='hidden'">${esc(nameOf(t.market))}</b><em class="record-price">${t.price ? `${fmtPrice(t.price)}원` : '-'}</em><em class="record-qty">${t.qty ? fmtQty(t.qty) : '-'}</em><i class="record-side ${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '매수' : '매도'}</i><em class="record-value">${gross > 0 ? money(gross) : '-'}</em><em class="record-fee">${t.fee ? money(t.fee) : '-'}</em><em class="record-pnl ${t.pnl == null ? 'even' : upDown(t.pnl)}">${t.pnl == null ? '-' : signedMoney(t.pnl)}</em><strong class="record-reason" tabindex="0"><span class="record-slot-badge">${esc(slotLabel(entrySlot))}${esc(slotNote)}</span>${esc(t.reasonKo || t.reason || '체결')}${hoverRules}</strong></div>`;
  }).join('');
  const empty = recordSlotFilter === 'all' ? '아직 거래 기록이 없습니다' : `${recordScopeLabel()}의 거래 기록이 없습니다`;
  return `<div class="record-scroll"><div class="record-columns"><span>시간</span><span>코인</span><span>체결가</span><span>수량</span><span>구분</span><span>체결금액</span><span>수수료</span><span>손익</span><span>사유</span></div><div class="record-list">${rows || `<p class="rule-empty">${esc(empty)}</p>`}</div></div>`;
}

function mainHtml() {
  const current = selected(); const entry = current?.entryEvidence?.rules || []; const exit = current?.exitEvidence?.rules || [];
  const active = activeSlot();
  const dataNotice = current ? dataCollectionNotice(current) : '';
  const ruleStatus = applyStatus || dataNotice || '체크한 규칙은 동시에 판단합니다 · 빨강 통과 · 파랑 대기 · 회색 해당 없음';
  const ruleStatusClass = applyStatus ? 'saved' : dataNotice ? 'collecting' : '';
  return `<div class="main-board">
    <section class="main-top">${assetTrend()}${accountSummary()}</section>
    <div class="mobile-main-actions">
      <button data-mobile-action="auto" class="mobile-auto-btn on" type="button">
        자동매매 ON
      </button>
      <button data-mobile-action="connection" type="button">연결</button>
      <button data-mobile-action="slots" type="button">슬롯 관리</button>
      <button data-mobile-action="capital" type="button">투자금액</button>
      <button data-mobile-action="jev" type="button">${activeSlot()?.definition?.Jev설정?.사용 ? 'Jev 켜짐' : '순수 규칙'}</button>
    </div>
    <section class="main-split-area">
      <div class="main-chart-box panel-dark">
        <div class="main-chart-header">
          <div class="main-chart-coin">
            <img id="mainChartIcon" src="${coinIcon(current?.market || S.market)}" alt="" onerror="this.style.visibility='hidden'">
            <b id="mainChartName">${esc(nameOf(current?.market || S.market))}</b>
            <small id="mainChartSym">${sym(current?.market || S.market)}/USDT</small>
          </div>
          <div class="main-chart-tools" id="mainChartTools">
            ${['1', '3', '5', '15', '60', 'D'].map((u) => `<button type="button" data-main-unit="${u}" class="${MC.unit === u ? 'on' : ''}">${u === 'D' ? '일' : `${u}분`}</button>`).join('')}
          </div>
        </div>
        <div class="main-chart-container" id="mainChart"></div>
        <div class="main-chart-loading" id="mainChartLoading">차트 불러오는 중…</div>
      </div>
      <section class="top30 panel-dark">
        <div class="panel-head">
          <div><h2>현재 보유 중인 코인</h2><p>전체 Binance USDT 마켓은 백그라운드에서 분석하고, 이곳에는 현재 보유 코인만 표시합니다</p></div>
          <span>${current ? `${holdingRows().length}개 보유` : '보유 없음'}</span>
        </div>
        <div class="top-head"><span>코인</span><span>현재가/진입가</span><span>보유 손익 · 금액</span><span>수익 보호 상태</span><span>매도 · 매수 힘</span><span>상태</span></div>
        <div class="top-scroll">${topRows()}</div>
      </section>
    </section>
    <section class="rule-layout">${ruleCard('매수 조건 · 체크된 규칙 동시 판단', entry, '코인고르기규칙')}${ruleCard('진입 조건 · 체크된 규칙 동시 판단', entry, '매수규칙')}${ruleCard('매도 조건 · 체크된 규칙 동시 판단', exit, '매도규칙')}${selectedCoinCard()}</section>
    ${tradeChunkTrend()}
    <section class="records panel-dark">${recordPanelInner()}</section>
    ${serverMonitor()}
  </div>`;
}

function modalShell(title, content, variant = '') { return `<div class="main-modal-backdrop" id="mainModal"><section class="main-modal ${variant}"><header><h2>${title}</h2><button data-close-modal type="button">닫기</button></header><div class="main-modal-body">${content}</div></section></div>`; }
function mountModal(title, content, variant = '') { $('#mainModals').innerHTML = modalShell(title, content, variant); $('#mainModal').addEventListener('click', (e) => { if (e.target === $('#mainModal') || e.target.closest('[data-close-modal]')) closeModal(); }); }
function closeModal() { $('#mainModals').innerHTML = ''; }

function slotVersionBook(slot) { return S.config?.slotVersions?.[String(slot.id)] || { activeVersionId: null, items: [] }; }
function versionOptions(slot) { const book=slotVersionBook(slot); return (book.items || []).map((v) => `<option value="${esc(v.id)}" ${v.id === book.activeVersionId ? 'selected' : ''}>${esc(v.number)} · ${esc(v.name)}</option>`).join('') || '<option value="">저장된 버전 없음</option>'; }
function openSlots() {
  const shelf=S.config?.slots; if(!shelf) return toast('슬롯 정보를 받는 중입니다'); selectedSlotId=selectedSlotId||1;
  const slot=shelf.items.find((x)=>x.id===selectedSlotId)||shelf.items[0]; const cards=shelf.items.map((x)=>`<button class="slot-card ${x.id===selectedSlotId?'selected':''} ${x.status==='적용 중'?'active':''}" data-slot-select="${x.id}" type="button"><b>${x.id}번 슬롯</b><strong>${esc(x.definition?x.name:'비어 있음')}</strong><span>${x.status}</span></button>`).join('');
  const rules=slot.rules||[...(slot.definition?.코인고르기규칙||[]),...(slot.definition?.매수규칙||[]),...(slot.definition?.매도규칙||[])].map((r)=>({...r, 적용:(slot.enabledRuleIds||[]).includes(r.규칙번호)})); const versions=slotVersionBook(slot); const versionUi=`<div class="slot-file"><b>전략 버전</b><select id="slotVersionSelect">${versionOptions(slot)}</select><button data-slot-version-apply="${slot.id}" type="button">적용</button><button data-slot-version-copy="${slot.id}" type="button">복사</button><button class="danger-link" data-slot-version-delete="${slot.id}" type="button">삭제</button><small>현재 적용 ${esc(versions.activeVersionId||'-')}</small></div>`;
  const detail=slot.definition?`<div class="slot-detail-head"><div><b>${slot.id}번 슬롯</b><h3>${esc(slot.name)}</h3></div><div class="slot-detail-actions"><button class="main-primary" id="slotApply" type="button">ON OFF 규칙 저장·적용</button></div></div><p>${esc(slot.definition.전략설명)}</p>${versionUi}<div class="slot-file"><b>새 전략 버전 추가</b><span>파일을 추가하면 기존 버전은 보관됩니다</span><button data-slot-file="${slot.id}" type="button">파일 추가</button></div><div class="slot-rule-preview">${rules.map((r)=>`<label><input type="checkbox" data-slot-rule="${esc(r.규칙번호)}" ${r.적용?'checked':''}><b>${esc(r.이름)}</b><span>${esc(r.쉬운설명)}</span></label>`).join('')}</div>`:`<div class="slot-detail-head"><div><b>${slot.id}번 슬롯</b><h3>비어 있음</h3></div></div>${versionUi}<button class="main-primary" data-slot-file="${slot.id}" type="button">+ 첫 전략 버전 추가</button>`;
  mountModal('슬롯 관리 · 버전 보관함',`<div class="slot-manager"><div class="slot-grid">${cards}</div><div class="slot-detail">${detail}</div></div><input id="slotFileInput" type="file" accept=".yujin-slot.json,application/json" hidden>`,'slot-manager-modal'); bindSlotModal(slot);
}
async function slotVersionAction(action, slotId) { const versionId=$('#slotVersionSelect')?.value; if(!versionId)return toast('전략 버전을 선택하세요','err'); if(action==='delete'&&!confirm('선택한 전략 버전만 삭제할까요?'))return; try { const r=await api(`/api/slot-versions/${action}`,{slotId,versionId}); acceptConfig(r.config); if(action==='apply'){slotDraft=null;closeModal();} else openSlots(); toast(action==='apply'?'전략 버전을 적용했습니다':action==='clone'?'전략 버전을 복사했습니다':'선택한 전략 버전을 삭제했습니다'); } catch(e){toast(e.message,'err');} }
function bindSlotModal(slot) { $('#mainModal').addEventListener('click',(e)=>{const select=e.target.closest('[data-slot-select]'); if(select){selectedSlotId=Number(select.dataset.slotSelect);openSlots();return;} const file=e.target.closest('[data-slot-file]');if(file){$('#slotFileInput').dataset.slotId=file.dataset.slotFile;$('#slotFileInput').click();return;} if(e.target.closest('#slotApply'))return applySlotFromModal(slot.id); const apply=e.target.closest('[data-slot-version-apply]');if(apply)return slotVersionAction('apply',Number(apply.dataset.slotVersionApply));const copy=e.target.closest('[data-slot-version-copy]');if(copy)return slotVersionAction('clone',Number(copy.dataset.slotVersionCopy));const del=e.target.closest('[data-slot-version-delete]');if(del)return slotVersionAction('delete',Number(del.dataset.slotVersionDelete));}); $('#slotFileInput')?.addEventListener('change',async(e)=>{const file=e.target.files?.[0];if(!file)return;try{const content=await file.text();const r=await api('/api/slot-versions/add',{slotId:Number(e.target.dataset.slotId),fileName:file.name,content});acceptConfig(r.config);toast('새 전략 버전을 보관했습니다 · 드롭다운에서 선택 후 적용하세요');openSlots();}catch(err){toast(err.message,'err');}});}
function checkedModalRules() { return [...document.querySelectorAll('[data-slot-rule]:checked')].map((x) => x.dataset.slotRule); }
async function applySlotFromModal(id) { try { const r = await api('/api/slots/apply', { slotId: id, enabledRuleIds: checkedModalRules() }); acceptConfig(r.config); slotDraft = null; closeModal(); toast('체크한 규칙으로 슬롯을 적용했습니다'); } catch (e) { toast(e.message, 'err'); } }
async function removeSlot(id) { if (!confirm(`${id}번 슬롯을 비울까요? 자동매매 켜짐은 유지되고, 새 슬롯을 저장할 때까지 신규 진입만 기다립니다.`)) return; try { const r = await api('/api/slots/remove', { slotId: id }); acceptConfig(r.config); slotDraft = null; openSlots(); } catch (e) { toast(e.message, 'err'); } }
function acceptConfig(c) { if (!c) return; S.config = c; bus.emit('cfg', c); }

function openConnection() {
  const c = S.config || {}; const u = c.binance || {}; const j = c.jev || {};
  mountModal('연결', `<div class="form-stack"><label>투자 방식<select id="cMode"><option value="paper" ${c.mode === 'paper' ? 'selected' : ''}>모의투자</option><option value="live" ${c.mode === 'live' ? 'selected' : ''}>실전투자</option></select></label><p class="modal-note">모의와 실전은 같은 슬롯과 같은 근거를 씁니다. 체결되는 곳만 달라집니다.</p><label>Binance 접근 키<input id="cAccess" type="password" placeholder="${u.hasKeys ? '저장됨 · 바꾸려면 새 키 입력' : 'Binance 접근 키'}"></label><label>Binance 비밀 키<input id="cSecret" type="password" placeholder="${u.hasKeys ? '저장됨 · 바꾸려면 새 키 입력' : 'Binance 비밀 키'}"></label><label>Jev 연결 방식<select id="cJevProvider"><option value="auto" ${j.provider === 'auto' ? 'selected' : ''}>자동</option><option value="typesafe" ${j.provider === 'typesafe' ? 'selected' : ''}>TypeSafe 직접</option><option value="openrouter" ${j.provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option><option value="rule" ${j.provider === 'rule' ? 'selected' : ''}>규칙 판단기</option></select></label><label>Jev 키<input id="cJevKey" type="password" placeholder="${j.hasTypesafeKey || j.hasOpenrouterKey ? '저장됨 · 바꾸려면 새 키 입력' : 'Jev 키'}"></label><button id="saveConnection" class="main-primary" type="button">연결 정보 저장</button></div>`);
  $('#saveConnection').addEventListener('click', async () => { try { const patch = { mode: $('#cMode').value, jev: { provider: $('#cJevProvider').value }, binance: {} }; if ($('#cAccess').value) patch.binance.accessKey = $('#cAccess').value; if ($('#cSecret').value) patch.binance.secretKey = $('#cSecret').value; if ($('#cJevKey').value) patch.jev.typesafeKey = $('#cJevKey').value; const c2 = await api('/api/config', patch); acceptConfig(c2); closeModal(); toast('연결 정보를 저장했습니다'); } catch (e) { toast(e.message, 'err'); } });
}

function koreanKrw(amount) {
  const value = Math.floor(Number(amount));
  if (!Number.isSafeInteger(value) || value < 0) return '';
  if (value === 0) return '0원';
  const bigUnits = ['', '만', '억', '조']; const digitUnits = ['', '십', '백', '천'];
  const parts = []; let rest = value;
  for (let i = 0; rest > 0 && i < bigUnits.length; i += 1) {
    const group = rest % 10000;
    if (group) {
      const groupText = String(group).padStart(4, '0').split('').map((digit, index) => {
        const n = Number(digit); return n ? `${n}${digitUnits[3 - index]}` : '';
      }).join('');
      parts.unshift(`${groupText}${bigUnits[i]}`);
    }
    rest = Math.floor(rest / 10000);
  }
  return `${parts.join(' ')}원`;
}
function bindKrwInput(inputId, previewId) {
  const input = $(inputId); const preview = $(previewId);
  if (!input || !preview) return;
  const update = () => {
    const raw = String(input.value || '').trim();
    if (!raw) { preview.textContent = '숫자 또는 1억 형식으로 입력하세요'; return; }
    const amount = parseKrwAmount(raw);
    if (Number.isSafeInteger(amount) && amount >= 0 && !/[억만천백십조]/.test(raw)) input.value = fmtInt(amount);
    preview.textContent = Number.isSafeInteger(amount) && amount >= 0 ? `한글 금액 · ${koreanKrw(amount)}` : '숫자 또는 1억 형식으로 입력하세요';
  };
  input.addEventListener('input', update); input.addEventListener('blur', update); update();
}
function openCapital() {
  const t = S.config?.trade || {}; const p = S.config?.paper || {};
  const paperMode = S.config?.mode !== 'live';
  const initialPaperKrw = Number.isFinite(Number(p.initialKrw)) && Number(p.initialKrw) >= 10000 ? Math.round(Number(p.initialKrw)) : 1000000;
  const paperCapitalField = paperMode
    ? `<label>모의 투자 시작 금액 <small>예: 1억 또는 100,000,000 · 아래 모의 계좌 초기화 버튼을 누르면 이 금액으로 새로 시작합니다</small><input id="capitalInitialKrw" inputmode="numeric" value="${fmtInt(initialPaperKrw)}"><span id="capitalInitialPreview" class="capital-money-preview"></span></label>`
    : `<div class="fixed-cost"><b>모의 투자 시작 금액</b><span>실전투자 중에는 적용되지 않습니다</span></div>`;
  const resetArea = paperMode
    ? `<section class="account-reset"><b>모의 계좌 초기화</b><span>위 모의 투자 시작 금액으로 보유 코인·거래내역·손익을 비우고 새로 시작합니다</span><button id="resetAccount" class="main-danger" type="button">모의 계좌 초기화</button></section>`
    : `<section class="account-reset disabled"><b>모의 계좌 초기화</b><span>실전투자 중에는 사용할 수 없습니다 · Binance 실제 자산은 바뀌지 않습니다</span></section>`;
  mountModal('투자금액과 거래 비용', `<div class="form-stack">${paperCapitalField}<label>주문 방식<select id="capitalMode"><option value="fixed" ${t.orderMode === 'fixed' ? 'selected' : ''}>고정 금액</option><option value="percent" ${t.orderMode === 'percent' ? 'selected' : ''}>보유 원화 비율</option></select></label><label>한 번 주문금액<input id="capitalKrw" inputmode="numeric" value="${fmtInt(Math.round(t.orderKrw || 0))}"><span id="capitalKrwPreview" class="capital-money-preview"></span></label><label>보유 원화 사용 비율<input id="capitalPct" inputmode="decimal" value="${t.orderPct || 0}"></label><label>동시에 보유할 코인 수<input id="capitalPos" inputmode="numeric" value="${t.maxPositions || 1}"></label><div class="fixed-cost"><b>고정 거래 비용</b><span>거래 수수료 ${p.feePct || 0}% · 미끄러짐 ${p.slippagePct || 0}%</span><small>이 값은 체결 결과를 현실적으로 보기 위한 고정값입니다</small></div><button id="saveCapital" class="main-primary" type="button">투자금액 저장</button>${resetArea}</div>`);
  bindKrwInput('#capitalInitialKrw', '#capitalInitialPreview');
  bindKrwInput('#capitalKrw', '#capitalKrwPreview');
  $('#saveCapital').addEventListener('click', async () => {
    try {
      const orderKrw = parseKrwAmount($('#capitalKrw')?.value);
      if (!(orderKrw >= 0)) return toast('한 번 주문금액을 숫자 또는 1억 형식으로 입력하세요', 'err');
      const tradeSettings = {
        orderMode: $('#capitalMode').value,
        orderKrw,
        orderPct: Number($('#capitalPct').value),
        maxPositions: Number($('#capitalPos').value)
      };
      const saveButton = $('#saveCapital');
      saveButton.disabled = true;
      saveButton.textContent = '저장하는 중';
      const c = await api('/api/config', { trade: tradeSettings, userTrade: tradeSettings });
      acceptConfig(c);
      closeModal();
      toast('주문 투자금액을 저장했습니다 · 다음 주문부터 바로 적용됩니다');
    } catch (e) {
      const saveButton = $('#saveCapital');
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = '투자금액 저장'; }
      toast(e.message, 'err');
    }
  });
  $('#resetAccount')?.addEventListener('click', async () => {
    const initialKrw = parseKrwAmount($('#capitalInitialKrw')?.value);
    if (!(initialKrw >= 10000)) return toast('모의 투자 시작 금액은 10,000원 이상으로 입력하세요', 'err');
    if (!confirm(`${fmtInt(initialKrw)}원으로 모의 계좌를 초기화할까요?\n보유 코인, 거래내역, 손익이 모두 지워집니다.`)) return;
    const resetButton = $('#resetAccount');
    resetButton.disabled = true;
    resetButton.textContent = '초기화하는 중';
    try {
      const result = await api('/api/reset', { initialKrw });
      const appliedKrw = Number(result?.initialKrw);
      if (!result?.ok || appliedKrw !== initialKrw || Number(result?.summary?.initialKrw) !== initialKrw) throw new Error('서버가 요청한 모의 투자 시작 금액을 확인하지 못했습니다');
      acceptConfig(result.config);
      S.summary = result.summary;
      closeModal();
      toast(`${fmtInt(appliedKrw)}원으로 모의 계좌를 초기화했습니다`);
    } catch (e) {
      resetButton.disabled = false;
      resetButton.textContent = '모의 계좌 초기화';
      toast(e.message, 'err');
    }
  });
}

function openEvidence(id) {
  const t = (S.trades || []).find((x) => x.id === id); const e = t?.evidence;
  if (!e) return toast('저장된 슬롯 근거가 없습니다');
  const entrySlot = recordedSlot(t);
  const exitSlot = recordedExitSlot(t);
  const exitNote = exitSlot?.id && entrySlot?.id && exitSlot.id !== entrySlot.id ? ` · 매도 판단 ${slotLabel(exitSlot)}` : '';
  mountModal(`${t.reasonKo || '체결'} 당시 근거`, `<div class="evidence-view"><p><b>${esc(slotLabel(entrySlot))}</b>${esc(exitNote)} · 확인 ${fmtTime(e.evaluatedAt, true)}</p>${(e.rules || []).map((r) => `<div><b>${stateName(r.status)} · ${esc(r.name)}</b><span>현재 ${formatActual(r.actual, r.unit)} · 기준 ${formatActual(r.value, r.unit)}</span><small>${esc(r.description)}</small></div>`).join('') || '<p>수동 주문이라 슬롯 근거가 없습니다</p>'}</div>`);
}

function copyRule(id) {
  const w = selected(); const r = [...(w?.entryEvidence?.rules || []), ...(w?.exitEvidence?.rules || [])].find((x) => x.id === id);
  if (!r) return; const slot = activeSlot(); const text = `${slot?.name || '슬롯 없음'}\n${r.name}\n상태: ${stateName(r.status)}\n현재값: ${formatActual(r.actual, r.unit)}\n기준값: ${formatActual(r.value, r.unit)}\n설명: ${r.description}\n확인 시각: ${fmtTime(Date.now(), true)}`;
  navigator.clipboard?.writeText(text).then(() => toast('근거를 복사했습니다')).catch(() => toast('복사 권한을 확인하세요', 'err'));
}

async function toggleJev() {
  const a = activeSlot();
  if (!a) return toast('먼저 슬롯 파일을 적용하세요', 'err');
  try {
    const now = !(a.definition?.Jev설정?.사용);
    const r = await api('/api/slots/jev', { use: now });
    acceptConfig(r.config);
    toast(now ? 'Jev 도움 판단을 켰습니다' : '순수 규칙 판단으로 바꿨습니다');
  } catch (e) { toast(e.message, 'err'); }
}

function bindBoard() {
  const root = $('#view-main');
  root.addEventListener('click', async (e) => {
    const rowSell = e.target.closest('[data-row-sell]');
    if (rowSell) {
      e.stopPropagation();
      const mkt = rowSell.dataset.rowSell;
      try {
        await api('/api/order', { market: mkt, side: 'sell', ratio: 1 });
        toast('보유 코인 전량 매도 요청을 보냈습니다');
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const row = e.target.closest('[data-market]');
    if (row) {
      const targetCode = row.dataset.market;
      if (targetCode) {
        selectMarketFast(targetCode);
        setMarket(targetCode).catch(() => {});
      }
      return;
    }
    const selectedTab = e.target.closest('[data-selected-tab]');
    if (selectedTab) { selectedOrderTab = selectedTab.dataset.selectedTab; saveView({ selectedOrderTab }); patchSelectedCoinCard(); return; }
    const record = e.target.closest('[data-record]'); if (record) { recordTab = record.dataset.record; saveView({ recordTab }); render(); return; }
    const recordSlot = e.target.closest('[data-record-slot]');
    if (recordSlot) {
      const value = recordSlot.dataset.recordSlot;
      recordSlotFilter = value === 'all' || value === 'active' ? value : Number(value);
      saveView({ recordSlotFilter }); render(); return;
    }
    const range = e.target.closest('[data-trend-range]'); if (range) { trendRange = range.dataset.trendRange; saveView({ trendRange }); render(); return; }
    const evidence = e.target.closest('[data-evidence]'); if (evidence) return openEvidence(evidence.dataset.evidence);
    const ruleToggle = e.target.closest('[data-rule-toggle]'); if (ruleToggle) { const input = root.querySelector(`[data-rule="${ruleToggle.dataset.ruleToggle}"]`); if (input) { input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true })); ruleToggle.textContent = input.checked ? 'ON' : 'OFF'; ruleToggle.className = `rule-toggle ${input.checked ? 'on' : 'off'}`; } return; }
    const copy = e.target.closest('[data-copy-rule]'); if (copy) return copyRule(copy.dataset.copyRule);
    const mobile = e.target.closest('[data-mobile-action]');
    if (mobile) {
      if (mobile.dataset.mobileAction === 'auto') return toggleAuto();
      const actions = { slots: openSlots, connection: openConnection, capital: openCapital, jev: toggleJev };
      return actions[mobile.dataset.mobileAction]?.();
    }
    if (e.target.closest('#applyRules')) return applyDraft();
    const quick = e.target.closest('[data-quick]'); if (quick) return quickOrder(quick.dataset.quick);
  });
  root.addEventListener('keydown', async (e) => {
    if (!['Enter', ' '].includes(e.key) || e.target.closest('[data-row-sell]')) return;
    const row = e.target.closest('.top-row[data-market]');
    if (!row) return;
    e.preventDefault();
    selectMarketFast(row.dataset.market);
    setMarket(row.dataset.market).catch(() => {});
  });
  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-rule]')) return;
    const active = activeSlot(); if (!active) return;
    slotDraft ||= { slotId: active.id, enabledRuleIds: [...active.enabledRuleIds] };
    if (slotDraft.slotId !== active.id) slotDraft = { slotId: active.id, enabledRuleIds: [...active.enabledRuleIds] };
    const set = new Set(slotDraft.enabledRuleIds); if (e.target.checked) set.add(e.target.dataset.rule); else set.delete(e.target.dataset.rule); slotDraft.enabledRuleIds = [...set];
  });
  const markInteracting = () => {
    lastInteraction = Date.now();
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => {
      interactionTimer = null;
      if (renderPending) scheduleRender();
    }, SCROLL_IDLE_MS);
  };
  root.addEventListener('pointerdown', markInteracting, { passive: true });
  root.addEventListener('touchstart', markInteracting, { passive: true });
  window.addEventListener('wheel', markInteracting, { passive: true });
  window.addEventListener('scroll', markInteracting, { passive: true });
  root.addEventListener('scroll', markInteracting, { capture: true, passive: true });
  $('#slotHeader').addEventListener('click', openSlots);
  $('#chipBinance')?.addEventListener('click', openConnection);
  $('#capitalHeader').addEventListener('click', openCapital);
  $('#voiceHeader').addEventListener('click', () => { const a = S.config?.alerts || {}; mountModal('음성 볼륨', `<div class="form-stack"><label>체결 음성 안내<select id="voiceOn"><option value="true" ${a.voiceEnabled ? 'selected' : ''}>켜기</option><option value="false" ${!a.voiceEnabled ? 'selected' : ''}>끄기</option></select></label><label>볼륨 <input id="voiceRange" type="range" min="0" max="100" value="${Math.round((a.voiceVolume || 0) * 100)}"><output id="voiceOut">${Math.round((a.voiceVolume || 0) * 100)}%</output></label><button id="saveVoice" class="main-primary" type="button">음성 설정 저장</button></div>`); $('#voiceRange').addEventListener('input', () => { $('#voiceOut').textContent = `${$('#voiceRange').value}%`; }); $('#saveVoice').addEventListener('click', async () => { try { const c = await api('/api/config', { alerts: { voiceEnabled: $('#voiceOn').value === 'true', voiceVolume: Number($('#voiceRange').value) / 100 } }); acceptConfig(c); closeModal(); } catch (e) { toast(e.message, 'err'); } }); });
  $('#chipJev')?.addEventListener('click', toggleJev);
  $('#mainChartTools')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-main-unit]');
    if (!btn) return;
    MC.unit = btn.dataset.mainUnit;
    localStorage.setItem('mu-unit', MC.unit);
    $$('#mainChartTools button').forEach((b) => b.classList.toggle('on', b === btn));
    loadMainChart();
  });
}

function selectMarketFast(code) {
  if (!code) return;
  S.market = code;
  localStorage.setItem('mu-market', code);
  const root = $('#view-main');
  if (root) {
    root.querySelectorAll('.top-row[data-market]').forEach((el) => {
      el.classList.toggle('selected', el.dataset.market === code);
    });
  }
  patchSelectedCoinCard();
  patchRuleCards();
  loadMainChart();
}

function patchRuleCards() {
  const current = selected();
  const entry = current?.entryEvidence?.rules || [];
  const exit = current?.exitEvidence?.rules || [];
  const cards = $$('#view-main .rule-card');
  if (cards.length >= 3) {
    cards[0].outerHTML = ruleCard('매수 조건 · 체크된 규칙 동시 판단', entry, '코인고르기규칙');
    cards[1].outerHTML = ruleCard('진입 조건 · 체크된 규칙 동시 판단', entry, '매수규칙');
    cards[2].outerHTML = ruleCard('매도 조건 · 체크된 규칙 동시 판단', exit, '매도규칙');
  }
}

function patchSelectedCoinCard() {
  const card = $('#selectedCoinCard');
  // 탭은 이 작은 카드만 바뀐다. 전체 관제판을 다시 만들면 보유표·거래내역·그래프까지
  // 매번 재구성돼 클릭 반응이 늦어지므로, 카드 한 장만 즉시 교체한다.
  if (card) card.outerHTML = selectedCoinCard();
  else scheduleRender();
}

async function applyDraft() {
  const a = activeSlot(); if (!a) return; const ids = slotDraft?.slotId === a.id ? slotDraft.enabledRuleIds : a.enabledRuleIds;
  try {
    const r = await api('/api/slots/apply', { slotId: a.id, enabledRuleIds: ids });
    acceptConfig(r.config); slotDraft = null; applyStatus = r.baselineCreated ? '저장되었습니다 · 새 분석 기준선이 시작되었습니다' : '저장되었습니다 · 같은 전략이라 기존 분석 기준선을 유지합니다'; render();
    setTimeout(() => { if (applyStatus) { applyStatus = ''; render(); } }, 2600);
  } catch (e) { toast(e.message, 'err'); }
}
async function quickOrder(side) {
  const w = selected(); if (!w) return; try { const body = side === 'buy' ? { market: w.market, side, krw: S.config?.trade?.orderMode === 'percent' ? Math.floor((S.summary?.krw || 0) * (S.config.trade.orderPct || 0) / 100) : S.config?.trade?.orderKrw } : { market: w.market, side, ratio: 1 }; await api('/api/order', body); toast(side === 'buy' ? '매수 요청을 보냈습니다' : '매도 요청을 보냈습니다'); } catch (e) { toast(e.message, 'err'); } }

function render() {
  if (Date.now() - lastInteraction < SCROLL_IDLE_MS) {
    renderPending = true;
    return;
  }
  const root = $('#view-main'); if (!root) return;
  const board = root.querySelector('.main-board');
  if (!board) {
    root.innerHTML = mainHtml();
    initMainChart();
    return;
  }
  const x = window.scrollX; const y = window.scrollY;
  const topScrollEl = root.querySelector('.top-scroll');
  const topScrollPos = topScrollEl ? topScrollEl.scrollTop : null;
  const recScrollEl = root.querySelector('.record-scroll');
  const recScrollPos = recScrollEl ? recScrollEl.scrollTop : null;

  const current = selected();
  const entry = current?.entryEvidence?.rules || [];
  const exit = current?.exitEvidence?.rules || [];
  const active = activeSlot();
  const dataNotice = current ? dataCollectionNotice(current) : '';
  const ruleStatus = applyStatus || dataNotice || '체크한 규칙은 동시에 판단합니다 · 빨강 통과 · 파랑 대기 · 회색 해당 없음';
  const ruleStatusClass = applyStatus ? 'saved' : dataNotice ? 'collecting' : '';

  const topSec = root.querySelector('.main-top');
  if (topSec) topSec.innerHTML = `${assetTrend()}${accountSummary()}`;

  const headCount = root.querySelector('.panel-head span');
  if (headCount) headCount.textContent = current ? `${holdingRows().length}개 보유` : '보유 없음';

  const topScroll = root.querySelector('.top-scroll');
  if (topScroll) topScroll.innerHTML = topRows();


  const ruleLay = root.querySelector('.rule-layout');
  if (ruleLay) ruleLay.innerHTML = `${ruleCard('매수 조건 · 체크된 규칙 동시 판단', entry, '코인고르기규칙')}${ruleCard('진입 조건 · 체크된 규칙 동시 판단', entry, '매수규칙')}${ruleCard('매도 조건 · 체크된 규칙 동시 판단', exit, '매도규칙')}${selectedCoinCard()}`;

  const trendSec = root.querySelector('.trade-trend-section');
  if (trendSec) trendSec.outerHTML = tradeChunkTrend();

  const recSec = root.querySelector('.records');
  if (recSec) recSec.innerHTML = recordPanelInner();

  const monSec = root.querySelector('.server-monitor');
  if (monSec) monSec.outerHTML = serverMonitor();

  const restoreScroll = () => {
    if (topScrollPos != null) {
      const newTop = root.querySelector('.top-scroll');
      if (newTop) newTop.scrollTop = topScrollPos;
    }
    if (recScrollPos != null) {
      const newRec = root.querySelector('.record-scroll');
      if (newRec) newRec.scrollTop = recScrollPos;
    }
    window.scrollTo({ left: x, top: y, behavior: 'auto' });
  };
  restoreScroll();
  requestAnimationFrame(() => requestAnimationFrame(restoreScroll));
  if (active && (!slotDraft || slotDraft.slotId !== active.id)) {
    slotDraft = { slotId: active.id, enabledRuleIds: [...active.enabledRuleIds] };
  }
  if (!MC.chart) initMainChart();
  else drawMainChartPriceLines();
}

function initMainChart() {
  const container = $('#mainChart');
  if (!container || !window.LightweightCharts) return;
  if (MC.chart) {
    try { MC.chart.remove(); } catch {}
    MC.chart = null;
  }
  const LW = window.LightweightCharts;
  MC.chart = LW.createChart(container, {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#0b1320' }, textColor: '#8fa2b8', fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: '#162234' }, horzLines: { color: '#162234' } },
    rightPriceScale: { borderColor: '#1f2e45' },
    timeScale: { borderColor: '#1f2e45', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'ko-KR', priceFormatter: (p) => fmtPrice(p) }
  });
  MC.candle = MC.chart.addCandlestickSeries({
    upColor: '#ef5350', downColor: '#3c7fe8', borderUpColor: '#ef5350', borderDownColor: '#3c7fe8', wickUpColor: '#ef5350', wickDownColor: '#3c7fe8',
    priceFormat: { type: 'custom', formatter: (p) => fmtPrice(p), minMove: 0.00000001 }
  });
  MC.vol = MC.chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  MC.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  loadMainChart();
}

async function loadMainChart() {
  const market = S.market || holdingRows()[0]?.market || 'KRW-BTC';
  const unit = MC.unit || '1';
  const id = ++MC.reqId;
  const loader = $('#mainChartLoading');
  if (loader) loader.classList.add('on');
  const icon = $('#mainChartIcon');
  const name = $('#mainChartName');
  const symEl = $('#mainChartSym');
  if (icon) { icon.src = coinIcon(market); icon.style.visibility = 'visible'; }
  if (name) name.textContent = nameOf(market);
  if (symEl) symEl.textContent = `${sym(market)}/USDT`;
  try {
    const rows = await api(`/api/candles?market=${market}&unit=${unit}&count=160`);
    if (id !== MC.reqId || !MC.candle) return;
    MC.data = rows; MC.market = market;
    MC.candle.setData(rows.map((c) => ({ time: Math.floor(c.t / 1000) + KST, open: c.o, high: c.h, low: c.l, close: c.c })));
    MC.vol.setData(rows.map((c) => ({ time: Math.floor(c.t / 1000) + KST, value: c.v, color: c.c >= c.o ? 'rgba(239,83,80,0.45)' : 'rgba(60,127,232,0.45)' })));
    drawMainChartPriceLines();
    requestAnimationFrame(() => {
      if (MC.chart && rows.length) {
        MC.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - 80), to: rows.length + 4 });
      }
    });
  } catch {} finally {
    if (id === MC.reqId && loader) loader.classList.remove('on');
  }
}

function drawMainChartPriceLines() {
  if (!MC.candle) return;
  MC.lines.forEach((l) => { try { MC.candle.removePriceLine(l); } catch {} });
  MC.lines = [];
  const p = S.summary?.positions?.find((pos) => pos.market === (S.market || holdingRows()[0]?.market));
  if (!p?.avgPrice) return;
  const line = MC.candle.createPriceLine({
    price: p.avgPrice,
    color: '#ffb74d',
    lineWidth: 1,
    lineStyle: 2,
    axisLabelVisible: true,
    title: `진입가 ${fmtPrice(p.avgPrice)}원`
  });
  MC.lines.push(line);
}

function scheduleRender() {
  renderPending = true;
  // Never replace the main DOM while a page, TOP30, or record list scroll is still moving.
  // The interaction timer above schedules exactly one refresh after the final scroll event.
  if (Date.now() - lastInteraction < SCROLL_IDLE_MS) return;
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (Date.now() - lastInteraction < SCROLL_IDLE_MS) return;
    if (!renderPending) return;
    renderPending = false;
    render();
  }, 120);
}

function patchTickerCells() {
  tickerPatchFrame = null;
  const root = $('#view-main');
  const changed = [...tickerPatchMarkets];
  tickerPatchMarkets.clear();
  if (!root || !changed.length) return;
  const watch = new Map((S.watch || []).map((w) => [w.market, w]));
  for (const market of changed) {
    const fallbackPrice = watch.get(market)?.price ?? S.tickers.get(market)?.tp;
    const change = Number(S.tickers.get(market)?.scr ?? 0) * 100;
    root.querySelectorAll(`[data-live-price="${market}"]`).forEach((el) => {
      const pos = S.summary?.positions?.find((p) => p.market === market);
      el.innerHTML = liveHoldingPriceMarkup(market, fallbackPrice, pos);
    });
    root.querySelectorAll(`[data-live-selected-price="${market}"]`).forEach((el) => {
      el.classList.remove('up', 'down', 'even');
      el.classList.add(upDown(change));
      el.innerHTML = `<b>${fmtPrice(S.tickers.get(market)?.tp ?? fallbackPrice)}원</b><small>${fmtPct(change)}</small>`;
    });
    root.querySelectorAll(`[data-live-order-price="${market}"]`).forEach((el) => {
      el.className = upDown(change);
      el.textContent = `${fmtPrice(S.tickers.get(market)?.tp ?? fallbackPrice)}원`;
    });
  }
}

function scheduleTickerPatch(list = []) {
  for (const item of list) {
    const market = Array.isArray(item) ? item[0] : item?.cd;
    if (typeof market === 'string') tickerPatchMarkets.add(market);
  }
  if (!tickerPatchMarkets.size || tickerPatchFrame) return;
  // Keep every server push live, but coalesce bursts into the next browser paint.
  tickerPatchFrame = requestAnimationFrame(patchTickerCells);
}


function bindReasonHover() {
  const root = $('#view-main');
  const popover = $('#reasonPopover');
  if (!root || !popover) return;

  function showPop(target) {
    const hoverEl = target.querySelector('.record-rule-hover');
    if (!hoverEl) return;

    popover.innerHTML = hoverEl.innerHTML;
    popover.classList.add('on');

    const rect = target.getBoundingClientRect();
    const popWidth = 260;
    let left = rect.left + window.scrollX - popWidth - 10;
    if (left < 10) {
      left = rect.right + window.scrollX + 10;
    }
    let top = rect.top + window.scrollY - 10;
    if (top < 10) top = 10;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function hidePop() {
    popover.classList.remove('on');
    popover.innerHTML = '';
  }

  // Use mouseover & mouseout which bubble reliably
  root.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.record-reason');
    if (target) showPop(target);
  });

  root.addEventListener('mouseout', (e) => {
    const target = e.target.closest('.record-reason');
    if (target) {
      const rel = e.relatedTarget;
      if (!target.contains(rel)) hidePop();
    }
  });

  // Also support touch / click for mobile accessibility
  root.addEventListener('click', (e) => {
    const target = e.target.closest('.record-reason');
    if (target) {
      if (popover.classList.contains('on')) hidePop();
      else showPop(target);
    }
  });
}

export function initMainBoard() {
  render();
  bindReasonHover(); bindBoard();
  bus.on('init', scheduleRender); bus.on('sum', scheduleRender); bus.on('monitor', scheduleRender); bus.on('cfg', scheduleRender); bus.on('dec', scheduleRender); bus.on('fill', scheduleRender);
  bus.on('tk', scheduleTickerPatch); bus.on('vt', (ticker) => scheduleTickerPatch([ticker]));
}
export function onMainRoute() { render(); }
