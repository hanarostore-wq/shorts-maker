import { $, $$, h, esc, fmtPrice, fmtKrw, fmtInt, fmtPct, fmtSigned, fmtQty, fmtMillion, fmtDur, fmtTime, ago, upDown, sym, bus, S, saveFavs, nameOf, api, setMarket, toast, orderNotice, coinIcon, refreshLiveAccount } from './core.js?v=1.10.68';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const posOf = (code) => S.config?.mode === 'live'
  ? S.liveAccount?.positions?.find((p) => p.market === code) || null
  : S.summary?.positions?.find((p) => p.market === code) || null;
const watchOf = (code) => S.watch.find((w) => w.market === code) || null;
const isWatched = (code) => S.watch.some((w) => w.market === code && w.watched);
const isPinned = (code) => !!S.config?.markets?.includes(code);
const rankOf = (code) => S.screener?.rows?.find((r) => r.code === code)?.rank ?? null;
const watchSig = () => S.watch.filter((w) => w.watched).map((w) => w.market).sort().join();

// =====================================================================================
// Market list (right side)
// =====================================================================================
const ML = { tab: 'auto', sort: 'rank', asc: true, q: '', rows: new Map(), order: [], sig: '' };

function setMobileList(open) {
  const side = $('#side');
  const button = $('#mobileListBtn');
  side.classList.toggle('open', !!open);
  document.body.classList.toggle('mobile-list-open', !!open);
  if (button) button.textContent = open ? '목록 닫기' : '코인 목록';
}

function rankRow(code) { return S.screener?.rows?.find((r) => r.code === code) || null; }

function buildRow(m) {
  const row = h('div', { class: 'mrow', 'data-code': m.code });
  row.innerHTML = `<span class="mrank"></span><span class="star">★</span><span class="nm"><b></b><em>${sym(m.code)}/USDT</em></span><span class="pr num"></span><span class="rt num"><b></b><em></em></span><span class="am num"></span>`;
  row.addEventListener('click', (e) => {
    if (e.target.classList.contains('star')) {
      e.stopPropagation();
      if (S.favs.has(m.code)) S.favs.delete(m.code); else S.favs.add(m.code);
      saveFavs(); paintRow(m.code, true); if (ML.tab === 'fav') renderList(true);
      return;
    }
    setMarket(m.code);
    if (window.innerWidth <= 1180) setMobileList(false);
  });
  const r = { el: row, rank: row.children[0], star: row.children[1], name: row.querySelector('.nm b'), pr: row.children[3], rtB: row.querySelector('.rt b'), rtE: row.querySelector('.rt em'), am: row.children[5], last: null };
  ML.rows.set(m.code, r);
  paintRow(m.code, true);
  return row;
}

function paintRow(code, full = false) {
  const r = ML.rows.get(code);
  if (!r) return;
  const t = S.tickers.get(code);
  if (full) {
    const m = S.marketMap.get(code);
    const held = !!posOf(code);
    const ranked = rankRow(code);
    r.name.innerHTML = `${esc(m?.ko || code)}${held ? '<span class="tag h">보유</span>' : ''}${isWatched(code) ? '<span class="tag a">자동</span>' : ''}${m?.warning ? '<span class="tag w">유의</span>' : ''}`;
    r.star.classList.toggle('on', S.favs.has(code));
    r.rank.className = 'mrank';
    if (ranked) {
      const move = ranked.isNew ? '<i class="new">NEW</i>' : ranked.delta > 0 ? `<i class="up">▲${ranked.delta}</i>` : ranked.delta < 0 ? `<i class="down">▼${-ranked.delta}</i>` : '<i>-</i>';
      r.rank.innerHTML = `<b>${ranked.rank}</b>${move}`;
    } else r.rank.textContent = '-';
    r.el.classList.toggle('sel', code === S.market);
  }
  if (!t) return;
  const cls = upDown(t.scr);
  if (r.last !== t.tp) {
    r.pr.textContent = fmtPrice(t.tp);
    r.pr.className = `pr num ${cls}`;
    if (r.last != null) {
      r.pr.classList.add(t.tp > r.last ? 'fu' : 'fd');
      clearTimeout(r.ft);
      r.ft = setTimeout(() => r.pr.classList.remove('fu', 'fd'), 400);
    }
    r.last = t.tp;
  }
  r.rtB.textContent = fmtPct((t.scr || 0) * 100);
  r.rtB.className = cls;
  r.rtE.textContent = fmtSigned(t.scp);
  r.rtE.className = cls;
  r.am.innerHTML = `${fmtMillion(t.atp24h)}<i>백만</i>`;
}

function visibleCodes() {
  const q = ML.q.trim().toLowerCase();
  let list = S.markets;
  if (ML.tab === 'hold') {
    const positions = S.config?.mode === 'live' ? S.liveAccount?.positions || [] : S.summary?.positions || [];
    const held = new Set(positions.map((p) => p.market)); list = list.filter((m) => held.has(m.code));
  }
  else if (ML.tab === 'auto') list = list.filter((m) => isWatched(m.code));
  else if (ML.tab === 'fav') list = list.filter((m) => S.favs.has(m.code));
  if (q) list = list.filter((m) => m.ko.toLowerCase().includes(q) || m.en.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
  if (ML.tab === 'auto') {
    return list.slice().sort((a, b) => {
      const ar = rankRow(a.code)?.rank ?? Number.MAX_SAFE_INTEGER;
      const br = rankRow(b.code)?.rank ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      const av = S.tickers.get(a.code)?.atp24h ?? 0, bv = S.tickers.get(b.code)?.atp24h ?? 0;
      return bv - av;
    }).map((m) => m.code);
  }
  const key = {
    name: (m) => m.ko,
    price: (m) => S.tickers.get(m.code)?.tp ?? 0,
    rate: (m) => S.tickers.get(m.code)?.scr ?? 0,
    amt: (m) => S.tickers.get(m.code)?.atp24h ?? 0
  }[ML.sort];
  list = [...list].sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y;
    return ML.asc ? c : -c;
  });
  return list.map((m) => m.code);
}

function bindSortHeaders() {
  $$('#mHead span[data-sort]').forEach((s) => s.addEventListener('click', () => {
    const k = s.dataset.sort;
    if (ML.sort === k) ML.asc = !ML.asc; else { ML.sort = k; ML.asc = k === 'name'; }
    $$('#mHead span').forEach((x) => x.classList.remove('sort', 'asc'));
    s.classList.add('sort'); if (ML.asc) s.classList.add('asc');
    renderList(true);
  }));
}

function setListHeader() {
  const head = $('#mHead');
  if (ML.tab === 'hold') {
    if (head.classList.contains('hold-head')) return;
    head.className = 'mhead hold-head';
    head.innerHTML = '<span>보유 코인</span><span>진입가</span><span>현재가</span><span>실시간 손익</span>';
    return;
  }
  if (ML.tab === 'auto') {
    if (head.classList.contains('rank-head')) return;
    head.className = 'mhead rank-head';
    head.innerHTML = '<span>순위</span><span></span><span>코인</span><span>현재가</span><span>전일대비</span><span>거래대금</span>';
    return;
  }
  if (!head.classList.contains('hold-head') && !head.classList.contains('rank-head')) return;
  head.className = 'mhead';
  head.innerHTML = '<span></span><span></span><span data-sort="name">한글명</span><span data-sort="price">현재가</span><span data-sort="rate">전일대비</span><span data-sort="amt" class="sort">거래대금</span>';
  bindSortHeaders();
}

function holdRow(code) {
  const p = posOf(code);
  const m = S.marketMap.get(code);
  const row = h('div', { class: `mhold-row${code === S.market ? ' sel' : ''}`, 'data-code': code });
  const pnl = p?.netPnl ?? 0;
  row.innerHTML = `<span class="hn"><b>${esc(m?.ko || code)}</b><em>${sym(code)}/USDT</em></span>
    <span class="hp num">${fmtPrice(p?.avgPrice)}</span>
    <span class="hp num">${fmtPrice(p?.mark)}</span>
    <span class="hp num ${upDown(pnl)}"><b>${fmtSigned(pnl, fmtInt)}원</b><em>${fmtPct(p?.netPct)}</em></span>`;
  row.addEventListener('click', () => { setMarket(code); if (window.innerWidth <= 1180) setMobileList(false); });
  return row;
}

