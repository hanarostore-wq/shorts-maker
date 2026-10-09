import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const kind = process.env.PAPER_KIND === 'futures' ? 'futures' : 'spot';
const isFutures = kind === 'futures';
const port = Number(process.env.PORT || (isFutures ? 7082 : 7081));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const SLOT_PRESETS_PATH = path.join(ROOT, 'binance-slot-presets.json');
const dataDir = process.env.PAPER_DATA_DIR || `C:/ProgramData/BinanceTerminal/${kind}`;
const configPath = path.join(dataDir, 'terminal-config.json');
const paperPath = path.join(dataDir, 'paper-account.json');

const SPOT_REST = process.env.BINANCE_SPOT_REST || 'https://api.binance.com';
const SPOT_DATA = process.env.BINANCE_SPOT_DATA || 'https://data-api.binance.vision';
const FUTURES_REST = process.env.BINANCE_FUTURES_REST || 'https://fapi.binance.com';
const SPOT_WS = 'wss://stream.binance.com:9443';
const FUTURES_WS = 'wss://fstream.binance.com';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT'];
const SLOT_COUNT = 5;
let marketCatalog = SYMBOLS.map((symbol) => ({ symbol, price: 0, changePct: 0, quoteVolume: 0 }));

fs.mkdirSync(dataDir, { recursive: true });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function defaultSlotShelf() {
  try {
    const raw = JSON.parse(fs.readFileSync(SLOT_PRESETS_PATH, 'utf8').replace(/^\uFEFF/, ''));
    const items = (raw.items || []).filter((item) => Number(item?.id) >= 1 && Number(item?.id) <= SLOT_COUNT && item?.definition)
      .sort((left, right) => left.id - right.id)
      .map((item) => ({ ...clone(item), status: item.id === Number(raw.activeId) ? '적용 중' : '검사 완료' }));
    if (items.length !== SLOT_COUNT) throw new Error('slot preset count');
    const activeId = items.some((item) => item.id === Number(raw.activeId)) ? Number(raw.activeId) : 1;
    return { version: 1, activeId, items };
  } catch {
    return {
      version: 1,
      activeId: 1,
      items: Array.from({ length: SLOT_COUNT }, (_, index) => ({
        id: index + 1,
        name: `${index + 1}번 Binance 전용 슬롯`,
        status: index === 0 ? '적용 중' : '검사 완료',
        definition: { 슬롯이름: `${index + 1}번 Binance 전용 슬롯`, 전략설명: 'Binance 슬롯 프리셋을 불러오는 중입니다', 사용가능모드: ['모의투자'], 주문설정: { 주문방식: '고정금액', 주문금액원: 10_000, 동시보유수: 1 } },
        enabledRuleIds: [],
      })),
    };
  }
}
function normalizeSlotShelf(source) {
  const seeded = defaultSlotShelf();
  const items = Array.isArray(source?.items) ? source.items
    .filter((item) => Number(item?.id) >= 1 && Number(item?.id) <= SLOT_COUNT && item?.definition)
    .sort((left, right) => left.id - right.id)
    .map((item) => clone(item)) : [];
  if (items.length !== SLOT_COUNT || new Set(items.map((item) => item.id)).size !== SLOT_COUNT) return seeded;
  const requested = Number(source?.activeId);
  const activeId = items.some((item) => item.id === requested) ? requested : 1;
  return { version: Math.max(1, Math.floor(num(source?.version, 1))), activeId, items: items.map((item) => ({ ...item, status: item.id === activeId ? '적용 중' : '검사 완료' })) };
}

const defaultConfig = () => ({
  mode: 'paper',
  apiKey: '',
  secretKey: '',
  paperInitialKrw: 100_000_000,
  paperOrderKrw: 1_000_000,
  paperOrderMode: 'fixed',
  paperOrderPct: 10,
  maxPositions: 1,
  futuresLeverage: 1,
  autoTrading: false,
  activeSlot: 1,
  slots: defaultSlotShelf(),
  symbol: 'BTCUSDT',
  interval: '1m',
  updatedAt: Date.now(),
});
const defaultPaper = (initialKrw) => ({
  initialKrw,
  availableKrw: initialKrw,
  realizedKrw: 0,
  position: null,
  orders: [],
  trades: [],
  updatedAt: Date.now(),
});

