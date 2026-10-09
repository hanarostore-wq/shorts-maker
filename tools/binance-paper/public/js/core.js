// Shared helpers, global state and network layer for the dashboard.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------ number formatting (Binance style)
export function priceDecimals(p) {
  const a = Math.abs(p || 0);
  if (a >= 100) return 0;
  if (a >= 10) return 2;
  if (a >= 1) return 3;
  if (a >= 0.1) return 4;
  if (a >= 0.01) return 5;
  return 8;
}
export function fmtPrice(p, trim = true) {
  if (p == null || !Number.isFinite(p)) return '-';
  const d = priceDecimals(p);
  let s = p.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (trim && d > 0) s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s;
}
export const fmtKrw = (v, d = 0) => (v == null || !Number.isFinite(v) ? '-' : Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ko-KR', { maximumFractionDigits: d });
export const fmtInt = (v) => (v == null || !Number.isFinite(v) ? '-' : Math.round(v).toLocaleString('ko-KR'));
export function fmtPct(v, d = 2, sign = true) {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${sign && v > 0 ? '+' : ''}${v.toFixed(d)}%`;
}
export function fmtSigned(v, fmt = fmtPrice) {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmt(Math.abs(v))}`;
}
export function fmtQty(v) {
  if (v == null || !Number.isFinite(v)) return '-';
  if (v >= 1000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 8 });
}
export const fmtMillion = (v) => (v == null ? '-' : Math.floor(v / 1e6).toLocaleString('ko-KR'));
export function fmtDur(sec) {
  if (sec == null || !Number.isFinite(sec)) return '-';
  if (sec < 60) return `${Math.round(sec)}초`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초`;
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`;
}
export function fmtTime(t, withDate = false) {
  // always KST (UTC+9, no DST) so the dashboard matches Binance regardless of the viewer's timezone
  const d = new Date(Number(t) + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  return withDate ? `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${time}` : time;
}
export function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 5) return '방금';
  if (s < 60) return `${Math.floor(s)}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}
export const upDown = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'even');
export const sym = (code) => code?.split('-')[1] || '';

// ------------------------------------------------------------ global state + bus
const listeners = new Map();
export const bus = {
  on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); },
  emit(ev, data) { listeners.get(ev)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(ev, e); } }); }
};

export const S = {
  cid: sessionStorage.getItem('mu-cid') || Math.random().toString(36).slice(2),
  market: localStorage.getItem('binance-market') || 'USDT-BTC',
  markets: [],
  marketMap: new Map(),
  tickers: new Map(),
  config: null,
  summary: null,
  watch: [],
  trades: [],
  decisions: [],
  equity: [],
  logs: [],
  ob: null,
  viewTicker: null,
  status: {},
  lastDec: new Map(),
  screener: null,
  cloud: null,
  monitor: null,
  liveAccount: null,
  favs: new Set(JSON.parse(localStorage.getItem('mu-favs') || '["KRW-BTC","KRW-ETH","KRW-XRP"]')),
  connected: false
};
sessionStorage.setItem('mu-cid', S.cid);

export function saveFavs() { localStorage.setItem('mu-favs', JSON.stringify([...S.favs])); }
export const nameOf = (code) => S.marketMap.get(code)?.ko || sym(code);

// ------------------------------------------------------------ network
export const AUTH = { token: localStorage.getItem('mu-token') || '' };
export function setToken(t) { AUTH.token = t || ''; if (t) localStorage.setItem('mu-token', t); else localStorage.removeItem('mu-token'); }
/** Add the session token to URLs that the browser loads directly (SSE, downloads). */
export function authUrl(path) { return AUTH.token ? `${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(AUTH.token)}` : path; }

export async function api(path, body) {
  const headers = {};
  if (AUTH.token) headers['X-MU-Token'] = AUTH.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'auth') { bus.emit('auth-required'); throw new Error('로그인이 필요합니다'); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let liveTimer = null;
let monitorFallbackBusy = false;

export async function refreshMonitor() {
  if (monitorFallbackBusy) return S.monitor;
  monitorFallbackBusy = true;
  try {
    const health = await api('/api/health');
    if (health?.monitor?.current) {
      S.monitor = health.monitor;
      bus.emit('monitor', S.monitor);
    }
    return S.monitor;
  } catch {
    return S.monitor;
  } finally {
    monitorFallbackBusy = false;
  }
}

function ensureMonitor() {
  if (!S.monitor?.current) refreshMonitor();
}

export async function refreshLiveAccount(force = false) {
  if (S.config?.mode !== 'live') {
    if (S.liveAccount) { S.liveAccount = null; bus.emit('live-account', null); }
    return null;
  }
  try {
    const account = await api(`/api/live/account${force ? '?refresh=1' : ''}`);
    S.liveAccount = account;
    bus.emit('live-account', account);
    return account;
  } catch (e) {
    S.liveAccount = { mode: 'live', configured: false, error: e.message, positions: [] };
    bus.emit('live-account', S.liveAccount);
    return S.liveAccount;
  }
}

function syncLiveAccountTimer() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  if (S.config?.mode === 'live') {
    refreshLiveAccount(true);
    liveTimer = setInterval(() => refreshLiveAccount(), 15000);
  }
}

let es = null;
let errSince = 0;
export function disconnect() { if (es) { es.close(); es = null; } }
export function connect() {
  if (es) es.close();
  es = new EventSource(authUrl(`/api/stream?cid=${S.cid}&market=${S.market}`), { withCredentials: true });
  const on = (ev, fn) => es.addEventListener(ev, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(ev, err); } });
  const stream = es;
  let initialReceived = false;
  on('init', (d) => {
    initialReceived = true;
    S.markets = d.markets;
    S.marketMap = new Map(d.markets.map((m) => [m.code, m]));
    const heldMarket = d.summary?.positions?.[0]?.market;
    if (heldMarket && S.marketMap.has(heldMarket)) {
      S.market = heldMarket;
      localStorage.setItem('binance-market', heldMarket);
    }
    S.tickers = new Map(d.tickers.map((t) => [t.cd, t]));
    S.viewTicker = S.tickers.get(S.market) || null;
    S.config = d.config; S.summary = d.summary; S.watch = d.watch;
    S.trades = d.trades; S.decisions = d.decisions; S.equity = d.equity; S.logs = d.logs;
    S.lastDec = new Map();
    for (const x of d.decisions) S.lastDec.set(x.market, x);
    S.ob = d.ob; S.status = d.status; S.connected = true;
    S.screener = d.screener || null; S.cloud = d.cloud || null; S.monitor = d.monitor?.current ? d.monitor : S.monitor;
    bus.emit('init', d);
    ensureMonitor();
    syncLiveAccountTimer();
    // EventSource reconnects reuse the original URL, so make sure the server follows the current market
    api('/api/view', { cid: S.cid, market: S.market }).then((r) => {
      if (r.ob) { S.ob = { cd: S.market, ...r.ob }; bus.emit('ob', S.ob); }
    }).catch(() => {});
  });
  on('reset', (d) => { S.summary = d.summary; S.watch = d.watch; S.trades = []; S.decisions = []; S.equity = d.equity; S.monitor = d.monitor?.current ? d.monitor : S.monitor; bus.emit('init', d); ensureMonitor(); });
  on('tk', (list) => {
    for (const [cd, tp, scr, atp24h, scp] of list) {
      const t = S.tickers.get(cd);
      if (t) { t.prev = t.tp; t.tp = tp; t.scr = scr; t.atp24h = atp24h; t.scp = scp; }
      else S.tickers.set(cd, { cd, tp, scr, atp24h, scp });
    }
    bus.emit('tk', list);
  });
  on('vt', (t) => { if (t.cd !== S.market) return; S.viewTicker = t; const cur = S.tickers.get(t.cd); if (cur) Object.assign(cur, t); bus.emit('vt', t); });
  on('ob', (ob) => { if (ob.cd !== S.market) return; S.ob = ob; bus.emit('ob', ob); });
  on('tr', (d) => { if (d.cd !== S.market) return; bus.emit('tr', d.list); });
  on('sum', (d) => { S.summary = d.summary; S.watch = d.watch; S.status = d.status; if (d.cloud) S.cloud = d.cloud; if (d.monitor?.current) S.monitor = d.monitor; else ensureMonitor(); bus.emit('sum', d); });
  on('scr', (d) => { S.screener = d; bus.emit('scr', d); });
  on('dec', (d) => {
    S.lastDec.set(d.market, d);
    if (!d.quiet) { S.decisions.push(d); if (S.decisions.length > 600) S.decisions.shift(); }
    bus.emit('dec', d);
  });
  on('fill', (t) => { S.trades.push(t); bus.emit('fill', t); });
  on('cfg', (c) => { S.config = c; bus.emit('cfg', c); syncLiveAccountTimer(); });
  on('log', (l) => { S.logs.push(l); if (S.logs.length > 200) S.logs.shift(); bus.emit('log', l); });
  es.onerror = () => {
    S.connected = false;
    bus.emit('conn', false);
    // A rejected session makes EventSource retry forever; check once and ask for the password instead.
    const now = Date.now();
    if (now - errSince > 5000) { errSince = now; api('/api/auth').then((a) => { if (a.required && !a.ok) bus.emit('auth-required'); }).catch(() => {}); }
  };
  es.onopen = () => {
    S.connected = true; bus.emit('conn', true);
    // SSE 첫 상태 이벤트가 누락되는 로컬 브라우저는 일반 API 응답으로 동일한 init 이벤트를 재생한다.
    setTimeout(() => {
      if (es !== stream || initialReceived) return;
      api('/api/state').then((state) => {
        if (es === stream && !initialReceived) es.dispatchEvent(new MessageEvent('init', { data: JSON.stringify(state) }));
      }).catch(() => {});
    }, 1200);
  };
}

export async function setMarket(code) {
  if (!code || code === S.market) return;
  S.market = code;
  localStorage.setItem('binance-market', code);
  S.ob = null;
  S.viewTicker = S.tickers.get(code) || null;
  bus.emit('market', code);
  try {
    const r = await api('/api/view', { cid: S.cid, market: code });
    if (S.market !== code) return;
    if (r.ob) { S.ob = { cd: code, ...r.ob }; bus.emit('ob', S.ob); }
    if (r.ticker) { S.viewTicker = r.ticker; bus.emit('vt', r.ticker); }
  } catch { /* stream reconnect will fix */ }
}

export function toast(msg, type = 'info') {
  const wrap = document.getElementById('toasts');
  const t = h('div', { class: `toast ${type}` }, msg);
  wrap.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ------------------------------------------------------------ confirmed order notices
const noticed = new Set();
let tradeAlertTimer = null, tradeAlertTick = null;
function once(key) {
  if (!key) return true;
  if (noticed.has(key)) return false;
  noticed.add(key);
  if (noticed.size > 200) noticed.delete(noticed.values().next().value);
  return true;
}
function speakKorean(text) {
  const a = S.config?.alerts || {};
  if (!a.voiceEnabled || !(Number(a.voiceVolume) > 0) || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.volume = Math.max(0, Math.min(1, Number(a.voiceVolume)));
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch { /* Browser voice support is optional; the visual notice still appears. */ }
}
function alertDetail(label, value, cls = '') {
  const d = h('div', {}); d.append(h('span', {}, label), h('b', { class: cls }, value)); return d;
}
export function orderNotice(kind, data = {}) {
  const id = data.id || `${kind}:${data.market || ''}:${data.t || Date.now()}:${data.message || ''}`;
  if (!once(id)) return;
  const wrap = $('#tradeAlert'), card = $('#tradeAlertCard');
  if (!wrap || !card) return;
  const side = kind === 'sell' ? 'sell' : kind === 'cancel' ? 'cancel' : 'buy';
  const name = data.market ? nameOf(data.market) : '주문';
  const sec = Math.max(3, Math.min(10, Number(S.config?.alerts?.displaySec) || 5));
  card.className = `trade-alert-card ${side}`;
  $('#taTitle').textContent = kind === 'sell' ? '매도 체결 완료' : kind === 'cancel' ? '주문 취소' : kind === 'filled' ? '주문 체결 완료' : '매수 체결 완료';
  $('#taCoin').textContent = data.market ? `${name} · ${sym(data.market)}/KRW` : name;
  const details = $('#taDetails'); details.replaceChildren();
  let speech;
  if (kind === 'sell') {
    const sellAmt = data.net ?? data.gross;
    details.append(
      alertDetail('판매가격', `${fmtPrice(data.price)} KRW`),
      alertDetail('정산금액', `${fmtInt(sellAmt)} KRW`),
      alertDetail('실현손익', `${fmtSigned(data.pnl, fmtInt)} KRW`, upDown(data.pnl))
    );
    speech = '매도되었습니다.';
  } else if (kind === 'cancel') {
    details.append(alertDetail('처리 결과', '주문 취소'), alertDetail('사유', data.message || '주문이 취소되었습니다'));
    speech = '취소되었습니다.';
  } else {
    details.append(alertDetail('진입가', `${fmtPrice(data.price)} KRW`), alertDetail('매수금액', `${fmtInt(data.net ?? data.gross)} KRW`));
    speech = '매수되었습니다.';
  }
  $('#taFoot').textContent = data.reasonKo ? `서버 체결 확정 · ${data.reasonKo}` : '서버 체결 확정';
  clearTimeout(tradeAlertTimer); clearInterval(tradeAlertTick);
  const end = Date.now() + sec * 1000;
  const count = () => { const left = Math.max(0, Math.ceil((end - Date.now()) / 1000)); $('#taCount').textContent = `${left}초`; };
  count(); wrap.classList.add('on'); speakKorean(speech);
  tradeAlertTick = setInterval(count, 200);
  tradeAlertTimer = setTimeout(() => { clearInterval(tradeAlertTick); wrap.classList.remove('on'); }, sec * 1000);
}
export function tradeNotice(fill) { orderNotice(fill?.side === 'sell' ? 'sell' : 'buy', fill || {}); }

export function coinIcon(code) {
  return '';
}