function renderList(force = false) {
  const codes = visibleCodes();
  const box = $('#mList');
  setListHeader();
  if (!codes.length) {
    const msg = ML.q ? '검색 결과가 없습니다' : ML.tab === 'hold' ? '보유 중인 코인이 없습니다' : ML.tab === 'auto' ? (S.screener?.enabled ? '자동 선별기가 Binance USDT 마켓 전체를 실시간 분석 중입니다<br>약 1분 뒤 TOP 코인이 채워집니다' : '자동매매 감시 코인이 없습니다<br>설정에서 TOP 자동 선별을 켜거나 코인을 고정하세요') : '관심 코인이 없습니다 (★ 눌러 추가)';
    box.innerHTML = `<div class="empty">${msg}</div>`;
    ML.order = [];
    return;
  }
  // A holdings row is re-rendered every summary push because entry/current prices and net exit PnL change live.
  if (ML.tab === 'hold') {
    const frag = document.createDocumentFragment();
    for (const c of codes) frag.append(holdRow(c));
    box.replaceChildren(frag);
    ML.order = codes;
    return;
  }
  if (!force && codes.join() === ML.order.join()) return;
  const frag = document.createDocumentFragment();
  for (const c of codes) {
    const r = ML.rows.get(c);
    if (r && force) paintRow(c, true);
    frag.append(r ? r.el : buildRow(S.marketMap.get(c)));
  }
  box.replaceChildren(frag);
  ML.order = codes;
}

function refreshTags() {
  const held = (S.summary?.positions || []).map((p) => p.market).sort().join();
  const ws = watchSig();
  const sig = `${held}|${ws}|${S.market}`;
  const wn = ws ? ws.split(',').length : 0;
  $('#holdCnt').textContent = S.summary?.positions?.length ? ` ${S.summary.positions.length}` : '';
  $('#autoCnt').textContent = wn ? ` ${wn}` : '';
  if (sig === ML.sig) return;
  ML.sig = sig;
  for (const code of ML.rows.keys()) paintRow(code, true);
  if (ML.tab === 'hold' || ML.tab === 'auto') renderList(true);
}

function initList() {
  $('#mSearch').addEventListener('input', (e) => { ML.q = e.target.value; renderList(true); });
  $$('#mTabs a').forEach((a) => a.addEventListener('click', () => {
    $$('#mTabs a').forEach((x) => x.classList.toggle('on', x === a));
    ML.tab = a.dataset.mtab;
    // Rank is meaningful only for the automatic watch list. Other tabs use a supported market sort.
    if (ML.tab === 'auto') { ML.sort = 'rank'; ML.asc = true; }
    else if (ML.sort === 'rank') { ML.sort = 'amt'; ML.asc = false; }
    renderList(true);
  }));
  bindSortHeaders();
  $('#mobileListBtn').addEventListener('click', () => { setMobileList(!$('#side').classList.contains('open')); });
  $('#sideClose').addEventListener('click', () => setMobileList(false));
  window.addEventListener('resize', () => { if (window.innerWidth > 1180) setMobileList(false); });
  setInterval(() => { if (ML.sort !== 'name') renderList(); }, 3000);
}

// =====================================================================================
// Coin header
// =====================================================================================
function renderHeader() {
  const code = S.market;
  const m = S.marketMap.get(code);
  const t = S.viewTicker || S.tickers.get(code);
  const icon = $('#coinIcon');
  if (icon.dataset.code !== code) { icon.dataset.code = code; icon.style.visibility = 'visible'; icon.src = coinIcon(code); }
  $('#coinName').textContent = m?.ko || code;
  $('#coinSym').textContent = `${sym(code)}/USDT`;
  const pos = posOf(code);
  $('#coinBadges').innerHTML = `${pos ? '<span class="badge hold">보유 중</span> ' : ''}${isWatched(code) ? `<span class="badge auto">자동매매 ${S.config?.autoTrading ? '감시 중' : '정지'}</span>` : '<span class="badge off">자동매매 꺼짐</span>'}${m?.warning ? ' <span class="badge warnb">유의</span>' : ''}`;
  if (!t) return;
  const cls = upDown(t.scr);
  $('#pPrice').textContent = fmtPrice(t.tp);
  $('#pPrice').parentElement.className = `big ${cls}`;
  $('#pRate').textContent = fmtPct((t.scr || 0) * 100);
  $('#pRate').className = cls;
  $('#pDiff').textContent = `${t.scp > 0 ? '▲' : t.scp < 0 ? '▼' : ''}${fmtPrice(Math.abs(t.scp || 0))}`;
  $('#pDiff').className = cls;
  if (t.hp != null) {
    $('#sHigh').textContent = fmtPrice(t.hp);
    $('#sLow').textContent = fmtPrice(t.lp);
    $('#sVol').innerHTML = `${(t.atv24h ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: t.atv24h < 100000 ? 3 : 0 })}<i>${sym(code)}</i>`;
    $('#sAmt').innerHTML = `${fmtInt(t.atp24h)}<i>KRW</i>`;
  }
  document.title = `${fmtPrice(t.tp)} ${sym(code)} ${fmtPct((t.scr || 0) * 100)} · YuJin Traders`;
}

// =====================================================================================
// Chart
// =====================================================================================
const KST = 9 * 3600;
const MA_DEF = [[5, '#e0457b'], [10, '#3a78d8'], [20, '#f59e0b'], [60, '#16a34a'], [120, '#8b5cf6']];
const CH = { chart: null, candle: null, vol: null, mas: [], unit: localStorage.getItem('mu-unit') || '1', data: [], market: null, marks: true, lines: [], reqId: 0, posSig: '', ignoreOlderUntil: 0 };
const tsec = (t) => Math.floor(t / 1000) + KST;
const unitMs = (u) => (u === 'D' ? 86400000 : u === 'W' ? 7 * 86400000 : u === 'M' ? 0 : Number(u) * 60000);
const volColor = (c) => (c.c >= c.o ? 'rgba(200,74,49,0.45)' : 'rgba(18,97,196,0.45)');

function initChart() {
  const LW = window.LightweightCharts;
  CH.chart = LW.createChart($('#chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#333', fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
    rightPriceScale: { borderColor: '#e1e3e8' },
    timeScale: { borderColor: '#e1e3e8', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'ko-KR', priceFormatter: (p) => fmtPrice(p) }
  });
  CH.candle = CH.chart.addCandlestickSeries({
    upColor: '#c84a31', downColor: '#1261c4', borderUpColor: '#c84a31', borderDownColor: '#1261c4', wickUpColor: '#c84a31', wickDownColor: '#1261c4',
    priceFormat: { type: 'custom', formatter: (p) => fmtPrice(p), minMove: 0.00000001 }
  });
  CH.candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
  CH.vol = CH.chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  CH.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  CH.mas = MA_DEF.map(([, c]) => CH.chart.addLineSeries({ color: c, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }));
  $('#maLegend').innerHTML = MA_DEF.map(([n, c]) => `<span style="color:${c}">MA${n}</span>`).join('');
  CH.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 5 && Date.now() >= CH.ignoreOlderUntil) loadOlder(); });

  $$('#chartTools button[data-unit]').forEach((b) => {
    b.classList.toggle('on', b.dataset.unit === CH.unit);
    b.addEventListener('click', () => {
      CH.unit = b.dataset.unit;
      localStorage.setItem('mu-unit', CH.unit);
      $$('#chartTools button[data-unit]').forEach((x) => x.classList.toggle('on', x === b));
      loadChart();
    });
  });
  $('#toggleMarks').addEventListener('click', (e) => { CH.marks = !CH.marks; e.target.classList.toggle('on', CH.marks); drawMarks(); });
}

async function loadChart() {
  const code = S.market, unit = CH.unit, id = ++CH.reqId;
  $('#chartLoading').classList.add('on');
  try {
    const rows = await api(`/api/candles?market=${code}&unit=${unit}&count=200`);
    if (id !== CH.reqId) return;
    CH.data = rows; CH.market = code; CH.noMore = rows.length < 200; CH.posSig = '';
    drawAll(true);
  } catch (e) {
    if (id === CH.reqId) toast(`차트 불러오기 실패: ${e.message}`, 'err');
  } finally {
    if (id === CH.reqId) $('#chartLoading').classList.remove('on');
  }
}

async function loadOlder() {
  if (CH.loadingOlder || CH.noMore || !CH.data.length) return;
  CH.loadingOlder = true;
  const id = CH.reqId;
  try {
    const to = new Date(CH.data[0].t).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rows = await api(`/api/candles?market=${S.market}&unit=${CH.unit}&count=200&to=${encodeURIComponent(to)}`);
    if (id !== CH.reqId) return;
    const older = rows.filter((r) => r.t < CH.data[0].t);
    if (!older.length) { CH.noMore = true; return; }
    const range = CH.chart.timeScale().getVisibleLogicalRange();
    CH.data = [...older, ...CH.data];
    drawAll(false);
    if (range) CH.chart.timeScale().setVisibleLogicalRange({ from: range.from + older.length, to: range.to + older.length });
  } catch { /* ignore */ } finally { CH.loadingOlder = false; }
}