function readJson(file, fallback) {
  try { return { ...fallback(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return fallback(); }
}
let config = readJson(configPath, defaultConfig);
function saveConfig() { config.updatedAt = Date.now(); fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8'); }
function savePaper() { paper.updatedAt = Date.now(); fs.writeFileSync(paperPath, JSON.stringify(paper, null, 2), 'utf8'); }
function versionBook(slotId) { config.slotVersions ||= {}; const key=String(slotId); config.slotVersions[key] ||= { activeVersionId: null, items: [] }; return config.slotVersions[key]; }
function versionRecord(slot, number) { return { id: `${slot.id}-${number}`, number: `${slot.id}-${number}`, name: slot.name || slot.definition?.슬롯이름 || `${slot.id}번 전략`, fileName: slot.fileName || null, definition: clone(slot.definition), enabledRuleIds: [...(slot.enabledRuleIds || [])], savedAt: Date.now() }; }
function ensureSlotVersions() { for (const slot of config.slots.items) { if (!slot?.definition) continue; const book=versionBook(slot.id); const same=book.items.find((v)=>JSON.stringify(v.definition)===JSON.stringify(slot.definition) && JSON.stringify(v.enabledRuleIds)===JSON.stringify(slot.enabledRuleIds)); if (!same) book.items.push(versionRecord(slot, book.items.length + 1)); const current=same || book.items.at(-1); if (slot.id===config.activeSlot && !book.activeVersionId) book.activeVersionId=current.id; } }
function addSlotVersion(slotId, definition, fileName, name) { const book=versionBook(slotId); const number=book.items.length+1; const value={ id: `${slotId}-${number}`, number: `${slotId}-${number}`, name: String(name || definition?.슬롯이름 || `${slotId}번 전략`).slice(0,80), fileName: fileName || null, definition: clone(definition), enabledRuleIds:[...(definition?.코인고르기규칙||[]),...(definition?.매수규칙||[]),...(definition?.매도규칙||[])].filter((r)=>r?.사용).map((r)=>r.규칙번호), savedAt:Date.now() }; book.items.push(value); return value; }
function applySlotVersion(slotId, versionId) { const book=versionBook(slotId); const version=book.items.find((v)=>v.id===versionId); if (!version) throw new Error('선택한 전략 버전을 찾지 못했습니다'); const index=config.slots.items.findIndex((x)=>x.id===slotId); if(index<0) throw new Error('슬롯을 찾지 못했습니다'); config.slots.items[index]={ id:slotId, name:version.name, status:'적용 중', fileName:version.fileName, definition:clone(version.definition), enabledRuleIds:[...version.enabledRuleIds], note:`전략 버전 ${version.number} 적용` }; activateSlot(slotId); book.activeVersionId=version.id; return version; }

config.slots = normalizeSlotShelf(config.slots);
config.activeSlot = config.slots.activeId;
ensureSlotVersions();
saveConfig();
let paper = readJson(paperPath, () => defaultPaper(config.paperInitialKrw));

const market = {
  symbol: config.symbol,
  interval: config.interval,
  connected: false,
  lastMessageAt: 0,
  lastRestAt: 0,
  error: '실시간 시세 연결 중',
  price: 0,
  open24h: 0,
  high24h: 0,
  low24h: 0,
  changePct: 0,
  volumeBase: 0,
  volumeQuote: 0,
  bid: 0,
  ask: 0,
  usdKrw: 0,
  candles: [],
  bids: [],
  asks: [],
  trades: [],
  markPrice: 0,
  indexPrice: 0,
  fundingRate: 0,
  nextFundingTime: 0,
  openInterest: 0,
};
let publicSocket = null;
let catalogSocket = null;
let catalogReconnectTimer = null;
let catalogBookSocket = null;
let catalogBookReconnectTimer = null;
const catalogBooks = new Map();
const catalogSubscribed = new Set();
let lastBookBroadcastAt = 0;
let privateSocket = null;
let privateListenKey = null;
let privateKeepAlive = null;
let reconnectTimer = null;
let clients = new Set();
let broadcastTimer = null;
let liveAccount = { configured: false, ready: false, refreshedAt: 0, error: 'API 키를 입력하면 실제 계좌를 확인합니다', balances: [], positions: [], orders: [], trades: [], events: [] };

function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function fixed(value, decimals = 6) { return Number(num(value).toFixed(decimals)); }
function nowKst() { return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }); }
function krw(usd) { return num(usd) * num(market.usdKrw); }
function safeSymbol(symbol) {
  const candidate = String(symbol || '').toUpperCase();
  return marketCatalog.some((item) => item.symbol === candidate) ? candidate : null;
}
function slotOrder(slot) {
  const order = slot?.definition?.주문설정 || {};
  return { type: order.주문방식 || '고정금액', amountKrw: num(order.주문금액원), ratio: num(order.주문가능원화비율), maxPositions: Math.max(1, Math.floor(num(order.동시보유수, 1))) };
}
function slotSummary(slot) {
  const definition = slot?.definition || {};
  const enabled = (group) => Array.isArray(definition[group]) ? definition[group].filter((rule) => rule?.사용).length : 0;
  return {
    id: slot.id,
    name: slot.name || definition.슬롯이름 || `${slot.id}번 슬롯`,
    status: slot.id === config.activeSlot ? '적용 중' : '검사 완료',
    description: definition.전략설명 || '',
    modes: definition.사용가능모드 || ['모의투자'],
    decision: definition.판단방식 || '규칙만 사용',
    order: slotOrder(slot),
    ruleCounts: { selection: enabled('코인고르기규칙'), entry: enabled('매수규칙'), exit: enabled('매도규칙') },
  };
}
function activeSlot() { return config.slots.items.find((slot) => slot.id === config.activeSlot) || config.slots.items[0]; }
function activateSlot(slotId) {
  const id = Math.max(1, Math.min(SLOT_COUNT, Math.floor(num(slotId, config.activeSlot))));
  const slot = config.slots.items.find((item) => item.id === id);
  if (!slot?.definition) throw new Error(`${id}번 슬롯 정의를 찾지 못했습니다`);
  const requiredMode = config.mode === 'live' ? '실전투자' : '모의투자';
  if (!slot.definition.사용가능모드?.includes(requiredMode)) throw new Error(`${slot.name}은 ${requiredMode}에서 사용할 수 없습니다`);
  config.activeSlot = slot.id;
  config.slots.activeId = slot.id;
  const order = slotOrder(slot);
  if (order.type === '고정금액' && order.amountKrw >= 10_000) config.paperOrderKrw = order.amountKrw;
  return slot;
}
function publicConfig() {
  return {
    mode: config.mode,
    hasApiKey: Boolean(config.apiKey && config.secretKey),
    apiKeyHint: config.apiKey ? `${config.apiKey.slice(0, 5)}••••${config.apiKey.slice(-3)}` : '',
    paperInitialKrw: config.paperInitialKrw,
    paperOrderKrw: config.paperOrderKrw,
    paperOrderMode: config.paperOrderMode,
    paperOrderPct: config.paperOrderPct,
    maxPositions: config.maxPositions,
    futuresLeverage: config.futuresLeverage,
    autoTrading: config.autoTrading,
    activeSlot: config.activeSlot,
    slotCount: SLOT_COUNT,
    slots: clone(config.slots),
    slotVersions: clone(config.slotVersions || {}),
    symbol: market.symbol,
    interval: market.interval,
  };
}

function signedQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, recvWindow: 5000, timestamp: Date.now() })) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const signature = crypto.createHmac('sha256', config.secretKey).update(search.toString()).digest('hex');
  search.set('signature', signature);
  return search.toString();
}
async function signedRequest(method, base, endpoint, params = {}) {
  if (!config.apiKey || !config.secretKey) throw new Error('API Key와 Secret Key를 로컬 설정에서 입력하세요');
  const query = signedQuery(params);
  const response = await fetch(`${base}${endpoint}?${query}`, {
    method,
    headers: { 'X-MBX-APIKEY': config.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.msg || `Binance API HTTP ${response.status}`);
  return body;
}
async function publicJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'BLACK-BinanceTerminal/2.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function updatePrice(next) {
  if (next?.price) market.price = num(next.price, market.price);
  if (next?.bid) market.bid = num(next.bid, market.bid);
  if (next?.ask) market.ask = num(next.ask, market.ask);
  market.lastMessageAt = Date.now();
  market.error = '';
  requestBroadcast();
}
function pushTrade(raw) {
  market.trades.unshift({ price: num(raw.price), qty: num(raw.qty), buy: Boolean(raw.buy), time: num(raw.time) || Date.now() });
  if (market.trades.length > 80) market.trades.length = 80;
}
function mergeCandle(raw) {
  const row = { t: num(raw.t), o: num(raw.o), h: num(raw.h), l: num(raw.l), c: num(raw.c), v: num(raw.v) };
  const idx = market.candles.findIndex((item) => item.t === row.t);
  if (idx >= 0) market.candles[idx] = row;
  else {
    market.candles.push(row);
    market.candles = market.candles.slice(-180);
  }
}

async function seedMarket() {
  const symbol = market.symbol;
  try {
    const fx = publicJson('https://open.er-api.com/v6/latest/USD').catch(() => ({ rates: {} }));
    if (isFutures) {
      const [ticker, depth, candles, premium, oi, exchange] = await Promise.all([
        publicJson(`${FUTURES_REST}/fapi/v1/ticker/24hr?symbol=${symbol}`),
        publicJson(`${FUTURES_REST}/fapi/v1/depth?symbol=${symbol}&limit=20`),
        publicJson(`${FUTURES_REST}/fapi/v1/klines?symbol=${symbol}&interval=${market.interval}&limit=180`),
        publicJson(`${FUTURES_REST}/fapi/v1/premiumIndex?symbol=${symbol}`),
        publicJson(`${FUTURES_REST}/fapi/v1/openInterest?symbol=${symbol}`),
        fx,
      ]);
      market.usdKrw = num(exchange.rates?.KRW, market.usdKrw);
      market.price = num(premium.markPrice || ticker.lastPrice);
      market.markPrice = num(premium.markPrice);
      market.indexPrice = num(premium.indexPrice);
      market.fundingRate = num(premium.lastFundingRate) * 100;
      market.nextFundingTime = num(premium.nextFundingTime);
      market.openInterest = num(oi.openInterest);
      applyTicker(ticker);
      market.bids = (depth.bids || []).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
      market.asks = (depth.asks || []).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
      market.candles = (candles || []).map(([t, o, h, l, c, v]) => ({ t: num(t), o: num(o), h: num(h), l: num(l), c: num(c), v: num(v) }));
    } else {
      const [ticker, depth, candles, exchange] = await Promise.all([
        publicJson(`${SPOT_DATA}/api/v3/ticker/24hr?symbol=${symbol}`),
        publicJson(`${SPOT_DATA}/api/v3/depth?symbol=${symbol}&limit=20`),
        publicJson(`${SPOT_DATA}/api/v3/klines?symbol=${symbol}&interval=${market.interval}&limit=180`),
        fx,
      ]);
      market.usdKrw = num(exchange.rates?.KRW, market.usdKrw);
      applyTicker(ticker);
      market.bids = (depth.bids || []).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
      market.asks = (depth.asks || []).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
      market.candles = (candles || []).map(([t, o, h, l, c, v]) => ({ t: num(t), o: num(o), h: num(h), l: num(l), c: num(c), v: num(v) }));
    }
    market.lastRestAt = Date.now();
    market.error = '';
  } catch (error) {
    market.error = `초기 시세 수신 실패: ${error instanceof Error ? error.message : '확인 필요'}`;
  }
  requestBroadcast();
}
function applyTicker(data) {
  market.price = num(data.lastPrice ?? data.c, market.price);
  market.open24h = num(data.openPrice ?? data.o, market.open24h);
  market.high24h = num(data.highPrice ?? data.h, market.high24h);
  market.low24h = num(data.lowPrice ?? data.l, market.low24h);
  market.changePct = num(data.priceChangePercent ?? data.P, market.changePct);
  market.volumeBase = num(data.volume ?? data.v, market.volumeBase);
  market.volumeQuote = num(data.quoteVolume ?? data.q, market.volumeQuote);
}

async function refreshMarketCatalog() {
  try {
    const [exchangeInfo, tickers] = await Promise.all([
      publicJson(isFutures ? `${FUTURES_REST}/fapi/v1/exchangeInfo` : `${SPOT_DATA}/api/v3/exchangeInfo`),
      publicJson(isFutures ? `${FUTURES_REST}/fapi/v1/ticker/24hr` : `${SPOT_DATA}/api/v3/ticker/24hr`),
    ]);
    const allowed = new Set((exchangeInfo.symbols || [])
      .filter((item) => item.status === 'TRADING' && item.quoteAsset === 'USDT' && (isFutures || item.isSpotTradingAllowed !== false))
      .map((item) => item.symbol));
    const next = (Array.isArray(tickers) ? tickers : [])
      .filter((item) => allowed.has(item.symbol))
      .map((item) => ({
        symbol: item.symbol,
        price: num(item.lastPrice),
        changePct: num(item.priceChangePercent),
        quoteVolume: num(item.quoteVolume),
      }))
      .sort((left, right) => right.quoteVolume - left.quoteVolume);
    if (next.length) { marketCatalog = next; if (!isFutures) subscribeCatalogSymbols(); }
  } catch { /* the previous catalog remains usable while a public API is temporarily unavailable */ }
  requestBroadcast();
}

function publicStreams() {
  const symbol = market.symbol.toLowerCase();
  const common = [`${symbol}@ticker`, `${symbol}@depth20@100ms`, `${symbol}@aggTrade`, `${symbol}@kline_${market.interval}`];
  if (isFutures) common.push(`${symbol}@markPrice@1s`);
  return common;
}
function wsText(data) { return typeof data === 'string' ? data : Buffer.from(data).toString('utf8'); }
function subscribeCatalogSymbols() {
  if (isFutures || !catalogSocket || catalogSocket.readyState !== WebSocket.OPEN) return;
  const params = marketCatalog.map((row) => row.symbol.toLowerCase()).filter((symbol) => !catalogSubscribed.has(symbol)).map((symbol) => `${symbol}@ticker`);
  for (let i=0;i<params.length;i+=180) {
    const group=params.slice(i,i+180); if (!group.length) continue;
    group.forEach((symbol)=>catalogSubscribed.add(symbol));
    try { catalogSocket.send(JSON.stringify({ method:'SUBSCRIBE', params:group, id:Date.now()+i })); } catch { group.forEach((symbol)=>catalogSubscribed.delete(symbol)); }
  }
}
function connectCatalogStream() {
  if (isFutures) {
    // Futures uses the all-market book stream below because its all-ticker stream can be rate-limited by the exchange.
    connectCatalogBookStream();
    return;
  }
  if (catalogSocket && (catalogSocket.readyState === WebSocket.OPEN || catalogSocket.readyState === WebSocket.CONNECTING)) { subscribeCatalogSymbols(); return; }
  clearTimeout(catalogReconnectTimer); catalogSubscribed.clear();
  try {
    catalogSocket = new WebSocket(`${SPOT_WS}/ws`);
    catalogSocket.addEventListener('open', () => subscribeCatalogSymbols());
    catalogSocket.addEventListener('message', (event) => { try { const data=JSON.parse(wsText(event.data)); if (Array.isArray(data)) applyAllTickers(data); else if (data?.e==='24hrTicker') applyAllTickers([data]); } catch {} });
    catalogSocket.addEventListener('close', () => { catalogSocket=null; catalogSubscribed.clear(); catalogReconnectTimer=setTimeout(connectCatalogStream,3000); });
    catalogSocket.addEventListener('error', () => { try { catalogSocket?.close(); } catch {} });
  } catch { catalogReconnectTimer=setTimeout(connectCatalogStream,3000); }
}
function bookStats(symbol) { const b=catalogBooks.get(symbol); if(!b||!b.bid||!b.ask||!b.bidQty||!b.askQty)return null; return {lead:(b.bidQty/b.askQty-1)*100, spread:(b.ask-b.bid)/((b.ask+b.bid)/2)*100}; }
function applyCatalogBook(data) { const symbol=String(data?.s||''); const bid=num(data?.b); const ask=num(data?.a); const bidQty=num(data?.B); const askQty=num(data?.A); if(!symbol.endsWith('USDT')||!bid||!ask)return; catalogBooks.set(symbol,{bid,ask,bidQty,askQty,t:Date.now()}); const base=marketCatalog.find(x=>x.symbol===symbol); recordCatalogTick(symbol,(bid+ask)/2,base?.quoteVolume||0); const now=Date.now(); if(now-lastBookBroadcastAt>500){lastBookBroadcastAt=now;requestBroadcast();} }
function connectCatalogBookStream() { if(catalogBookSocket && (catalogBookSocket.readyState===WebSocket.OPEN||catalogBookSocket.readyState===WebSocket.CONNECTING))return; clearTimeout(catalogBookReconnectTimer); const base=isFutures?FUTURES_WS:SPOT_WS; try { catalogBookSocket=new WebSocket(`${base}/ws/!bookTicker`); catalogBookSocket.addEventListener('message',(event)=>{try{applyCatalogBook(JSON.parse(wsText(event.data)));}catch{}}); catalogBookSocket.addEventListener('close',()=>{catalogBookSocket=null;catalogBookReconnectTimer=setTimeout(connectCatalogBookStream,3000);}); catalogBookSocket.addEventListener('error',()=>{try{catalogBookSocket?.close();}catch{}});}catch{catalogBookReconnectTimer=setTimeout(connectCatalogBookStream,3000);} }

function connectMarket() {
  connectCatalogStream();
  if (!marketCatalog.some((row) => row.symbol === market.symbol)) { market.symbol = 'BTCUSDT'; config.symbol = 'BTCUSDT'; saveConfig(); }
  clearTimeout(reconnectTimer);
  if (publicSocket) { try { publicSocket.close(); } catch {} }
  const base = isFutures ? FUTURES_WS : SPOT_WS;
  let socket;
  try {
    socket = new WebSocket(`${base}/ws`); publicSocket = socket;
    socket.addEventListener('open', () => { if(socket!==publicSocket)return; socket.send(JSON.stringify({method:'SUBSCRIBE',params:publicStreams(),id:Date.now()})); market.connected=true; market.error=''; requestBroadcast(); });
    socket.addEventListener('message', (event) => { try { const payload=JSON.parse(wsText(event.data)); if (payload?.e) handleMarketEvent(payload); else if(Array.isArray(payload)) applyAllTickers(payload); } catch {} });
    socket.addEventListener('error', () => { if(socket!==publicSocket)return; market.error='Binance 실시간 시세 연결을 다시 시도합니다'; requestBroadcast(); });
    socket.addEventListener('close', () => { if(socket!==publicSocket)return; market.connected=false; requestBroadcast(); reconnectTimer=setTimeout(connectMarket,2500); });
  } catch { market.connected=false; reconnectTimer=setTimeout(connectMarket,2500); }
}
function applyAllTickers(rows) {
  const latest = new Map(rows.filter((row) => String(row.s || '').endsWith('USDT')).map((row) => [row.s, { price: num(row.c), changePct: num(row.P), quoteVolume: num(row.q) }]));
  if (!latest.size) return;
  for (const [symbol, values] of latest) recordCatalogTick(symbol, values.price, values.quoteVolume);
  marketCatalog = marketCatalog.length < 50 ? [...latest].map(([symbol, values]) => ({ symbol, ...values })).sort((a, b) => b.quoteVolume - a.quoteVolume) : marketCatalog.map((row) => latest.has(row.symbol) ? { ...row, ...latest.get(row.symbol) } : row).sort((a, b) => b.quoteVolume - a.quoteVolume);
  requestBroadcast();
}
function handleMarketEvent(data) {
  const type = data.e;
  if (type === '24hrTicker') applyTicker(data);
  if (type === 'depthUpdate' || data.lastUpdateId) {
    const bids = data.bids || data.b || [];
    const asks = data.asks || data.a || [];
    market.bids = bids.slice(0, 20).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
    market.asks = asks.slice(0, 20).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
    if (market.bids[0]) market.bid = market.bids[0].price;
    if (market.asks[0]) market.ask = market.asks[0].price;
  }
  if (type === 'aggTrade') pushTrade({ price: data.p, qty: data.q, buy: !data.m, time: data.T });
  if (type === 'kline' && data.k) mergeCandle({ t: data.k.t, o: data.k.o, h: data.k.h, l: data.k.l, c: data.k.c, v: data.k.v });
  if (type === 'markPriceUpdate') {
    market.markPrice = num(data.p); market.indexPrice = num(data.i); market.fundingRate = num(data.r) * 100; market.nextFundingTime = num(data.T); market.price = market.markPrice || market.price;
  }
  updatePrice({ price: data.c || data.p, bid: data.b, ask: data.a });
}

const autoState = { cooldownUntil: 0, selecting: false, initialCandidateSelected: false };
const catalogHistory = new Map();
function paperEvent(message) { paper.events ||= []; paper.events.unshift({ time: Date.now(), message }); paper.events = paper.events.slice(0, 80); }
function recordCatalogTick(symbol, price, quoteVolume) { if (!symbol || !price || !Number.isFinite(price)) return; const now=Date.now(); const h=catalogHistory.get(symbol)||[]; if(!h.length||now-h[h.length-1].t>=180){h.push({t:now,p:price,q:quoteVolume||0});}else{h[h.length-1]={t:now,p:price,q:quoteVolume||0};} while(h.length&&h[0].t<now-35_000)h.shift(); catalogHistory.set(symbol,h); }
function flowMetrics(symbol) { const h=catalogHistory.get(symbol)||[]; if(h.length<3)return null; const now=Date.now(); const last=h[h.length-1]; const before30=[...h].reverse().find(x=>x.t<=now-28_000)||null; const before10=[...h].reverse().find(x=>x.t<=now-9_000)||null; if(!before30||!before10)return null; const rise30=(last.p/before30.p-1)*100; const vol10=Math.max(0,last.q-before10.q); const vol30=Math.max(0,last.q-before30.q); const n10=h.filter(x=>x.t>=now-10_000).length; const n30=h.filter(x=>x.t>=now-30_000).length; const activity=vol30>0?(vol10*3/vol30):(n30? n10*3/n30 : 0); const peak=Math.max(...h.map(x=>x.p)); const pullback=(peak-last.p)/peak*100; return {rise30,activity,vol10,pullback}; }
function activePaperSubstitute() { const slot=activeSlot(); const ids=new Set(slot?.enabledRuleIds||[]); return ['듀퐁-가격속도','듀퐁-거래집중','듀퐁-호가압력','듀퐁-비용제한','듀퐁-고점차단','듀퐁-수익보호','듀퐁-반대장악청산','듀퐁-손절주의','듀퐁-손절확인','듀퐁-손절회복','듀퐁-비상손절'].every(id=>ids.has(id)); }
function orderbookBuyLead() { const bid=market.bids.reduce((sum,x)=>sum+num(x.qty),0); const ask=market.asks.reduce((sum,x)=>sum+num(x.qty),0); return ask>0?(bid/ask-1)*100:0; }
function spreadPct() { if(!market.bid||!market.ask||!market.price)return Infinity; return (market.ask-market.bid)/market.price*100; }
function recentPeakPullback() { const highs=market.candles.slice(-5).map(x=>num(x.h)).filter(Boolean); if(!highs.length||!market.price)return Infinity; const peak=Math.max(...highs); return (peak-market.price)/peak*100; }
function closePaperFraction(fraction, reason) { const view=paperPositionView(); if(!view)return false; const f=Math.max(.01,Math.min(1,fraction)); const amount=view.marginKrw*f; const pnl=view.pnlKrw*f; paper.availableKrw+=amount+pnl; paper.realizedKrw+=pnl; const position=paper.position; position.marginKrw-=amount; position.qty-=view.qty*f; recordPaperTrade(f>=.999?(isFutures?'PAPER 포지션 정리':'PAPER 매도'):'PAPER 분할 익절',reason,amount+pnl,pnl); if(f>=.999||position.qty<=1e-12)paper.position=null; savePaper(); paperEvent(`${market.symbol} ${reason} · ${Math.round(pnl).toLocaleString('ko-KR')}원`); return true; }
async function selectFullMarketCandidate() { if(autoState.selecting||paper.position||!activePaperSubstitute()||Date.now()<autoState.cooldownUntil)return; const candidate=marketCatalog.map(row=>({row,flow:flowMetrics(row.symbol),book:bookStats(row.symbol)})).filter(x=>x.row.symbol!==market.symbol&&x.flow&&x.flow.rise30>=.01&&x.flow.activity>=1.1&&x.flow.pullback<=.12&&(!isFutures||!!x.book&&x.book.lead>=5&&x.book.spread<=.07)).sort((a,b)=>(b.flow.rise30*b.row.quoteVolume)-(a.flow.rise30*a.row.quoteVolume))[0]; if(!candidate)return; autoState.selecting=true; autoState.cooldownUntil=Date.now()+1_500; try { market.symbol=candidate.row.symbol; config.symbol=market.symbol; saveConfig(); await seedMarket(); connectMarket(); autoState.initialCandidateSelected=true; paperEvent(`${market.symbol} 전수 감시 후보 선택 · 30초 상승 ${candidate.flow.rise30.toFixed(3)}%`); if(config.autoTrading&&config.mode==='paper'&&!paper.position&&market.price&&market.usdKrw){ const order=paperOrder({action:'buy',amountKrw:config.paperOrderKrw}); if(order.ok){ paper.position.auto={protected:false,peak:market.price}; autoState.cooldownUntil=Date.now()+60_000; paperEvent(`${market.symbol} PAPER 대체형 3조건 자동 매수 · 전수 후보 확정`); } } } finally { autoState.selecting=false; } }
function autoEvaluate() { autoState.lastTick=Date.now(); try { if(!config.autoTrading||config.mode!=='paper'||!market.price||!market.usdKrw||!activePaperSubstitute())return; const position=paper.position; const view=paperPositionView(); if(position&&view){ position.auto ||= {}; const st=position.auto; if(view.pnlPct>=.3){st.protected=true;st.peak=Math.max(num(st.peak),market.price);} if(st.protected){st.peak=Math.max(num(st.peak),market.price);if((st.peak-market.price)/st.peak*100>=.15){closePaperFraction(1,'반대 강세 대리 청산');autoState.cooldownUntil=Date.now()+60_000;return;}} if(view.pnlPct<=-.25){st.dangerAt ||= Date.now();if(view.pnlPct>=-.19)delete st.dangerAt;else if(view.pnlPct<=-.4||Date.now()-st.dangerAt>=3_000){closePaperFraction(1,'손절 주의 확인 후 비상 손절');autoState.cooldownUntil=Date.now()+60_000;}} return; } if(!autoState.initialCandidateSelected||Date.now()<autoState.cooldownUntil||(isFutures&&market.candles.length<20))return; const flow=flowMetrics(market.symbol); if(!flow)return; const threeConditions=flow.rise30>=.01&&flow.activity>=1.1&&(isFutures?recentPeakPullback():flow.pullback)<=.12; const futuresExecutionOk=!isFutures||(orderbookBuyLead()>=5&&spreadPct()<=.07); if(!threeConditions||!futuresExecutionOk)return; const result=paperOrder({action:'buy',amountKrw:config.paperOrderKrw}); if(result.ok){paper.position.auto={protected:false,peak:market.price};autoState.cooldownUntil=Date.now()+60_000;paperEvent(`${market.symbol} PAPER 대체형 3조건 자동 매수 · 30초 상승 ${flow.rise30.toFixed(3)}%`);} } catch(error){paperEvent(`자동매매 판단 대기 · ${error instanceof Error?error.message:'확인 필요'}`);} }
function paperPositionView() {
  const position = paper.position;
  if (!position) return null;
  const catalogPrice = num(marketCatalog.find((row) => row.symbol === position.symbol)?.price);
  const markPrice = catalogPrice || (position.symbol === market.symbol ? num(market.price) : 0);
  if (!markPrice) return null;
  const markKrw = krw(markPrice);
  const sign = position.side === 'SHORT' ? -1 : 1;
  const pnlKrw = (markKrw - position.entryKrw) * position.qty * sign;
  return { ...position, markKrw, pnlKrw, pnlPct: position.marginKrw ? pnlKrw / position.marginKrw * 100 : 0 };
}
function paperAccountView() {
  const position = paperPositionView();
  const totalKrw = paper.availableKrw + (position ? position.marginKrw + position.pnlKrw : 0);
  return { source: 'PAPER', initialKrw: paper.initialKrw, availableKrw: paper.availableKrw, totalKrw, realizedKrw: paper.realizedKrw, position, balances: [], positions: position ? [position] : [], orders: paper.orders.slice(0, 40), trades: paper.trades.slice(0, 80), events: paper.events || [] };
}
function recordPaperTrade(type, detail, amountKrw, pnlKrw = null) {
  paper.trades.unshift({ id: crypto.randomUUID(), time: Date.now(), type, detail, amountKrw, pnlKrw, source: 'PAPER' });
  paper.trades = paper.trades.slice(0, 120);
}
function paperOrder(body) {
  const action = String(body.action || '').toLowerCase();
  const amountKrw = Math.max(10_000, Math.floor(num(body.amountKrw, config.paperOrderKrw)));
  if (action === 'reset') {
    const initialKrw = Math.max(10_000, Math.floor(num(body.initialKrw, config.paperInitialKrw)));
    config.paperInitialKrw = initialKrw; config.paperOrderKrw = Math.min(Math.max(10_000, amountKrw), initialKrw); saveConfig();
    paper = defaultPaper(initialKrw); savePaper();
    return { ok: true, message: `${initialKrw.toLocaleString('ko-KR')}원 PAPER 계좌를 완전히 초기화했습니다` };
  }
  if (!market.price || !market.usdKrw) throw new Error('실시간 Binance 시세와 환율을 받은 뒤 주문할 수 있습니다');
  const position = paperPositionView();
  if (action === 'close') {
    if (!position) throw new Error('정리할 PAPER 보유분이 없습니다');
    paper.availableKrw += position.marginKrw + position.pnlKrw;
    paper.realizedKrw += position.pnlKrw;
    recordPaperTrade(isFutures ? 'PAPER 포지션 정리' : 'PAPER 매도', `${market.symbol} 보유분 정리`, position.marginKrw + position.pnlKrw, position.pnlKrw);
    paper.position = null; savePaper(); return { ok: true, message: 'PAPER 보유분을 정리했습니다' };
  }
  if (position) throw new Error('현재 PAPER 보유분이 있습니다. 먼저 정리 후 새 주문을 넣으세요');
  if (amountKrw > paper.availableKrw) throw new Error('PAPER 주문가능 원화가 부족합니다');
  const side = action === 'short' && isFutures ? 'SHORT' : 'LONG';
  const leverage = isFutures ? Math.max(1, Math.min(125, Math.floor(num(body.leverage, config.futuresLeverage)))) : 1;
  const notionalKrw = amountKrw * leverage;
  const qty = notionalKrw / krw(market.price);
  paper.availableKrw -= amountKrw;
  paper.position = { symbol: market.symbol, side, qty, entryKrw: krw(market.price), marginKrw: amountKrw, leverage, openedAt: Date.now() };
  recordPaperTrade(side === 'SHORT' ? 'PAPER 숏 진입' : 'PAPER 매수', `${market.symbol} · ${leverage}배`, amountKrw);
  savePaper();
  return { ok: true, message: `${side === 'SHORT' ? 'PAPER 숏' : 'PAPER 매수'} 주문을 기록했습니다` };
}

function addLiveEvent(event) {
  liveAccount.events.unshift({ time: Date.now(), event });
  liveAccount.events = liveAccount.events.slice(0, 60);
}
async function refreshLiveAccount() {
  if (!config.apiKey || !config.secretKey) {
    liveAccount = { configured: false, ready: false, refreshedAt: Date.now(), error: 'API Key와 Secret Key를 입력하면 실계좌를 표시합니다', balances: [], positions: [], orders: [], trades: [], events: liveAccount.events || [] };
    requestBroadcast(); return liveAccount;
  }
  try {
    if (isFutures) {
      const [account, orders] = await Promise.all([
        signedRequest('GET', FUTURES_REST, '/fapi/v2/account'),
        signedRequest('GET', FUTURES_REST, '/fapi/v1/openOrders'),
      ]);
      liveAccount = {
        configured: true, ready: true, refreshedAt: Date.now(), error: '', source: 'BINANCE LIVE',
        walletBalanceUsdt: num(account.totalWalletBalance), equityUsdt: num(account.totalMarginBalance), unrealizedUsdt: num(account.totalUnrealizedProfit),
        totalKrw: krw(account.totalMarginBalance), availableKrw: krw(account.availableBalance),
        balances: (account.assets || []).filter((asset) => num(asset.walletBalance) || num(asset.unrealizedProfit)).map((asset) => ({ asset: asset.asset, free: num(asset.availableBalance), total: num(asset.walletBalance), pnl: num(asset.unrealizedProfit) })),
        positions: (account.positions || []).filter((position) => num(position.positionAmt)).map((position) => ({ symbol: position.symbol, side: num(position.positionAmt) >= 0 ? 'LONG' : 'SHORT', qty: Math.abs(num(position.positionAmt)), entryPrice: num(position.entryPrice), markPrice: num(position.markPrice), pnlUsdt: num(position.unrealizedProfit), leverage: num(position.leverage) })),
        orders: (orders || []).slice(0, 80).map(normalizeLiveOrder), trades: liveAccount.trades || [], events: liveAccount.events || [],
      };
    } else {
      const [account, orders] = await Promise.all([
        signedRequest('GET', SPOT_REST, '/api/v3/account'),
        signedRequest('GET', SPOT_REST, '/api/v3/openOrders'),
      ]);
      const baseAsset = market.symbol.replace('USDT', '');
      const balances = (account.balances || []).filter((asset) => num(asset.free) || num(asset.locked)).map((asset) => ({ asset: asset.asset, free: num(asset.free), locked: num(asset.locked), total: num(asset.free) + num(asset.locked) }));
      const usdt = balances.find((asset) => asset.asset === 'USDT');
      const held = balances.find((asset) => asset.asset === baseAsset);
      const positionValue = held ? held.total * market.price : 0;
      liveAccount = {
        configured: true, ready: true, refreshedAt: Date.now(), error: '', source: 'BINANCE LIVE',
        totalKrw: krw((usdt?.total || 0) + positionValue), availableKrw: krw(usdt?.free || 0),
        balances,
        positions: held && held.total > 0 ? [{ symbol: market.symbol, side: 'LONG', qty: held.total, entryPrice: 0, markPrice: market.price, pnlUsdt: null, leverage: 1 }] : [],
        orders: (orders || []).slice(0, 80).map(normalizeLiveOrder), trades: liveAccount.trades || [], events: liveAccount.events || [],
      };
    }
  } catch (error) {
    liveAccount = { ...liveAccount, configured: true, ready: false, refreshedAt: Date.now(), error: `실계좌 조회 실패: ${error instanceof Error ? error.message : 'API 권한과 IP 제한을 확인하세요'}` };
  }
  requestBroadcast();
  return liveAccount;
}
function normalizeLiveOrder(order) {
  return { id: String(order.orderId || order.clientOrderId || ''), symbol: order.symbol, side: order.side, type: order.type, status: order.status, price: num(order.price), qty: num(order.origQty || order.origQuantity), updatedAt: num(order.updateTime || order.time) };
}
async function startPrivateStream() {
  await stopPrivateStream();
  if (!config.apiKey || !config.secretKey) return;
  try {
    const base = isFutures ? FUTURES_REST : SPOT_REST;
    const endpoint = isFutures ? '/fapi/v1/listenKey' : '/api/v3/userDataStream';
    const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'X-MBX-APIKEY': config.apiKey }, signal: AbortSignal.timeout(10_000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.listenKey) throw new Error(payload.msg || 'User Data Stream 시작 실패');
    privateListenKey = payload.listenKey;
    const url = `${isFutures ? FUTURES_WS : SPOT_WS}/ws/${privateListenKey}`;
    privateSocket = new WebSocket(url);
    privateSocket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data));
        const tag = isFutures ? data.e : data.e;
        if (['executionReport', 'ORDER_TRADE_UPDATE', 'ACCOUNT_UPDATE'].includes(tag)) {
          addLiveEvent({ kind: tag, message: formatUserEvent(data) });
          refreshLiveAccount();
        }
      } catch { /* malformed private event ignored */ }
    });
    privateSocket.addEventListener('close', () => { privateSocket = null; });
    privateKeepAlive = setInterval(async () => {
      try {
        await fetch(`${base}${endpoint}?listenKey=${encodeURIComponent(privateListenKey)}`, { method: isFutures ? 'PUT' : 'PUT', headers: { 'X-MBX-APIKEY': config.apiKey }, signal: AbortSignal.timeout(10_000) });
      } catch { /* next refresh reconnects */ }
    }, 25 * 60_000);
  } catch (error) {
    liveAccount = { ...liveAccount, error: `실시간 계좌 연결 실패: ${error instanceof Error ? error.message : 'API 권한을 확인하세요'}` };
    requestBroadcast();
  }
}
async function stopPrivateStream() {
  if (privateKeepAlive) clearInterval(privateKeepAlive);
  privateKeepAlive = null;
  if (privateSocket) { try { privateSocket.close(); } catch {} }
  privateSocket = null;
  privateListenKey = null;
}
function formatUserEvent(data) {
  if (data.e === 'executionReport') return `${data.s} ${data.S} · ${data.X}`;
  if (data.e === 'ORDER_TRADE_UPDATE') return `${data.o?.s || '-'} ${data.o?.S || '-'} · ${data.o?.X || '-'}`;
  if (data.e === 'ACCOUNT_UPDATE') return '선물 계좌·포지션 변경 수신';
  return '실계좌 이벤트 수신';
}
async function liveOrder(body) {
  if (!body.confirmLive) throw new Error('실계좌 주문 확인창에서 최종 확인해야 합니다');
  if (!config.apiKey || !config.secretKey) throw new Error('실계좌 주문 전 API Key와 Secret Key를 로컬 설정에 입력하세요');
  const side = String(body.action || '').toLowerCase();
  const type = String(body.orderType || 'market').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
  const amountKrw = Math.max(10_000, Math.floor(num(body.amountKrw, config.paperOrderKrw)));
  const quoteAmount = amountKrw / Math.max(market.usdKrw, 1);
  if (!market.price) throw new Error('실시간 시세를 받은 뒤 주문할 수 있습니다');
  if (!isFutures) {
    const isBuy = side === 'buy';
    const isSell = side === 'sell';
    if (!isBuy && !isSell) throw new Error('현물 주문 방향을 확인하세요');
    const params = { symbol: market.symbol, side: isBuy ? 'BUY' : 'SELL', type };
    if (isBuy && type === 'MARKET') params.quoteOrderQty = fixed(quoteAmount, 4);
    else {
      const price = type === 'LIMIT' ? num(body.limitPrice, market.price) : market.price;
      const qty = isSell ? Math.max(0, num(body.qty)) : quoteAmount / price;
      params.quantity = fixed(qty, 6); if (type === 'LIMIT') { params.price = fixed(price, 2); params.timeInForce = 'GTC'; }
    }
    const order = await signedRequest('POST', SPOT_REST, '/api/v3/order', params);
    addLiveEvent({ kind: 'ORDER_SENT', message: `${market.symbol} ${isBuy ? '매수' : '매도'} 주문 접수` });
    await refreshLiveAccount();
    return { live: true, order: normalizeLiveOrder(order) };
  }
  const action = side === 'short' ? 'SELL' : 'BUY';
  const closing = side === 'close';
  const leverage = Math.max(1, Math.min(125, Math.floor(num(body.leverage, config.futuresLeverage))));
  if (!closing) await signedRequest('POST', FUTURES_REST, '/fapi/v1/leverage', { symbol: market.symbol, leverage });
  const qty = Math.max(0.001, fixed((quoteAmount * leverage) / market.price, 3));
  const params = { symbol: market.symbol, side: closing ? String(body.closeSide || 'SELL').toUpperCase() : action, type, quantity: qty };
  if (closing) params.reduceOnly = 'true';
  if (type === 'LIMIT') { params.price = fixed(num(body.limitPrice, market.price), 2); params.timeInForce = 'GTC'; }
  const order = await signedRequest('POST', FUTURES_REST, '/fapi/v1/order', params);
  addLiveEvent({ kind: 'ORDER_SENT', message: `${market.symbol} ${params.side} 선물 주문 접수` });
  await refreshLiveAccount();
  return { live: true, order: normalizeLiveOrder(order) };
}