function maSeries(d, n) {
  const out = [];
  let s = 0;
  for (let i = 0; i < d.length; i++) {
    s += d[i].c;
    if (i >= n) s -= d[i - n].c;
    if (i >= n - 1) out.push({ time: tsec(d[i].t), value: s / n });
  }
  return out;
}

function drawAll(fit) {
  const d = CH.data;
  CH.candle.setData(d.map((c) => ({ time: tsec(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
  CH.vol.setData(d.map((c) => ({ time: tsec(c.t), value: c.v, color: volColor(c) })));
  MA_DEF.forEach(([n], i) => CH.mas[i].setData(maSeries(d, n)));
  drawMarks();
  drawPriceLines(true);
  if (fit) {
    // A chart can keep an obsolete logical range while its container was resized/reordered.
    // Reset first, then show the latest 110 candles so the plot never starts as blank space.
    CH.ignoreOlderUntil = Date.now() + 1000;
    requestAnimationFrame(() => {
      if (!d.length) return;
      CH.chart.timeScale().fitContent();
      CH.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, d.length - 110), to: d.length + 6 });
    });
  }
}

function onChartTrades(list) {
  if (!CH.data.length || CH.market !== S.market) return;
  const u = CH.unit, ms = unitMs(u);
  let touched = false;
  for (const tr of list) {
    const last = CH.data[CH.data.length - 1];
    let bucket;
    if (u === 'M') { const d = new Date(tr.t); bucket = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
    else if (u === 'W') bucket = last.t + Math.floor((tr.t - last.t) / ms) * ms;
    else bucket = Math.floor(tr.t / ms) * ms;
    if (bucket < last.t) continue;
    if (bucket === last.t) { if (tr.p > last.h) last.h = tr.p; if (tr.p < last.l) last.l = tr.p; last.c = tr.p; last.v += tr.v; }
    else CH.data.push({ t: bucket, o: tr.p, h: tr.p, l: tr.p, c: tr.p, v: tr.v });
    touched = true;
  }
  if (!touched) return;
  const d = CH.data, c = d[d.length - 1];
  CH.candle.update({ time: tsec(c.t), open: c.o, high: c.h, low: c.l, close: c.c });
  CH.vol.update({ time: tsec(c.t), value: c.v, color: volColor(c) });
  MA_DEF.forEach(([n], i) => {
    if (d.length < n) return;
    let s = 0;
    for (let k = d.length - n; k < d.length; k++) s += d[k].c;
    CH.mas[i].update({ time: tsec(c.t), value: s / n });
  });
}

function drawMarks() {
  if (!CH.candle) return;
  if (!CH.marks || !CH.data.length) { CH.candle.setMarkers([]); return; }
  const times = CH.data.map((c) => c.t);
  const list = S.trades.filter((t) => t.market === S.market && t.t >= times[0]);
  const mk = list.map((t) => {
    let lo = 0, hi = times.length - 1, idx = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t.t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    const buy = t.side === 'buy';
    return { time: tsec(times[idx]), position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#c84a31' : '#1261c4', shape: buy ? 'arrowUp' : 'arrowDown', text: buy ? '매수' : `매도 ${fmtPct(t.pnlPct, 2)}` };
  });
  mk.sort((a, b) => a.time - b.time);
  CH.candle.setMarkers(mk.slice(-300));
}

function drawPriceLines(force = false) {
  if (!CH.candle) return;
  const p = posOf(S.market);
  const sig = p ? `${S.market}|${p.avgPrice}` : '';
  if (!force && sig === CH.posSig) return;
  CH.posSig = sig;
  CH.lines.forEach((l) => CH.candle.removePriceLine(l));
  CH.lines = [];
  if (!p) return;
  CH.lines.push(CH.candle.createPriceLine({ price: p.avgPrice, color: '#222', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '평균매수가' }));
}

// =====================================================================================
// Order book (Binance layout: asks + info box on top, trade tape + bids below)
// =====================================================================================
const OB = { asks: [], bids: [], info: null, tape: null, centered: false, tapeRows: [] };

function initOrderbook() {
  const asks = $('#obAsks'), bids = $('#obBids');
  for (let i = 0; i < 15; i++) {
    const size = h('div', { class: 'ob-cell ob-ask ob-size' }, h('i', { class: 'bar' }), h('span', {}, ''));
    const price = h('div', { class: 'ob-cell ob-ask ob-price' }, h('span', {}, ''), h('small', {}, ''));
    asks.append(size, price);
    if (i === 0) { OB.info = h('div', { class: 'ob-side ob-info' }); asks.append(OB.info); }
    OB.asks.push({ size, price });
  }
  for (let i = 0; i < 15; i++) {
    if (i === 0) { OB.tape = h('div', { class: 'ob-side ob-trades' }); bids.append(OB.tape); }
    const price = h('div', { class: 'ob-cell ob-bid ob-price' }, h('span', {}, ''), h('small', {}, ''));
    const size = h('div', { class: 'ob-cell ob-bid ob-size' }, h('i', { class: 'bar' }), h('span', {}, ''));
    bids.append(price, size);
    OB.bids.push({ price, size });
  }
  OB.tape.innerHTML = '<div class="strength"><span>체결강도</span><span id="obStrength">-</span></div><div class="th"><span>체결가</span><span>체결량</span></div><div class="list" id="obTape"></div>';
}

function renderOrderbook() {
  const ob = S.ob;
  const t = S.viewTicker || S.tickers.get(S.market);
  const pcp = t?.pcp;
  const units = ob?.units || [];
  let max = 0;
  for (const u of units) max = Math.max(max, u.as, u.bs);
  const cur = t?.tp;
  const paint = (cells, price, size, isAsk) => {
    const [pSpan, pSmall] = cells.price.children;
    const [bar, sSpan] = cells.size.children;
    if (price == null) { pSpan.textContent = ''; pSmall.textContent = ''; sSpan.textContent = ''; bar.style.width = '0'; cells.price.classList.remove('cur'); return; }
    const cls = pcp ? upDown(price - pcp) : 'even';
    pSpan.textContent = fmtPrice(price);
    pSpan.className = cls;
    pSmall.textContent = pcp ? fmtPct((price / pcp - 1) * 100) : '';
    pSmall.className = cls;
    sSpan.textContent = fmtQty(size);
    bar.style.width = `${max ? clamp((size / max) * 100, 0, 100) : 0}%`;
    cells.price.classList.toggle('cur', price === cur);
  };
  for (let i = 0; i < 15; i++) {
    const a = units[14 - i];
    paint(OB.asks[i], a?.ap, a?.as, true);
    const b = units[i];
    paint(OB.bids[i], b?.bp, b?.bs, false);
  }
  $('#obTas').textContent = ob ? fmtQty(ob.tas) : '-';
  $('#obTbs').textContent = ob ? fmtQty(ob.tbs) : '-';
  if (units.length && !OB.centered) {
    OB.centered = true;
    const wrap = $('#obWrap');
    requestAnimationFrame(() => { wrap.scrollTop = $('#obAsks').offsetHeight - wrap.clientHeight / 2; });
  }
}

function renderObInfo() {
  const t = S.viewTicker || S.tickers.get(S.market);
  if (!t || t.hp == null) { OB.info.innerHTML = ''; return; }
  const s = sym(S.market);
  const pc = (v) => (t.pcp ? fmtPct((v / t.pcp - 1) * 100) : '');
  OB.info.innerHTML = `
    <dl><dt>거래량</dt><dd>${(t.atv24h ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 })} ${s}</dd></dl>
    <dl><dt>거래대금</dt><dd>${fmtMillion(t.atp24h)} 백만원<i>(최근24시간)</i></dd></dl>
    <dl><dt>52주 최고</dt><dd class="up">${fmtPrice(t.h52)}<i>(${esc(t.h52d || '-')})</i></dd></dl>
    <dl><dt>52주 최저</dt><dd class="down">${fmtPrice(t.l52)}<i>(${esc(t.l52d || '-')})</i></dd></dl>
    <hr>
    <dl><dt>전일종가</dt><dd>${fmtPrice(t.pcp)}</dd></dl>
    <dl><dt>당일고가</dt><dd class="up">${fmtPrice(t.hp)}<i>${pc(t.hp)}</i></dd></dl>
    <dl><dt>당일저가</dt><dd class="down">${fmtPrice(t.lp)}<i>${pc(t.lp)}</i></dd></dl>`;
  const st = $('#obStrength');
  if (st) {
    const v = t.aav > 0 ? (t.abv / t.aav) * 100 : null;
    st.textContent = v == null ? '-' : `${v.toFixed(2)}%`;
    st.className = v == null ? '' : v >= 100 ? 'up' : 'down';
  }
}

// =====================================================================================
// Trade tape + bottom "체결" table
// =====================================================================================
const TP = { list: [] };

async function loadTicks() {
  const code = S.market;
  TP.list = [];
  renderTape();
  try {
    const rows = await api(`/api/ticks?market=${code}`);
    if (code !== S.market) return;
    TP.list = rows.sort((a, b) => b.t - a.t).slice(0, 60);
    renderTape();
  } catch { /* stream fills it */ }
}

function onTrades(list) {
  for (const tr of list) TP.list.unshift(tr);
  if (TP.list.length > 60) TP.list.length = 60;
  renderTape();
}

function renderTape() {
  const t = S.viewTicker || S.tickers.get(S.market);
  const pcp = t?.pcp;
  const s = sym(S.market);
  const tape = $('#obTape');
  if (tape) {
    tape.innerHTML = TP.list.slice(0, 16).map((x) => `<div class="tr"><span class="${pcp ? upDown(x.p - pcp) : ''}">${fmtPrice(x.p)}</span><span class="${x.bid ? 'up' : 'down'}">${fmtQty(x.v)}</span></div>`).join('');
  }
  if (!$('#btab-trades').classList.contains('on')) return;
  $('#tradesTable').innerHTML = `<thead><tr><th>체결시간</th><th>체결가격(KRW)</th><th>체결량(${s})</th><th>체결금액(KRW)</th></tr></thead><tbody>${
    TP.list.slice(0, 50).map((x) => `<tr><td>${fmtTime(x.t)}</td><td class="${pcp ? upDown(x.p - pcp) : ''}">${fmtPrice(x.p)}</td><td class="${x.bid ? 'up' : 'down'}">${fmtQty(x.v)}</td><td>${fmtInt(x.p * x.v)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">체결 내역을 불러오는 중…</td></tr>'
  }</tbody>`;
}

async function loadDays() {
  const code = S.market;
  $('#daysTable').innerHTML = '<tbody><tr><td class="empty">불러오는 중…</td></tr></tbody>';
  try {
    const rows = await api(`/api/days?market=${code}`);
    if (code !== S.market) return;
    const out = [];
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i], prev = rows[i - 1];
      const diff = r.c - prev.c;
      const d = new Date(r.t);
      out.push(`<tr><td>${d.getUTCMonth() + 1}.${String(d.getUTCDate()).padStart(2, '0')}</td><td class="${upDown(diff)}">${fmtPrice(r.c)}</td><td class="${upDown(diff)}">${fmtSigned(diff)}</td><td class="${upDown(diff)}">${fmtPct((diff / prev.c) * 100)}</td><td>${fmtInt(r.v)}</td><td>${fmtMillion(r.q)}백만</td></tr>`);
    }
    $('#daysTable').innerHTML = `<thead><tr><th>일자</th><th>종가(KRW)</th><th>전일대비</th><th>등락률</th><th>거래량(${sym(code)})</th><th>거래대금</th></tr></thead><tbody>${out.join('')}</tbody>`;
  } catch (e) {
    $('#daysTable').innerHTML = `<tbody><tr><td class="empty">불러오기 실패: ${esc(e.message)}</td></tr></tbody>`;
  }
}

export function decisionPill(d) {
  if (!d.ok) return '<span class="pill err">오류</span>';
  if (d.executed) return d.kind === 'entry' ? '<span class="pill buy">매수 체결</span>' : '<span class="pill sell">매도 체결</span>';
  return d.kind === 'entry' ? '<span class="pill skip">관망</span>' : '<span class="pill skip">보유 유지</span>';
}

function renderCoinJev() {
  if (!$('#btab-jev').classList.contains('on')) return;
  const list = S.decisions.filter((d) => d.market === S.market).slice(-80).reverse();
  $('#coinJevTable').innerHTML = `<thead><tr><th>시간</th><th>유형</th><th>신호</th><th>확률</th><th>가짜 급등</th><th>응답</th><th>결과</th><th style="text-align:left">사유</th></tr></thead><tbody>${
    list.map((d) => `<tr><td>${fmtTime(d.t)}</td><td>${d.kind === 'entry' ? '진입' : '청산'}</td><td>${esc((d.trigger || []).join(', '))}</td><td>${d.p != null ? `${(d.p * 100).toFixed(0)}%` : '-'}</td><td>${d.fake != null ? `${(d.fake * 100).toFixed(0)}%` : '-'}</td><td>${d.latencyMs}ms</td><td>${decisionPill(d)}</td><td style="text-align:left;white-space:normal">${esc(d.reason || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">이 코인의 Jev 판단 기록이 아직 없습니다</td></tr>'
  }</tbody>`;
}

function initBottomTabs() {
  $$('#btabs a').forEach((a) => a.addEventListener('click', () => {
    $$('#btabs a').forEach((x) => x.classList.toggle('on', x === a));
    $$('.btab').forEach((x) => x.classList.toggle('on', x.id === `btab-${a.dataset.btab}`));
    if (a.dataset.btab === 'days') loadDays();
    if (a.dataset.btab === 'trades') renderTape();
    if (a.dataset.btab === 'jev') renderCoinJev();
  }));
}

// =====================================================================================
// Order panel: 매수 / 매도 / 자동매매 / 거래내역
// =====================================================================================
function selectOtab(name) {
  $$('.order-tabs a').forEach((x) => x.classList.toggle('on', x.dataset.otab === name));
  $$('.otab').forEach((x) => x.classList.toggle('on', x.id === `otab-${name}`));
  renderOrderPanel();
}

function parseNum(s) { return Number(String(s).replace(/[^\d.]/g, '')) || 0; }
const ORDER_TYPE = { buy: 'market', sell: 'market' };

function bestOrderPrice(side) {
  const unit = S.ob?.units?.[0];
  const quote = side === 'buy' ? unit?.ap : unit?.bp;
  return quote ?? S.viewTicker?.tp ?? S.tickers.get(S.market)?.tp ?? null;
}

function orderTypeLabel(side, type) {
  if (type === 'market') return `현재 ${side === 'buy' ? '매수' : '매도'} 예상가`;
  return type === 'limit' ? '지정 가격' : '예약 발동가';
}

function renderOrderQuote(side) {
  const type = ORDER_TYPE[side];
  const price = bestOrderPrice(side);
  const input = $(`#${side}Price`);
  const label = $(`#${side}PriceLabel`);
  const guide = $(`#${side}PriceGuide`);
  if (!input || !label || !guide) return;
  const market = type === 'market';
  label.textContent = orderTypeLabel(side, type);
  input.readOnly = market;
  if (market || !parseNum(input.value)) input.value = price == null ? '' : fmtPrice(price);
  input.placeholder = price == null ? '호가 수신 대기' : fmtPrice(price);
  $$(`.seg[data-order-side="${side}"] [data-order-type]`).forEach((button) => button.classList.toggle('on', button.dataset.orderType === type));
  if (market) {
    guide.textContent = price == null ? '실시간 호가를 기다리는 중입니다' : `${side === 'buy' ? '최우선 매도' : '최우선 매수'} 호가 · 체결량에 따라 실제 평균 체결가는 달라질 수 있습니다`;
  } else if (type === 'limit') {
    guide.textContent = '입력한 지정 가격 표시 · 현재 버전은 시장가 체결만 지원하며 이 가격으로 자동 체결하지 않습니다';
  } else {
    guide.textContent = '입력한 예약 발동가 표시 · 현재 버전은 예약 주문을 저장하거나 자동 체결하지 않습니다';
  }
}

function setOrderType(side, type) {
  ORDER_TYPE[side] = type;
  renderOrderPanel();
}

function initOrderPanel() {
  $$('.order-tabs a').forEach((a) => a.addEventListener('click', () => selectOtab(a.dataset.otab)));
  $('#ctabJev').addEventListener('click', () => { selectOtab('auto'); $('.order-box').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $$('[data-order-side] [data-order-type]').forEach((button) => button.addEventListener('click', () => setOrderType(button.closest('[data-order-side]').dataset.orderSide, button.dataset.orderType)));
  $('#buyPrice').addEventListener('input', (e) => { if (!e.target.readOnly) e.target.value = parseNum(e.target.value) ? fmtPrice(parseNum(e.target.value)) : ''; });
  $('#sellPrice').addEventListener('input', (e) => { if (!e.target.readOnly) e.target.value = parseNum(e.target.value) ? fmtPrice(parseNum(e.target.value)) : ''; });
  $('#buyKrw').addEventListener('input', (e) => { const v = parseNum(e.target.value); e.target.value = v ? Math.floor(v).toLocaleString('ko-KR') : ''; });
  $$('.pcts[data-for="buy"] button').forEach((b) => b.addEventListener('click', () => {
    const avail = S.config?.mode === 'live' ? S.liveAccount?.krw || 0 : S.summary?.krw || 0;
    const fee = (S.config?.paper?.feePct || 0.05) / 100;
    const p = Number(b.dataset.p);
    const v = Math.floor(p >= 1 ? avail : (avail * p) / (1 + fee));
    $('#buyKrw').value = v.toLocaleString('ko-KR');
  }));
  $$('.pcts[data-for="sell"] button').forEach((b) => b.addEventListener('click', () => { $('#sellRatio').value = b.dataset.p; renderOrderPanel(); }));
  $('#sellRatio').addEventListener('input', () => renderOrderPanel());
  $('#buyBtn').addEventListener('click', async () => {
    if (ORDER_TYPE.buy !== 'market') return toast(`${ORDER_TYPE.buy === 'limit' ? '지정가' : '예약가'}는 현재 가격 확인·입력만 지원합니다 · 시장가 자동 체결로 바뀌지 않습니다`, 'err');
    const krw = parseNum($('#buyKrw').value);
    if (krw < 5000) return toast('최소 주문금액은 5,000원입니다', 'err');
    if (S.config?.mode === 'live' && !confirm(`${nameOf(S.market)}을(를) Binance 시장가로 ${fmtInt(krw)}원 실전 매수합니다.\n주문 접수 후 취소가 어렵습니다. 계속할까요?`)) return;
    try {
      const r = await api('/api/order', { market: S.market, side: 'buy', krw });
      $('#buyKrw').value = '';
      if (r.live) { toast('Binance 실전 매수 주문을 접수했습니다'); await refreshLiveAccount(true); }
    } catch (e) { orderNotice('cancel', { market: S.market, message: e.message }); }
  });
  $('#sellBtn').addEventListener('click', async () => {
    if (ORDER_TYPE.sell !== 'market') return toast(`${ORDER_TYPE.sell === 'limit' ? '지정가' : '예약가'}는 현재 가격 확인·입력만 지원합니다 · 시장가 자동 체결로 바뀌지 않습니다`, 'err');
    const ratio = clamp(parseNum($('#sellRatio').value), 0, 100) / 100;
    if (!ratio) return toast('매도 비율을 입력하세요', 'err');
    if (S.config?.mode === 'live' && !confirm(`${nameOf(S.market)} 보유 가능 수량의 ${(ratio * 100).toFixed(0)}%를 Binance 시장가로 실전 매도합니다.\n주문 접수 후 취소가 어렵습니다. 계속할까요?`)) return;
    try {
      const r = await api('/api/order', { market: S.market, side: 'sell', ratio });
      if (r.live) { toast('Binance 실전 매도 주문을 접수했습니다'); await refreshLiveAccount(true); }
    } catch (e) { orderNotice('cancel', { market: S.market, message: e.message }); }
  });

  // auto tab uses delegation because it re-renders every second
  $('#otab-auto').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'watch') {
      const on = !isPinned(S.market);
      try { S.config = await api('/api/watch', { market: S.market, on }); toast(on ? `${nameOf(S.market)} 고정 감시 시작 · 자동 선별과 상관없이 항상 감시` : `${nameOf(S.market)} 고정 해제${rankOf(S.market) ? ' · 자동 TOP에 있는 동안은 계속 감시' : ''}`); renderOrderPanel(); refreshTags(); renderHeader(); }
      catch (err) { toast(err.message, 'err'); }
    } else if (act === 'sellnow') {
      if (S.config?.mode === 'live' && !confirm(`${nameOf(S.market)} 전량을 Binance 시장가로 실전 매도합니다.\n주문 접수 후 취소가 어렵습니다. 계속할까요?`)) return;
      try {
        const r = await api('/api/order', { market: S.market, side: 'sell', ratio: 1 });
        if (r.live) { toast('Binance 실전 전량 매도 주문을 접수했습니다'); await refreshLiveAccount(true); }
      } catch (err) { orderNotice('cancel', { market: S.market, message: err.message }); }
    } else if (act === 'goto-settings') location.hash = '#/settings';
  });
}

function meter(label, v, disp, th, max, opts = {}) {
  const w = v == null ? 0 : clamp((v / max) * 100, 0, 100);
  const hot = opts.hot ?? (th != null && v != null && v >= th);
  const cold = opts.cold ?? false;
  const thPos = th != null ? clamp((th / max) * 100, 0, 100) : null;
  return `<div class="meter"><span>${label}</span><div class="mb"><div class="fill ${hot ? 'hot' : cold ? 'cold' : ''}" style="width:${w}%"></div>${thPos != null ? `<i class="th" style="left:${thPos}%"></i>` : ''}</div><span class="mv ${hot ? 'up' : cold ? 'down' : ''}">${disp}</span></div>`;
}

function entryCheck(key, ok, label, actual, threshold, note = '') {
  return `<div class="entry-check ${ok ? 'pass' : 'wait'}" data-ck="${esc(key)}"><i>${ok ? '통과' : '대기'}</i><div><b>${label}</b>${note ? `<small>${esc(note)}</small>` : ''}</div><span><em>현재 ${actual}</em><strong>기준 ${threshold}</strong></span></div>`;
}

function entryDiagnostics(code, w, c, watched, pos) {
  const r = c.ribbon, row = rankRow(code), sum = S.summary || {};
  const usingJev = sum.effectiveDecisionMode === 'jev';
  const rule = c.rule || {};
  const judgeName = usingJev ? 'Jev 매수 판단' : '규칙 매수';
  const orderKrw = c.trade.orderMode === 'percent'
    ? Math.floor(Number(sum.krw || 0) * Number(c.trade.orderPct || 0) / 100)
    : Number(c.trade.orderKrw || 0);
  const orderRule = c.trade.orderMode === 'percent'
    ? `가용 원화 ${c.trade.orderPct}% (${fmtInt(orderKrw)}원)`
    : `${fmtInt(orderKrw)}원 이상`;
  const pct = (v, d = 0) => v == null ? '-' : `${(v * 100).toFixed(d)}%`;
  const num = (v, d = 2) => v == null ? '-' : Number(v).toFixed(d);
  const checks = [];
  checks.push(['watch', !!watched, '자동 감시 목록 편입', watched ? (row ? `자동 순위 ${row.rank}위` : '고정 감시') : '자동 목록 밖', '자동 TOP 또는 고정', watched ? '' : '순위가 올라오거나 고정 감시를 켜야 합니다']);
  checks.push(['run', !!c.autoTrading, '자동매매 운전', c.autoTrading ? '켜짐' : '꺼짐', '켜짐', c.autoTrading ? '' : '설정에서 자동매매를 켜야 신규 진입합니다']);
  checks.push(['pos', !pos, '동일 코인 보유', pos ? '이미 보유 중' : '미보유', '미보유', pos ? `보유 중에는 중복 매수하지 않고 ${usingJev ? 'Jev 청산 판단' : '규칙 청산'}만 합니다` : '']);
  checks.push(['slots', (sum.positions?.length || 0) < c.trade.maxPositions, '동시 보유 한도', `${sum.positions?.length || 0}개`, `${c.trade.maxPositions}개 미만`, (sum.positions?.length || 0) >= c.trade.maxPositions ? `기존 보유분을 ${usingJev ? 'Jev가 매도' : '규칙 매도'}하면 다시 진입을 검토합니다` : '']);
  checks.push(['krw', orderKrw >= 5000 && Number(sum.krw || 0) >= orderKrw, '주문가능 원화', `${fmtInt(sum.krw || 0)}원`, orderRule, orderKrw < 5000 ? '계산된 주문금액이 Binance 최소 주문 5,000원보다 작습니다' : '']);
  checks.push(['strat', !!r.enabled, 'EMA30 상승 전략', r.enabled ? '켜짐' : '꺼짐', '켜짐', r.enabled ? '' : '전략을 끄면 신규 진입만 멈춥니다']);
  checks.push(['warm', !!w?.warm, '데이터 준비', w?.warm ? `${Math.floor(w.rtSec || 0)}초 수집` : `${Math.floor(w?.rtSec || 0)}초 수집`, '60초 이상', '1분 가격 흐름과 사고파는 가격이 충분히 쌓일 때까지 기다립니다']);
  checks.push(['fresh', !!w && !w.stale, '체결 데이터 최신성', w?.stale ? '2분 이상 체결 없음' : '실시간 수신 중', '2분 이내 체결']);
  checks.push(['gap', !(w?.callWaitSec > 0), '같은 신호 다시 확인', w?.callWaitSec > 0 ? `${w.callWaitSec.toFixed(1)}초 대기` : '즉시 가능', `${c.signal.callGapSec}초 + 1분당 1회`]);
  checks.push(['ob_ready', w?.tickPct != null && w?.spreadPct != null, '사고파는 가격 수신', w?.tickPct != null && w?.spreadPct != null ? '수신됨' : '대기', '매수·매도 가격 필요']);
  checks.push(['tick', w?.tickPct != null && w.tickPct <= c.signal.maxTickPct, '가격 한 칸의 손해', w?.tickPct == null ? '-' : fmtPct(w.tickPct, 3), `≤ ${c.signal.maxTickPct}%`]);
  checks.push(['spread', w?.spreadPct != null && w.spreadPct <= c.signal.maxSpreadPct, '사자마자 생기는 가격 차이', w?.spreadPct == null ? '-' : fmtPct(w.spreadPct, 3), `≤ ${c.signal.maxSpreadPct}%`, '기준보다 크면 사자마자 불리해서 매수하지 않습니다']);
  const emaReady = [w?.ema30, w?.ema60, w?.ema100, w?.ema200].every(Number.isFinite);
  checks.push(['ema4', emaReady, '4개 기준선 계산', emaReady ? `${fmtPrice(w.ema30)} / ${fmtPrice(w.ema60)} / ${fmtPrice(w.ema100)} / ${fmtPrice(w.ema200)}` : '데이터 대기', 'EMA30·EMA60·EMA100·EMA200 필요']);
  checks.push(['bear_block', !r.blockBearRibbon || !w?.ribbonBear, '큰 하락 흐름 차단', w?.ribbonBear ? '4개 선이 모두 하락 순서' : '큰 하락 흐름 아님', r.blockBearRibbon ? '하락 흐름 아님' : '사용 안 함']);
  checks.push(['bull_align', !r.requireFullBullAlignment || !!w?.ribbonBull, '상승 흐름 정렬', w?.ribbonBull ? '강한 상승 정렬' : w?.ema30 > w?.ema60 ? '초기 상승' : '상승 정렬 아님', r.requireFullBullAlignment ? '강한 상승 정렬' : 'EMA30이 EMA60 위']);
  checks.push(['squeeze', (w?.ribbonWidthPct ?? 0) > r.minRibbonWidthPct, '상승 줄 간격', `${num(w?.ribbonWidthPct, 3)}%`, `> ${r.minRibbonWidthPct}%`, '선들이 너무 붙어 있으면 방향이 없다고 보고 사지 않습니다']);
  checks.push(['slope', (w?.ema30SlopePct ?? -Infinity) >= r.minEma30SlopePct, 'EMA30 최근 방향', `${num(w?.ema30SlopePct, 3)}%`, `≥ ${r.minEma30SlopePct}%`]);
  checks.push(['body', !!w?.candleBull && (w?.candleBodyPct ?? 0) >= r.minCandleBodyPct, '지금 오르는 힘', `${w?.candleBull ? '상승' : '하락'} · ${num(w?.candleBodyPct, 3)}%`, `상승 · ≥ ${r.minCandleBodyPct}%`]);
  const breakout = !!w?.ema30Breakout && (w?.ema30DistancePct ?? -Infinity) >= r.minBreakoutPct;
  const touch = (w?.ema30LowDistances || []).slice(-r.pullbackLookbackBars).some((d) => Math.abs(d) <= r.maxPullbackDistancePct);
  const reclaim = !breakout && touch && !!w?.candleBull && (w?.ema30DistancePct ?? -Infinity) >= 0 && (w?.ema30DistancePct ?? Infinity) <= r.maxPullbackDistancePct;
  const aboveRun = !breakout && !reclaim && !!w?.candleBull && (w?.ema30DistancePct ?? -Infinity) >= 0 && (w?.ema30DistancePct ?? Infinity) <= r.maxPullbackDistancePct * 2;
  const structure = !usingJev && r.entryStructure === 'free' ? 'relaxed' : (r.entryStructure || 'relaxed');
  const setupOk = structure === 'free' || breakout || reclaim || (structure === 'relaxed' && aboveRun);
  const actual = structure === 'free' ? 'Jev 전권 판단' : breakout ? '상향 돌파' : reclaim ? '눌림목 재지지' : aboveRun ? 'EMA30 지지 상승' : `대기 · EMA30 ${num(w?.ema30DistancePct, 3)}%`;
  const standard = structure === 'free' ? '리본 정렬·양봉 통과' : structure === 'relaxed' ? `돌파·재지지 또는 EMA30 위 ${r.maxPullbackDistancePct * 2}% 내 상승` : `돌파 ≥ ${r.minBreakoutPct}% 또는 ${r.pullbackLookbackBars}봉 내 재지지`;
  const note = structure === 'free' ? 'EMA30 구조와 무관하게 다른 EMA 조건 통과 후 Jev에게 매수를 묻습니다' : structure === 'relaxed' ? `EMA30를 지지하며 상승 중인 1분봉도 ${judgeName} 대상으로 포함합니다${!usingJev && r.entryStructure === 'free' ? ' · 순수 규칙형이라 자유 설정은 완화 조건으로 적용' : ''}` : `돌파 또는 눌림목 재지지 구조가 생긴 1분봉에서만 ${judgeName}를 실행합니다`;
  checks.push(['setup', setupOk, 'EMA30 진입 구조', actual, standard, note]);
  if (!usingJev) {
    checks.push(['rule_rank', !!row && row.rank <= rule.maxEntryRank, '자동 순위', row ? `${row.rank}위` : '순위 밖', `상위 ${rule.maxEntryRank}위`]);
    checks.push(['rule_rise', w?.ret30 != null && w.ret30 >= rule.minRet30Pct, '최근 30초 가격 상승 초입', w?.ret30 == null ? '-' : fmtPct(w.ret30, 3), `≥ ${rule.minRet30Pct}%`]);
    checks.push(['rule_buy', w?.buyRatio30 != null && w.buyRatio30 >= rule.minBuyRatio30, '최근 30초 매수 힘', w?.buyRatio30 == null ? '-' : pct(w.buyRatio30), `≥ ${Math.round(rule.minBuyRatio30 * 100)}%`]);
    checks.push(['rule_book', w?.imb15 != null && w.imb15 >= rule.minImbalance15, '호가창 매수 우세', w?.imb15 == null ? '-' : pct(w.imb15), `≥ ${Math.round(rule.minImbalance15 * 100)}%`]);
    checks.push(['rule_volume', w?.volSpike != null && w.volSpike >= rule.minVolSpike, '최근 10초 거래 활발함', w?.volSpike == null ? '-' : `${w.volSpike.toFixed(1)}배`, `직전 ${w?.volBaselineSec || 290}초의 10초 환산 평균 × ${rule.minVolSpike}`, '최근 10초 거래금액을 직전 흐름의 10초 환산 평균과 비교합니다']);
  }
  const pending = checks.filter(([, ok]) => !ok);
  return {
    checks,
    mode: usingJev ? 'jev' : 'rule',
    summary: pending.length ? `${pending.length}개 조건 대기 · 조건이 맞는 1분봉에서 ${judgeName}` : `모든 사전 조건 통과 · ${judgeName} 대기/진행`,
    html: `<div class="entry-diagnosis" id="entryDiagWrap"><div class="entry-d-head"><div><b>지금 매수 가능한지 확인</b><span id="entryDiagSummary">${pending.length ? `${pending.length}개 조건 대기 · 조건이 맞는 1분봉에서 ${judgeName}` : `모든 사전 조건 통과 · ${judgeName} 대기/진행`}</span></div><small>${usingJev ? 'Jev 보조형' : '순수 규칙형 · Jev API 0회'}</small></div><div class="entry-checks" id="entryChecksList">${checks.map(([k, ok, label, actual, threshold, note]) => entryCheck(k, ok, label, actual, threshold, note)).join('')}</div></div>`
  };
}

let lastUserTouchTime = 0;
function noteUserTouch() { lastUserTouchTime = Date.now(); }

function patchDiagnosticsInPlace(listEl, summaryEl, diag) {
  if (summaryEl && summaryEl.textContent !== diag.summary) summaryEl.textContent = diag.summary;
  for (const [k, ok, label, actual, threshold, note] of diag.checks) {
    let row = listEl.querySelector(`[data-ck="${k}"]`);
    if (!row) continue;
    const wantClass = `entry-check ${ok ? 'pass' : 'wait'}`;
    if (row.className !== wantClass) row.className = wantClass;
    const icon = row.querySelector('i');
    if (icon && icon.textContent !== (ok ? '통과' : '대기')) icon.textContent = ok ? '통과' : '대기';
    const em = row.querySelector('em');
    const nextActual = `현재 ${actual}`;
    if (em && em.textContent !== nextActual) em.textContent = nextActual;
    const strong = row.querySelector('strong');
    const nextTh = `기준 ${threshold}`;
    if (strong && strong.textContent !== nextTh) strong.textContent = nextTh;
  }
}

function renderAutoTab() {
  const box = $('#otab-auto');
  if (!box.classList.contains('on') || !S.config) return;
  const code = S.market;
  const c = S.config;
  const usingJev = S.summary?.effectiveDecisionMode === 'jev';
  const decisionName = usingJev ? 'Jev 판단' : '규칙 판단';
  const s = c.signal;
  const r = c.ribbon;
  const w = watchOf(code);
  const watched = isWatched(code);
  const pinned = isPinned(code);
  const rank = rankOf(code);
  const pos = posOf(code);
  const via = rank ? `<b style="color:var(--navy)">자동 TOP ${rank}위</b>${pinned ? ' · 고정' : ''} · ` : pinned ? '<b>고정 감시</b> · ' : '';
  let status;
  if (!watched && !pos) status = S.screener?.enabled ? '지금은 자동 TOP 밖 · 스위치를 켜면 항상 감시(고정)' : '꺼짐 · 켜면 이 코인을 실시간 감시합니다';
  else if (!c.autoTrading && !pos) status = '자동매매 정지 · 신규 진입 없음';
  else if (w?.judging) status = '<b class="up">Jev 판단 중…</b>';
  else if (pos) status = `<b class="up">보유 중</b> · ${fmtDur(pos.heldSec)} · 청산 감시`;
  else if (!w?.warm) status = '데이터 수집 중 · 약 1분 후 감시 시작';
  else if (w.blocked) status = `<b style="color:var(--warn)">진입 제한</b> · ${w.blocked === 'spread' ? '매수·매도 호가 차이가 벌어짐' : '호가 간격이 커서 초단타에 불리'}`;
  else status = '감시 중 · EMA30 돌파·재지지 신호 대기';
  if (watched || pos) status = via + status;

  let meters = '';
  if (w && (watched || pos)) {
    meters = `<div class="meters">
      ${meter('상승 줄 간격', w.ribbonWidthPct, w.ribbonWidthPct != null ? `${w.ribbonWidthPct.toFixed(3)}%` : '-', r.minRibbonWidthPct, Math.max(r.minRibbonWidthPct * 3, 0.3), { cold: (w.ribbonWidthPct ?? 0) <= r.minRibbonWidthPct })}
      ${meter('EMA30 최근 방향', w.ema30SlopePct, w.ema30SlopePct != null ? fmtPct(w.ema30SlopePct, 3) : '-', r.minEma30SlopePct, Math.max(r.minEma30SlopePct * 3, 0.1), { cold: (w.ema30SlopePct ?? 0) < r.minEma30SlopePct })}
      ${meter('현재가와 EMA30', w.ema30DistancePct, w.ema30DistancePct != null ? fmtPct(w.ema30DistancePct, 3) : '-', r.minBreakoutPct, Math.max(r.maxPullbackDistancePct * 2, 0.3), { cold: (w.ema30DistancePct ?? 0) < 0 })}
      ${meter('지금 오르는 힘', w.candleBodyPct, w.candleBodyPct != null ? `${w.candleBull ? '상승 ' : '하락 '}${w.candleBodyPct.toFixed(3)}%` : '-', r.minCandleBodyPct, Math.max(r.minCandleBodyPct * 3, 0.1), { cold: !w.candleBull })}
      ${meter('큰 흐름', w.ribbonBull ? 1 : w.ema30 > w.ema60 ? 0.65 : 0.2, w.ribbonBull ? '강한 상승' : w.ema30 > w.ema60 ? '초기 상승' : w.ribbonBear ? '큰 하락' : '방향 없음', r.requireFullBullAlignment ? 1 : 0.65, 1, { cold: w.ribbonBear })}
      ${meter('가격 한 칸 손해', w.tickPct, w.tickPct != null ? `${w.tickPct.toFixed(3)}%` : '-', s.maxTickPct, s.maxTickPct * 2, { hot: false, cold: (w.tickPct ?? 0) > s.maxTickPct })}
    </div>`;
  }

  const diagnostic = entryDiagnostics(code, w, c, watched, pos);
  const existingList = box.querySelector('#entryChecksList');
  const existingSummary = box.querySelector('#entryDiagSummary');
  // If the diagnostic checklist is already mounted, update only changed text and statuses
  // in place. Never blow away the DOM tree while the user is reading or dragging the scrollbar.
  if (existingList && existingSummary && box.dataset.curMarket === code && box.dataset.diagMode === diagnostic.mode) {
    patchDiagnosticsInPlace(existingList, existingSummary, diagnostic);
    // If the user touched/scrolled within 2.5s, skip rebuilding outer meters/cards to keep mobile touch smooth.
    if (Date.now() - lastUserTouchTime < 2500) return;
  }

  const d = S.lastDec.get(code) || (w?.last ? { ...w.last, market: code } : null);
  let jev = '';
  if (d) {
    const p = d.p ?? 0;
    const bar = d.kind === 'entry'
      ? `<div class="probbar"><div class="pb-buy" style="flex:${Math.max(p, 0.001)}">매수 ${(p * 100).toFixed(0)}%</div><div class="pb-wait" style="flex:${Math.max(1 - p, 0.001)}">대기 ${((1 - p) * 100).toFixed(0)}%</div></div>`
      : `<div class="probbar"><div class="pb-sell" style="flex:${Math.max(p, 0.001)}">매도 ${(p * 100).toFixed(0)}%</div><div class="pb-wait" style="flex:${Math.max(1 - p, 0.001)}">보유 ${((1 - p) * 100).toFixed(0)}%</div></div>`;
    jev = `<div class="jev-card">
      <div class="hd"><span><b>최근 ${d.provider === 'rule' ? '규칙 판단' : 'Jev 판단'}</b> · ${d.kind === 'entry' ? '진입' : '청산'} · ${ago(d.t)}</span><span>${d.provider === 'rule' ? 'API 호출 없음' : `응답 ${d.latencyMs ?? '-'}ms`}</span></div>
      ${d.ok === false ? `<div class="rs" style="color:var(--warn)">${esc(d.reason || d.error || '오류')}</div>` : bar}
      <div class="rs">${d.fake != null ? `가짜 급등 확률 <b>${(d.fake * 100).toFixed(0)}%</b> · ` : ''}${decisionPill(d)} ${esc(d.reason || '')}</div>
    </div>`;
  } else if (watched) {
    jev = `<div class="jev-card"><div class="hd"><b>최근 ${decisionName}</b></div><div class="rs muted">아직 EMA 리본 진입 구조가 완성되지 않았습니다. 스퀴즈 해제 뒤 EMA30 상향 돌파 또는 눌림목 재지지가 생긴 1분봉에서 ${usingJev ? 'Jev에게 묻습니다' : '규칙 매수를 실행합니다'}.</div></div>`;
  }

  let posHtml = '';
  if (pos) {
    const rb = pos.ribbon || {};
    posHtml = `<div class="pos-card">
      <div class="big ${upDown(pos.pnlPct)}">${fmtPct(pos.pnlPct)} <small style="font-size:12px;font-weight:500">가격 기준 · 수수료 포함 ${fmtPct(pos.netPct)}</small></div>
      <div class="grid">
        <div><span>평균 매수가</span><b>${fmtPrice(pos.avgPrice)}</b></div>
        <div><span>현재 매도가</span><b>${fmtPrice(pos.mark)}</b></div>
        <div><span>매수 금액</span><b>${fmtInt(pos.cost)}</b></div>
        <div><span>평가 금액</span><b>${fmtInt(pos.value)}</b></div>
        <div><span>최고 수익률</span><b class="${upDown(pos.peakPct)}">${fmtPct(pos.peakPct)}</b></div>
        <div><span>보유 시간</span><b>${fmtDur(pos.heldSec)}</b></div>
        <div><span>매도 방식</span><b>${usingJev ? '하락 신호 → Jev 최종 판단' : '하락 신호 → 1분봉 확인 후 매도'}</b></div>
        <div><span>하락 확인선</span><b>${rb.stopPrice ? fmtPrice(rb.stopPrice) : '계산 대기'}${rb.trailArmed ? ' · 수익 뒤 높아짐' : ''}</b></div>
        ${!usingJev && pos.ruleExit ? `<div><span>매도 확인 중</span><b>${esc(pos.ruleExit.state || '대기')} · ${pos.ruleExit.state === '매수 직후 대기' ? `${pos.ruleExit.waitSec || 0}초 남음` : pos.ruleExit.state === '최소 순이익 대기' ? `현재 순이익 ${fmtPct(pos.ruleExit.netPct || 0)} · 기준 ${fmtPct(pos.ruleExit.targetNetPct ?? c.rule.minProfitExitPct)}` : `${esc(pos.ruleExit.signals?.join(' · ') || '하락 신호')} · 완료 ${pos.ruleExit.bars || 0}/${pos.ruleExit.need || c.rule.exitConfirmBars}봉`}</b></div>` : ''}
      </div>
      <button class="btn-big btn-sell" style="margin-top:12px;height:38px;font-size:13px" data-act="sellnow">지금 모의 매도</button>
    </div>`;
  }

  let blocked = '';
  if (w?.blocked && !pos) {
    blocked = w.blocked === 'spread'
      ? `<div class="blocked-note">지금 사는 가격과 바로 파는 가격의 차이가 ${fmtPct(w.spreadPct, 3, false)}입니다. 기준(${s.maxSpreadPct}%)보다 커서 사자마자 불리하므로, 가격 차이가 줄어들 때까지 사지 않습니다.</div>`
      : `<div class="blocked-note">가격이 한 칸만 움직여도 ${fmtPct(w.tickPct, 3, false)} 손해입니다. 기준(${s.maxTickPct}%)보다 커서 이 코인은 사지 않습니다.</div>`;
  }

  box.dataset.curMarket = code;
  box.dataset.diagMode = diagnostic.mode;
  box.innerHTML = `
    <div class="auto-top">
      <div><div class="ttl">${esc(nameOf(code))} 자동매매</div><div class="st">${status}</div></div>
      <button class="switch ${pinned ? 'on' : ''}" data-act="watch" title="고정 감시: 자동 선별 순위와 상관없이 항상 감시"></button>
    </div>
    ${posHtml}${jev}${diagnostic.html}${meters}${blocked}
    <div class="fee-note" style="margin-top:12px;text-align:left">1회 ${c.trade.orderMode === 'percent' ? `가용 원화 ${c.trade.orderPct}%` : fmtInt(c.trade.orderKrw) + '원'} · ${usingJev ? `EMA30 상승 신호 뒤 Jev가 매수 확률 ${Math.round(c.trade.entryProb * 100)}% 이상일 때 매수 · 하락 신호 뒤 Jev가 매도 확률 ${Math.round(c.trade.exitProb * 100)}% 이상일 때만 매도` : `순위·상승 힘·매수 힘·호가창·거래 활발함을 모두 통과하면 매수 · 하락 신호가 ${c.rule.exitConfirmBars}번 이어질 때 매도 · Jev API 호출 0회`} · 비상 손절 외 모든 자동 매도는 예상 순이익 ${fmtPct(c.rule.minProfitExitPct)} 이상일 때만 실행 · <a href="#/settings" style="color:var(--down)">기준 바꾸기</a></div>`;
  const mounted = box.querySelector('#entryChecksList');
  if (mounted) {
    mounted.addEventListener('scroll', noteUserTouch, { passive: true });
    mounted.addEventListener('touchstart', noteUserTouch, { passive: true });
    mounted.addEventListener('touchmove', noteUserTouch, { passive: true });
    mounted.addEventListener('wheel', noteUserTouch, { passive: true });
  }
}

function renderHist() {
  if (!$('#otab-hist').classList.contains('on')) return;
  const list = S.trades.filter((t) => t.market === S.market).slice(-100).reverse();
  $('#histTable').innerHTML = `<thead><tr><th>체결시간</th><th>구분</th><th>체결가</th><th>금액</th><th>손익</th><th>사유</th></tr></thead><tbody>${
    list.map((t) => `<tr><td>${fmtTime(t.t)}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '매수' : '매도'}</td><td>${fmtPrice(t.price)}</td><td>${fmtInt(t.side === 'buy' ? t.net : t.gross)}</td><td class="${upDown(t.pnl)}">${t.pnlPct != null ? fmtPct(t.pnlPct) : '-'}</td><td>${esc(t.reasonKo || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">이 코인의 모의 거래 내역이 없습니다</td></tr>'
  }</tbody>`;
}

function renderOrderPanel() {
  const c = S.config;
  const sum = S.summary;
  if (!c || !sum) return;
  const live = c.mode === 'live' ? S.liveAccount : null;
  const fee = c.paper.feePct;
  const availKrw = live?.configured && !live?.error ? live.krw : c.mode === 'live' ? 0 : sum.krw;
  renderOrderQuote('buy');
  renderOrderQuote('sell');
  $('#buyAvail').textContent = fmtInt(availKrw);
  const buyMarket = ORDER_TYPE.buy === 'market';
  $('#buyFee').textContent = !buyMarket
    ? `${ORDER_TYPE.buy === 'limit' ? '지정가' : '예약가'}는 가격 표시·입력 전용 · 시장가 주문으로 바뀌어 체결되지 않습니다`
    : c.mode === 'live'
    ? (live?.configured && !live?.error ? 'Binance 실전 시장가 주문 · 주문 전 최종 확인 필요' : 'Binance API 키와 잔고 연결이 필요합니다')
    : `최소주문금액: 5,000 KRW · 수수료(부가세 포함): ${fee}% · 슬리피지 ${c.paper.slippagePct}% 반영 모의 체결`;
  const pos = posOf(S.market);
  $('#buyBtn').disabled = !buyMarket || (c.mode === 'live' && (!live?.configured || !!live?.error));
  $('#buyBtn').textContent = buyMarket ? '모의 매수' : `${ORDER_TYPE.buy === 'limit' ? '지정가' : '예약가'} 주문 준비 중`;
  $('#sellAvail').textContent = pos ? fmtQty(pos.qty) : '0';
  $('#sellSym').textContent = sym(S.market);
  const ratio = clamp(parseNum($('#sellRatio').value), 0, 100) / 100;
  $('#sellValue').textContent = pos ? fmtInt(pos.value * ratio) : '0';
  const sellMarket = ORDER_TYPE.sell === 'market';
  $('#sellFee').textContent = !sellMarket
    ? `${ORDER_TYPE.sell === 'limit' ? '지정가' : '예약가'}는 가격 표시·입력 전용 · 시장가 주문으로 바뀌어 체결되지 않습니다`
    : c.mode === 'live' ? 'Binance 실전 시장가 매도 · 주문 전 최종 확인 필요' : `시장가 모의 매도 · 수수료(부가세 포함): ${fee}%`;
  $('#sellBtn').disabled = !sellMarket || !pos || (c.mode === 'live' && (!live?.configured || !!live?.error));
  $('#sellBtn').textContent = sellMarket ? '모의 매도' : `${ORDER_TYPE.sell === 'limit' ? '지정가' : '예약가'} 주문 준비 중`;
  renderAutoTab();
  renderHist();
}

// =====================================================================================
// wiring
// =====================================================================================
function onMarketChange() {
  OB.centered = false;
  renderHeader();
  renderOrderbook();
  renderObInfo();
  loadChart();
  loadTicks();
  if ($('#btab-days').classList.contains('on')) loadDays();
  renderCoinJev();
  renderOrderPanel();
  refreshTags();
  for (const r of ML.rows.values()) r.el.classList.toggle('sel', r.el.dataset.code === S.market);
}

export function initExchange() {
  initList();
  initChart();
  initOrderbook();
  initOrderPanel();
  initBottomTabs();

  bus.on('init', () => { ML.rows.clear(); ML.order = []; ML.sig = ''; renderList(true); onMarketChange(); });
  bus.on('market', onMarketChange);
  bus.on('tk', (list) => {
    for (const [cd] of list) paintRow(cd);
    if (list.some(([cd]) => cd === S.market)) { renderHeader(); renderOrderPanel(); }
  });
  bus.on('vt', () => { renderHeader(); renderObInfo(); });
  bus.on('ob', () => { renderOrderbook(); renderOrderPanel(); });
  bus.on('tr', (list) => { onTrades(list); onChartTrades(list); });
  bus.on('sum', () => { refreshTags(); if (ML.tab === 'hold') renderList(true); renderOrderPanel(); drawPriceLines(); renderHeader(); });
  bus.on('live-account', () => { refreshTags(); if (ML.tab === 'hold') renderList(true); renderOrderPanel(); renderHeader(); });
  bus.on('scr', () => { if (ML.tab === 'auto') renderList(true); else refreshTags(); });
  bus.on('cfg', () => { refreshTags(); renderOrderPanel(); renderHeader(); drawPriceLines(true); });
  bus.on('dec', (d) => { if (d.market === S.market) { renderCoinJev(); renderAutoTab(); } });
  bus.on('fill', (t) => { if (t.market === S.market) { drawMarks(); renderHist(); } });
}