function accountView() { return config.mode === 'live' ? liveAccount : paperAccountView(); }

// BINANCE_UI_COMPAT_START
function uiCode(symbol) { return `USDT-${String(symbol || '').replace(/USDT$/, '')}`; }
function uiSymbol(code) { const base = String(code || '').replace(/^USDT-/, '').replace(/[^A-Z0-9]/g, ''); return base ? `${base}USDT` : market.symbol; }
function uiTicker(row) { const symbol = row.symbol || market.symbol; const price = krw(num(row.price, market.price)); const rate = num(row.changePct, market.changePct) / 100; return { cd: uiCode(symbol), tp: price, scr: rate, scp: price * rate, hp: symbol === market.symbol ? krw(market.high24h) : price, lp: symbol === market.symbol ? krw(market.low24h) : price, atv24h: symbol === market.symbol ? market.volumeBase : 0, atp24h: krw(num(row.quoteVolume, market.volumeQuote)) }; }
function uiPosition() { const p = paperPositionView(); return p ? { market: uiCode(p.symbol), qty: p.qty, avgPrice: p.entryKrw, mark: p.markKrw, cost: p.marginKrw, value: p.marginKrw + p.pnlKrw, netPnl: p.pnlKrw, netPct: p.pnlPct, heldSec: Math.floor((Date.now() - p.openedAt) / 1000) } : null; }
function uiConfig() { return { mode: config.mode, autoTrading: config.autoTrading, markets: config.watchMarkets || [], slots: { activeId: config.activeSlot, items: config.slots.items }, slotVersions: clone(config.slotVersions || {}), paper: { initialKrw: config.paperInitialKrw, feePct: 0, slippagePct: 0 }, trade: { orderMode: config.paperOrderMode || 'fixed', orderKrw: config.paperOrderKrw, orderPct: config.paperOrderPct ?? 10, maxPositions: config.maxPositions ?? 1, hardStopLossPct: 0 }, alerts: { voiceEnabled: false, voiceVolume: 0.7 }, screener: { enabled: true, candidates: marketCatalog.length, refreshSec: 3 }, strategyExport: { ready: true }, cost: { usdKrw: market.usdKrw || 1350 } }; }
function uiSnapshot() { const account = paperAccountView(); const pos = uiPosition(); const equity = account.totalKrw; const pnl = equity - account.initialKrw; const markets = marketCatalog.map((x) => ({ code: uiCode(x.symbol), ko: x.symbol.replace(/USDT$/, ''), en: x.symbol.replace(/USDT$/, ''), warning: false })); const tickers = marketCatalog.map(uiTicker); const selected = uiCode(market.symbol); const watch = markets.map((item, i) => ({ market: item.code, watched: true, warm: true, price: tickers.find((t) => t.cd === item.code)?.tp || 0, position: pos?.market === item.code ? pos : null, bidShare15: .5, last: { kind: 'watch', reason: 'Binance full-market monitoring' }, entryEvidence: { rules: [] }, rank: i + 1 })); return { markets, tickers, config: uiConfig(), summary: { equity, initialKrw: account.initialKrw, krw: account.availableKrw, totalPnl: pnl, totalPnlPct: account.initialKrw ? pnl / account.initialKrw * 100 : 0, realizedPnl: account.realizedKrw, feesPaid: 0, trades: account.trades.length, wins: 0, losses: 0, winRate: null, avgHoldSec: pos?.heldSec || 0, positions: pos ? [pos] : [], inflight: [], activeSlot: { id: config.activeSlot, name: activeSlot()?.name || `${config.activeSlot} slot`, rules: 0 }, effectiveDecisionMode: 'rule', jev: { label: 'Binance rule', totalCalls: 0, totalErrors: 0, totalCostUsd: 0, tokens: 0 }, startedAt: account.updatedAt, maxDrawdownPct: 0 }, watch, trades: account.trades.map((t) => ({ id: t.id, t: t.time, market: selected, side: /sell|close|정리|매도/i.test(t.type) ? 'sell' : 'buy', price: krw(market.price), qty: pos?.qty || 0, gross: t.amountKrw, fee: 0, net: t.amountKrw, pnl: t.pnlKrw, reason: t.detail, reasonKo: t.type, slot: { id: config.activeSlot, name: activeSlot()?.name || '' } })), decisions: [], equity: [[account.updatedAt, equity]], logs: [...(paper.events || []).map((x)=>({t:x.time,level:'info',msg:x.message})), { t: Date.now(), level: 'info', msg: 'Binance 실시간 시세 수신' }], ob: { cd: selected, ask: market.asks.map((x) => ({ p: krw(x.price), s: x.qty })), bid: market.bids.map((x) => ({ p: krw(x.price), s: x.qty })), tas: 0, tbs: 0 }, status: { binance: market.connected, lastBinanceLatency: market.lastMessageAt ? Date.now() - market.lastMessageAt : null }, screener: { enabled: true, rows: watch.map((x, i) => ({ code: x.market, rank: i + 1, delta: 0, score: 0 })) }, monitor: { current: { markets: marketCatalog.length, latency: market.lastMessageAt ? Date.now() - market.lastMessageAt : null } } }; }
// BINANCE_UI_COMPAT_END

function snapshot(includeMarkets = true) {
  const account = accountView();
  const priceKrw = krw(market.price);
  return {
    ok: true, kind, version: '2.0.0', localServer: true, paperOnly: false, server: { host: 'BLACK PC', port, at: Date.now() },
    config: publicConfig(),
    market: { ...market, priceKrw, bidKrw: krw(market.bid), askKrw: krw(market.ask), markKrw: krw(market.markPrice), indexKrw: krw(market.indexPrice) },
    account,
    ...(includeMarkets ? { markets: marketCatalog } : {}),
  };
}
function requestBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const snap = uiSnapshot();
    const tickLine = `event: tk\ndata: ${JSON.stringify(snap.tickers.map((t) => [t.cd, t.tp, t.scr, t.atp24h, t.scp]))}\n\n`;
    const view = snap.tickers.find((t) => t.cd === uiCode(market.symbol));
    const viewLine = view ? `event: vt\ndata: ${JSON.stringify(view)}\n\n` : '';
    const obLine = `event: ob\ndata: ${JSON.stringify(snap.ob)}\n\n`;
    const sumLine = `event: sum\ndata: ${JSON.stringify({ summary: snap.summary, watch: snap.watch, status: snap.status, monitor: snap.monitor })}\n\n`;
    for (const client of clients) { try { client.write(tickLine + viewLine + obLine + sumLine); } catch { clients.delete(client); } }
  }, 500);
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function readBody(req) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 1_000_000) throw new Error('요청이 너무 큽니다'); } try { return JSON.parse(text || '{}'); } catch { throw new Error('JSON 형식이 아닙니다'); } }
function staticFile(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, uiSnapshot());
    if (req.method === 'GET' && url.pathname === '/api/candles') return json(res, 200, market.candles.map((x) => ({ t: x.t, o: krw(x.o), h: krw(x.h), l: krw(x.l), c: krw(x.c), v: x.v })));
    if (req.method === 'GET' && url.pathname === '/api/ticks') return json(res, 200, market.trades.map((x) => ({ trade_price: krw(x.price), trade_volume: x.qty, ask_bid: x.buy ? 'BID' : 'ASK', timestamp: x.time })));
    if (req.method === 'GET' && url.pathname === '/api/days') return json(res, 200, []);
    if (req.method === 'GET' && url.pathname === '/api/auth') return json(res, 200, { required: false, ok: true });
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, kind, port, websocket: market.connected, marketAt: market.lastMessageAt, mode: config.mode, liveReady: liveAccount.ready });
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      res.write(`event: init\ndata: ${JSON.stringify(uiSnapshot())}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/view') { const body = await readBody(req); const symbol = paper.position?.symbol || uiSymbol(body.market); if (safeSymbol(symbol)) { market.symbol = symbol; config.symbol = symbol; saveConfig(); await seedMarket(); connectMarket(); } const ui = uiSnapshot(); return json(res, 200, { ticker: ui.tickers.find((x) => x.cd === uiCode(symbol)), ob: ui.ob }); }
    if (req.method === 'POST' && url.pathname === '/api/select') {
      const body = await readBody(req); const requested = safeSymbol(body.symbol); if (!requested) throw new Error('지원하지 않는 USDT 마켓입니다');
      const symbol = paper.position?.symbol || requested;
      market.symbol = symbol; config.symbol = symbol; saveConfig(); await seedMarket(); connectMarket(); return json(res, 200, snapshot());
    }
    if (req.method === 'POST' && url.pathname === '/api/interval') {
      const body = await readBody(req); const interval = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(body.interval) ? body.interval : null; if (!interval) throw new Error('지원하지 않는 차트 시간입니다');
      market.interval = interval; config.interval = interval; saveConfig(); await seedMarket(); connectMarket(); return json(res, 200, snapshot());
    }
    if (req.method === 'GET' && url.pathname === '/api/slots') {
      return json(res, 200, { ok: true, activeId: config.activeSlot, items: config.slots.items });
    }
    if (req.method === 'POST' && url.pathname === '/api/slot-versions/add') { const body=await readBody(req); const slotId=Math.max(1,Math.min(SLOT_COUNT,Math.floor(num(body.slotId,1)))); let definition; try { definition=typeof body.content==='string'?JSON.parse(body.content):body.definition; } catch { throw new Error('전략 파일 형식이 아닙니다'); } if(!definition?.슬롯이름) throw new Error('전략 이름이 없는 파일입니다'); const v=addSlotVersion(slotId,definition,body.fileName,body.name); saveConfig(); return json(res,200,{ok:true,version:v,config:publicConfig()}); }
    if (req.method === 'POST' && url.pathname === '/api/slot-versions/apply') { const body=await readBody(req); const v=applySlotVersion(Number(body.slotId),String(body.versionId)); saveConfig(); requestBroadcast(); return json(res,200,{ok:true,version:v,config:publicConfig()}); }
    if (req.method === 'POST' && url.pathname === '/api/slot-versions/clone') { const body=await readBody(req); const book=versionBook(Number(body.slotId)); const from=book.items.find((v)=>v.id===body.versionId); if(!from) throw new Error('복사할 전략 버전을 찾지 못했습니다'); const v=addSlotVersion(Number(body.slotId),from.definition,from.fileName,`${from.name} 복사`); saveConfig(); return json(res,200,{ok:true,version:v,config:publicConfig()}); }
    if (req.method === 'POST' && url.pathname === '/api/slot-versions/delete') { const body=await readBody(req); const book=versionBook(Number(body.slotId)); if(book.activeVersionId===body.versionId) throw new Error('적용 중인 버전은 다른 버전을 적용한 뒤 삭제하세요'); const i=book.items.findIndex((v)=>v.id===body.versionId); if(i<0) throw new Error('삭제할 전략 버전을 찾지 못했습니다'); book.items.splice(i,1); saveConfig(); return json(res,200,{ok:true,config:publicConfig()}); }
    if (req.method === 'POST' && url.pathname === '/api/slots/apply') {
      const body = await readBody(req);
      const slot = activateSlot(body.slotId);
      saveConfig();
      requestBroadcast();
      return json(res, 200, { ok: true, message: `${slot.name} 적용 · 주문금액 ${slotOrder(slot).amountKrw.toLocaleString('ko-KR')}원`, config: publicConfig() });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req);
      if (body.mode && !['paper', 'live'].includes(body.mode)) throw new Error('투자 모드는 PAPER 또는 LIVE만 가능합니다');
      const requestedSlotId = body.activeSlot === undefined ? config.activeSlot : Math.max(1, Math.min(SLOT_COUNT, Math.floor(num(body.activeSlot, config.activeSlot))));
      const requestedSlot = config.slots.items.find((slot) => slot.id === requestedSlotId);
      const requestedMode = body.mode || config.mode;
      const requiredMode = requestedMode === 'live' ? '실전투자' : '모의투자';
      if (!requestedSlot?.definition?.사용가능모드?.includes(requiredMode)) throw new Error(`${requestedSlot?.name || `${requestedSlotId}번 슬롯`}은 ${requiredMode}에서 사용할 수 없습니다`);
      if (body.mode) config.mode = body.mode;
      if (body.paperInitialKrw !== undefined) config.paperInitialKrw = Math.max(10_000, Math.floor(num(body.paperInitialKrw, config.paperInitialKrw)));
      if (body.paperOrderKrw !== undefined) config.paperOrderKrw = Math.max(10_000, Math.floor(num(body.paperOrderKrw, config.paperOrderKrw)));
      if (body.paperOrderMode !== undefined) config.paperOrderMode = body.paperOrderMode === 'percent' ? 'percent' : 'fixed';
      if (body.paperOrderPct !== undefined) config.paperOrderPct = Math.max(0, Math.min(100, num(body.paperOrderPct, config.paperOrderPct ?? 10)));
      if (body.maxPositions !== undefined) config.maxPositions = Math.max(1, Math.min(20, Math.floor(num(body.maxPositions, config.maxPositions ?? 1))));
      if (body.futuresLeverage !== undefined) config.futuresLeverage = Math.max(1, Math.min(125, Math.floor(num(body.futuresLeverage, config.futuresLeverage))));
      if (body.autoTrading !== undefined) config.autoTrading = Boolean(body.autoTrading);
      if (body.activeSlot !== undefined) activateSlot(body.activeSlot);
      const updatingKeys = body.apiKey !== undefined || body.secretKey !== undefined;
      if (body.apiKey !== undefined) config.apiKey = String(body.apiKey || '').trim();
      if (body.secretKey !== undefined) config.secretKey = String(body.secretKey || '').trim();
      saveConfig();
      if (updatingKeys) { await refreshLiveAccount(); await startPrivateStream(); }
      requestBroadcast(); return json(res, 200, { ok: true, config: { ...publicConfig(), ...uiConfig() } });
    }
    if (req.method === 'GET' && url.pathname === '/api/debug/auto') {
      const flow=flowMetrics(market.symbol);
      return json(res, 200, { now: Date.now(), kind, autoState: { ...autoState, cooldownRemainingMs: Math.max(0, autoState.cooldownUntil-Date.now()) }, config: { autoTrading: config.autoTrading, mode: config.mode, activeSlot: config.activeSlot }, market: { symbol: market.symbol, price: market.price, usdKrw: market.usdKrw, connected: market.connected, candles: market.candles?.length||0 }, activePaperSubstitute: activePaperSubstitute(), flow, threeConditions: !!flow && flow.rise30>=.01 && flow.activity>=1.1 && (isFutures ? recentPeakPullback() : flow.pullback)<=.12, futuresExecutionOk: !isFutures || (orderbookBuyLead()>=5&&spreadPct()<=.07), position: !!paper.position });
    }
    if (req.method === 'POST' && url.pathname === '/api/order') {
      const body = await readBody(req);
      const result = config.mode === 'live' ? await liveOrder(body) : paperOrder(body);
      requestBroadcast(); return json(res, 200, { ok: true, ...result, state: snapshot() });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const body = await readBody(req); const result = paperOrder({ action: 'reset', initialKrw: body.initialKrw, amountKrw: body.orderKrw }); const ui = uiSnapshot(); requestBroadcast(); return json(res, 200, { ...result, initialKrw: config.paperInitialKrw, summary: ui.summary, config: ui.config });
    }
    if (req.method === 'POST' && url.pathname === '/api/live/refresh') { await refreshLiveAccount(); return json(res, 200, snapshot()); }
    if (req.method === 'GET') return staticFile(req, res, url.pathname);
    return json(res, 404, { error: '요청 경로를 찾지 못했습니다' });
  } catch (error) {
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다' });
  }
});

await refreshMarketCatalog();
if (paper.position?.symbol) { market.symbol = paper.position.symbol; config.symbol = market.symbol; saveConfig(); }
await seedMarket();
connectMarket();
setInterval(autoEvaluate, 1_000).unref();
setInterval(() => { selectFullMarketCandidate().catch(() => {}); }, 2_000).unref();
setInterval(() => { seedMarket(); }, 12 * 60_000).unref();
setInterval(() => { refreshMarketCatalog(); }, 10 * 60_000).unref();
setInterval(() => { if (config.mode === 'live' && config.apiKey && config.secretKey) refreshLiveAccount(); }, 45_000).unref();
server.listen(port, '127.0.0.1', () => console.log(`[${new Date().toISOString()}] Binance ${kind} terminal v2 listening at 127.0.0.1:${port}`));
process.on('SIGTERM', async () => { await stopPrivateStream(); server.close(() => process.exit(0)); });
