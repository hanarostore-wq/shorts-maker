const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let state = null;
let selectedAction = 'buy';
let selectedOrderType = 'market';
let pendingMode = 'paper';
let chartCount = 110;
let toastTimer = null;

const won = (value, digits = 0) => `${Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: digits })}원`;
const usd = (value, digits = 2) => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits })}`;
const pct = (value) => `${Number(value || 0) >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const compact = (value) => {
  const n = Number(value || 0); if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}조`; if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억`; if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(1)}만`; return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
};
const inputNumber = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const niceSymbol = (symbol) => symbol ? `${symbol.replace('USDT', '')}/USDT` : '-';
const elText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
function toast(message, error = false) { const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3600); }
async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || '요청을 처리하지 못했습니다');
  if (payload.state) update(payload.state);
  return payload;
}
async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || '요청을 처리하지 못했습니다');
  return payload;
}
function currentAccount() { return state?.account || {}; }
function isFutures() { return state?.kind === 'futures'; }
function isLive() { return state?.config?.mode === 'live'; }
function baseAsset() { return String(state?.market?.symbol || '').replace('USDT', ''); }
function currentPosition() { return currentAccount().position || currentAccount().positions?.[0] || null; }

function update(next) { state = { ...(state || {}), ...next, markets: next.markets || state?.markets || [] }; render(); }
function render() {
  if (!state) return;
  const m = state.market; const a = currentAccount(); const c = state.config;
  $('#app').classList.toggle('futures', isFutures());
  elText('#terminalTitle', isFutures() ? 'USDⓈ-M 선물' : '현물');
  elText('#marketType', isFutures() ? 'USDⓈ-M 선물' : '현물');
  elText('#symbolText', niceSymbol(m.symbol)); elText('#chartSymbol', m.symbol);
  const priceKrw = m.priceKrw || 0; const direction = Number(m.changePct || 0) >= 0 ? 'up' : 'down';
  const price = $('#lastPrice'); price.textContent = won(priceKrw); price.className = direction;
  elText('#lastPriceUsd', usd(m.price, 2)); const change = $('#changePct'); change.textContent = pct(m.changePct); change.className = direction;
  elText('#high24', `${usd(m.high24h)} · ${won(m.high24h * m.usdKrw)}`); elText('#low24', `${usd(m.low24h)} · ${won(m.low24h * m.usdKrw)}`); elText('#volume24', `${compact(m.volumeQuote * m.usdKrw)}원`);
  elText('#fundingRate', `${Number(m.fundingRate || 0).toFixed(4)}%`); elText('#openInterest', `${compact(m.openInterest)} BTC`);
  const age = m.lastMessageAt ? Math.max(0, Date.now() - m.lastMessageAt) : null; elText('#receiveGap', age == null ? '대기' : `${age}ms`);
  const connection = $('#connection'); connection.textContent = m.connected ? `● 시세 수신 정상 · ${age}ms` : '● 시세 연결 중'; connection.classList.toggle('live', Boolean(m.connected));
  const chip = $('#modeChip'); chip.textContent = isLive() ? 'LIVE 실계좌' : 'PAPER 모의계좌'; chip.classList.toggle('live', isLive());
  renderChart(m); renderMarkets(); renderBook(m); renderTrades(m); renderWorkspace(); renderOrderPanel();
  const latest = (m.candles || []).at(-1) || {}; elText('#candleOpen', usd(latest.o)); elText('#candleHigh', usd(latest.h)); elText('#candleLow', usd(latest.l)); elText('#candleClose', usd(latest.c)); elText('#candleVolume', compact(latest.v)); elText('#chartUpdated', m.lastMessageAt ? `마지막 수신 ${new Date(m.lastMessageAt).toLocaleTimeString('ko-KR')}` : '연결 대기');
  $('#chartEmpty').style.display = (m.candles || []).length ? 'none' : 'block';
  $('#orderAmount').value = $('#orderAmount').value || Number(c.paperOrderKrw || 0);
}
function renderMarkets() {
  const m = state.market; const list = $('#marketList');
  const term = String($('#marketSearch').value || '').toUpperCase();
  const items = (state.markets || []).filter((item) => String(item.symbol || item).includes(term));
  list.innerHTML = items.map((item) => {
    const entry = typeof item === 'string' ? { symbol: item } : item;
    const symbol = entry.symbol; const selected = symbol === m.symbol;
    const price = selected ? won(m.priceKrw) : (entry.price ? usd(entry.price, entry.price < 1 ? 6 : 2) : '시세 수신 중');
    const changeValue = selected ? Number(m.changePct) : Number(entry.changePct || 0);
    return `<button class="market-row ${selected ? 'active' : ''}" data-symbol="${symbol}"><span><b>${escape(niceSymbol(symbol))}</b><small>${symbol}</small></span><span class="price">${price}</span><span class="${changeValue < 0 ? 'down' : 'up'}">${pct(changeValue)}</span></button>`;
  }).join('') || '<div class="empty-row">찾는 마켓이 없습니다</div>';
  $$('.market-row[data-symbol]').forEach((button) => button.addEventListener('click', async () => { try { await api('/api/select', { symbol: button.dataset.symbol }); toast(`${niceSymbol(button.dataset.symbol)} 실시간 화면으로 전환했습니다`); } catch (error) { toast(error.message, true); } }));
}
function drawCandles(canvas, candles) {
  const rect = canvas.getBoundingClientRect(); const ratio = Math.max(1, window.devicePixelRatio || 1); const width = Math.max(1, Math.floor(rect.width * ratio)); const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); const w = rect.width; const h = rect.height; ctx.clearRect(0, 0, w, h);
  const rows = candles.slice(-chartCount); if (!rows.length) return;
  const min = Math.min(...rows.map((row) => Number(row.l))); const max = Math.max(...rows.map((row) => Number(row.h))); const range = Math.max(0.0000001, max - min); const top = 22; const bottom = h - 28; const bodyW = Math.max(2, w / rows.length * .58); const xStep = w / rows.length; const y = (value) => bottom - (Number(value) - min) / range * (bottom - top);
  ctx.font = '10px ui-sans-serif'; ctx.textAlign = 'left'; ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { const yy = top + (bottom - top) * i / 4; const value = max - range * i / 4; ctx.strokeStyle = 'rgba(132,142,156,.14)'; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke(); ctx.fillStyle = '#8b949f'; ctx.fillText(usd(value, 2), 7, yy - 4); }
  rows.forEach((row, index) => { const x = index * xStep + xStep / 2; const up = Number(row.c) >= Number(row.o); const color = up ? '#0ecb81' : '#f6465d'; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y(row.h)); ctx.lineTo(x, y(row.l)); ctx.stroke(); const start = y(row.o); const end = y(row.c); ctx.fillRect(x - bodyW / 2, Math.min(start, end), bodyW, Math.max(1, Math.abs(end - start))); });
  const last = rows.at(-1); const yy = y(last.c); ctx.strokeStyle = last.c >= last.o ? 'rgba(14,203,129,.7)' : 'rgba(246,70,93,.7)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = last.c >= last.o ? '#0ecb81' : '#f6465d'; ctx.fillRect(w - 80, yy - 10, 78, 20); ctx.fillStyle = '#0b0e11'; ctx.textAlign = 'center'; ctx.fillText(usd(last.c, 2), w - 41, yy + 4);
}
function renderChart(m) { drawCandles($('#priceChart'), m.candles || []); }
function renderBook(m) {
  const asks = (m.asks || []).slice(0, 10).reverse(); const bids = (m.bids || []).slice(0, 10); const total = Math.max(1, ...asks.concat(bids).map((row) => row.qty));
  const rows = (items) => items.map((row) => `<div class="book-row" style="--depth:${Math.min(100, row.qty / total * 100)}%"><span>${Number(row.price).toFixed(2)}</span><span>${compact(row.qty)}</span><span>${compact(row.price * row.qty)}</span></div>`).join('');
  $('#asks').innerHTML = rows(asks); $('#bids').innerHTML = rows(bids);
  elText('#spreadPrice', usd(m.price, 2)); elText('#spreadKrw', won(m.priceKrw)); const spread = m.ask && m.bid ? (m.ask / m.bid - 1) * 100 : 0; elText('#spreadPct', `차이 ${spread.toFixed(3)}%`);
  const b = bids.reduce((sum, row) => sum + row.qty, 0); const a = asks.reduce((sum, row) => sum + row.qty, 0); elText('#bidPower', `${b / Math.max(1, a + b) * 100 | 0}%`); elText('#askPower', `${a / Math.max(1, a + b) * 100 | 0}%`);
}
function renderTrades(m) { $('#recentTrades').innerHTML = (m.trades || []).slice(0, 12).map((trade) => `<div class="recent-row ${trade.buy ? 'buy' : 'sell'}"><span>${Number(trade.price).toFixed(2)}</span><span>${compact(trade.qty)}</span><span>${new Date(trade.time).toLocaleTimeString('ko-KR', { hour12: false })}</span></div>`).join('') || '<div class="empty-row">체결 수신 중</div>'; }
function workspaceRows(tab) {
  const a = currentAccount(); const position = currentPosition(); const m = state.market;
  if (tab === 'positions') {
    const rows = a.positions?.length ? a.positions.map((p) => `<tr><td>${escape(p.symbol || m.symbol)}</td><td class="${p.side === 'SHORT' ? 'down' : 'up'}">${p.side === 'SHORT' ? '숏' : '롱/현물'}</td><td>${Number(p.qty || 0).toFixed(6)}</td><td>${p.entryKrw ? won(p.entryKrw) : usd(p.entryPrice)}</td><td>${p.markKrw ? won(p.markKrw) : usd(p.markPrice || m.price)}</td><td class="${Number(p.pnlKrw ?? p.pnlUsdt ?? 0) >= 0 ? 'up' : 'down'}">${p.pnlKrw != null ? won(p.pnlKrw) : usd(p.pnlUsdt)}</td><td>${p.leverage || 1}배</td></tr>`).join('') : '';
    return table(['마켓', '방향', '수량', '진입가', '현재가', '손익', '배수'], rows, '현재 보유 중인 포지션이 없습니다');
  }
  if (tab === 'openOrders') { const rows = (a.orders || []).map((o) => `<tr><td>${escape(o.symbol || '-')}</td><td>${escape(o.side || '-')}</td><td>${escape(o.type || '-')}</td><td>${usd(o.price)}</td><td>${Number(o.qty || 0).toFixed(6)}</td><td>${escape(o.status || '대기')}</td></tr>`).join(''); return table(['마켓', '방향', '유형', '가격', '수량', '상태'], rows, '현재 미체결 주문이 없습니다'); }
  if (tab === 'history') { const rows = (a.trades || []).map((t) => `<tr><td>${new Date(t.time).toLocaleString('ko-KR', { hour12: false })}</td><td>${escape(t.type || '-')}</td><td>${escape(t.detail || '-')}</td><td>${won(t.amountKrw || 0)}</td><td class="${Number(t.pnlKrw || 0) >= 0 ? 'up' : 'down'}">${t.pnlKrw == null ? '-' : won(t.pnlKrw)}</td></tr>`).join(''); return table(['시간', '구분', '내용', '금액', '손익'], rows, '아직 거래 기록이 없습니다'); }
  if (tab === 'assets') { const rows = (a.balances || []).map((b) => `<tr><td>${escape(b.asset)}</td><td>${Number(b.free || 0).toFixed(6)}</td><td>${Number(b.locked || 0).toFixed(6)}</td><td>${Number(b.total || 0).toFixed(6)}</td><td>${b.pnl == null ? '-' : usd(b.pnl)}</td></tr>`).join('') || `<tr><td>원화 환산 총자산</td><td colspan="3">${won(a.totalKrw || 0)}</td><td>${a.source || 'PAPER'}</td></tr>`; return table(['자산', '사용 가능', '주문 묶임', '합계', '평가 손익'], rows, 'API 키를 입력하면 Binance 자산을 표시합니다'); }
  const rows = (a.events || []).map((e) => `<tr><td>${new Date(e.time).toLocaleString('ko-KR', { hour12: false })}</td><td>${escape(e.event?.kind || '-')}</td><td>${escape(e.event?.message || '-')}</td></tr>`).join(''); return table(['시간', '종류', '내용'], rows, '실계좌 API를 연결하면 잔고·주문 이벤트가 실시간 표시됩니다');
}
function table(headers, rows, empty) { return rows ? `<table class="data-table"><thead><tr>${headers.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty-row">${empty}</div>`; }
function renderWorkspace() { const active = $('#workspaceTabs .active')?.dataset.tab || 'positions'; $('#workspaceContent').innerHTML = workspaceRows(active); }
function orderActionText() { const map = { buy: '매수', sell: '매도', short: '숏 진입', close: '포지션 정리' }; return map[selectedAction] || '매수'; }
function renderOrderPanel() {
  const a = currentAccount(); const c = state.config; const m = state.market; const action = orderActionText();
  $$('.order-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.action === selectedAction));
  $$('.order-type button').forEach((button) => button.classList.toggle('active', button.dataset.orderType === selectedOrderType));
  $('.limit-field').classList.toggle('hidden', selectedOrderType !== 'limit');
  const submit = $('#orderSubmit'); submit.textContent = `${isLive() ? 'LIVE 실계좌' : 'PAPER'} ${action}`; submit.className = `order-submit ${selectedAction}`;
  const long = $('#futuresLong'); const short = $('#futuresShort');
  if (long && short) {
    long.querySelector('small').textContent = isLive() ? 'LIVE 시장가' : 'PAPER 시장가';
    short.querySelector('small').textContent = isLive() ? 'LIVE 시장가' : 'PAPER 시장가';
  }
  $('#orderGuide').textContent = isLive() ? '실계좌 주문은 마지막 확인창에서 종목·방향·금액을 다시 확인합니다' : '모의투자입니다 · 가상 원화로 주문을 연습합니다';
  const amount = inputNumber($('#orderAmount').value, c.paperOrderKrw || 0); const fee = amount * .0005; elText('#feeEstimate', won(fee)); elText('#afterOrder', won(Math.max(0, Number(a.availableKrw || 0) - (selectedAction === 'close' ? 0 : amount))));
  if (isFutures()) $('#leverage').value = $('#leverage').value || c.futuresLeverage || 1;
}
function setupInteractions() {
  $('#marketSearch').addEventListener('input', renderMarkets);
  $('#symbolPicker').addEventListener('click', () => $('#marketSearch').focus());
  $$('.interval').forEach((button) => button.addEventListener('click', async () => { try { await api('/api/interval', { interval: button.dataset.interval }); $$('.interval').forEach((item) => item.classList.toggle('active', item === button)); } catch (error) { toast(error.message, true); } }));
  $('#chartZoomIn').addEventListener('click', () => { chartCount = Math.max(30, chartCount - 15); renderChart(state.market); }); $('#chartZoomOut').addEventListener('click', () => { chartCount = Math.min(180, chartCount + 15); renderChart(state.market); });
  $$('#workspaceTabs button').forEach((button) => button.addEventListener('click', () => { $$('#workspaceTabs button').forEach((item) => item.classList.toggle('active', item === button)); renderWorkspace(); }));
  $$('.order-tabs button').forEach((button) => button.addEventListener('click', () => { selectedAction = button.dataset.action; renderOrderPanel(); }));
  $$('.order-type button').forEach((button) => button.addEventListener('click', () => { selectedOrderType = button.dataset.orderType; renderOrderPanel(); }));
  $('#orderAmount').addEventListener('input', renderOrderPanel); $('#leverage').addEventListener('input', renderOrderPanel);
  $$('.quick-amount button').forEach((button) => button.addEventListener('click', () => { const ratio = Number(button.dataset.ratio); const available = Number(currentAccount().availableKrw || 0); $('#orderAmount').value = Math.floor(available * ratio); renderOrderPanel(); }));
  $('#orderSubmit').addEventListener('click', submitOrder);
  $('#futuresLong').addEventListener('click', () => { selectedAction = 'buy'; submitOrder(); });
  $('#futuresShort').addEventListener('click', () => { selectedAction = 'short'; submitOrder(); });
  $$('[data-open-settings]').forEach((button) => button.addEventListener('click', openSettings));
  $$('[data-open-slots]').forEach((button) => button.addEventListener('click', openSlots));
  $$('[data-close-slots]').forEach((button) => button.addEventListener('click', () => $('#slotsDialog').close()));
  $$('.mode-switch button').forEach((button) => button.addEventListener('click', () => { pendingMode = button.dataset.mode; updateModeButtons(); }));
  $('#settingsForm').addEventListener('submit', saveSettings); $('#paperReset').addEventListener('click', resetPaper); $('#confirmLiveOrder').addEventListener('click', sendLiveOrder); $('#cancelLiveOrder').addEventListener('click', () => $('#confirmDialog').close());
  window.addEventListener('resize', () => state && renderChart(state.market));
}
function openSettings() {
  if (!state) return; const c = state.config; pendingMode = c.mode; updateModeButtons(); $('#paperInitial').value = c.paperInitialKrw || ''; $('#paperOrder').value = c.paperOrderKrw || ''; $('#futuresLeverage').value = c.futuresLeverage || 1; $('#autoTrading').value = String(Boolean(c.autoTrading)); $('#activeSlot').value = String(c.activeSlot || 1); $('#apiKey').value = ''; $('#secretKey').value = ''; const account = currentAccount(); $('#apiStatus').textContent = c.hasApiKey ? (account.ready ? `API Key ${c.apiKeyHint} 연결됨 · 마지막 실계좌 갱신 ${new Date(account.refreshedAt || Date.now()).toLocaleTimeString('ko-KR')}` : account.error) : '아직 API Key가 없습니다 · PAPER 모드는 키 없이 바로 쓸 수 있습니다'; $('#settingsDialog').showModal();
}
function updateModeButtons() { $$('.mode-switch button').forEach((button) => button.classList.toggle('active', button.dataset.mode === pendingMode)); }
function slotRules(definition, group) { return (definition?.[group] || []).filter((rule) => rule?.사용).map((rule) => `<li><b>${escape(rule.이름)}</b><span>${escape(rule.값)}${rule.단위 && rule.단위 !== '참·거짓' ? ` ${escape(rule.단위)}` : ''}</span></li>`).join('') || '<li class="slot-empty">사용 규칙 없음</li>'; }
function renderSlots(payload) {
  const activeId = Number(payload.activeId || state?.config?.activeSlot || 1);
  const items = payload.items || [];
  $('#slotSummary').innerHTML = `<b>${isFutures() ? 'USDⓈ-M 선물' : '현물'} · 5개 독립 전략 슬롯</b><span>현재 ${activeId}번 적용 · 이 사이트에만 저장되며 최초 설정만 업비트에서 복사했습니다</span>`;
  $('#slotList').innerHTML = items.map((slot) => {
    const d = slot.definition || {}; const order = d.주문설정 || {}; const active = Number(slot.id) === activeId;
    return `<article class="slot-card ${active ? 'active' : ''}"><header><div><span class="slot-id">SLOT ${slot.id}</span><h3>${escape(slot.name || d.슬롯이름 || `${slot.id}번 슬롯`)}</h3><p>${escape(d.전략설명 || '전략 설명이 없습니다')}</p></div><span class="slot-status ${active ? 'on' : ''}">${active ? '적용 중' : '준비 완료'}</span></header><div class="slot-metrics"><span><small>주문 방식</small><b>${escape(order.주문방식 || '고정금액')}</b></span><span><small>한 번 주문</small><b>${won(order.주문금액원 || 0)}</b></span><span><small>동시 보유</small><b>${Number(order.동시보유수 || 0)}개</b></span><span><small>사용 모드</small><b>${escape((d.사용가능모드 || []).join(' · '))}</b></span></div><details><summary>적용 규칙 보기 <span>선별 ${(d.코인고르기규칙 || []).filter((rule) => rule.사용).length} · 진입 ${(d.매수규칙 || []).filter((rule) => rule.사용).length} · 매도 ${(d.매도규칙 || []).filter((rule) => rule.사용).length}</span></summary><div class="slot-rule-columns"><section><h4>종목 선별</h4><ul>${slotRules(d, '코인고르기규칙')}</ul></section><section><h4>진입 규칙</h4><ul>${slotRules(d, '매수규칙')}</ul></section><section><h4>매도 · 리스크</h4><ul>${slotRules(d, '매도규칙')}</ul></section></div></details><footer><span>${escape(d.판단방식 || '규칙만 사용')} · 이 Binance 사이트 전용 설정</span><button class="slot-apply" data-slot-id="${slot.id}" ${active ? 'disabled' : ''}>${active ? '현재 적용 중' : '이 슬롯 적용'}</button></footer></article>`;
  }).join('');
  $$('.slot-apply').forEach((button) => button.addEventListener('click', async () => {
    try { const result = await api('/api/slots/apply', { slotId: Number(button.dataset.slotId) }); state.config = result.config; payload.activeId = result.config.activeSlot; render(); renderSlots(payload); toast(result.message || `${button.dataset.slotId}번 슬롯을 적용했습니다`); }
    catch (error) { toast(error.message, true); }
  }));
}
async function openSlots() {
  try { const payload = await getJson('/api/slots'); renderSlots(payload); $('#slotsDialog').showModal(); }
  catch (error) { toast(`전략 슬롯을 불러오지 못했습니다: ${error.message}`, true); }
}
async function saveSettings(event) { event.preventDefault(); const key = $('#apiKey').value.trim(); const secret = $('#secretKey').value.trim(); const body = { mode: pendingMode, paperInitialKrw: inputNumber($('#paperInitial').value), paperOrderKrw: inputNumber($('#paperOrder').value), futuresLeverage: inputNumber($('#futuresLeverage').value, 1), autoTrading: $('#autoTrading').value === 'true', activeSlot: inputNumber($('#activeSlot').value, 1) }; if (key) body.apiKey = key; if (secret) body.secretKey = secret; try { await api('/api/config', body); $('#settingsDialog').close(); toast('로컬 Binance 설정을 저장했습니다'); } catch (error) { toast(error.message, true); } }
async function resetPaper() { const initial = inputNumber($('#paperInitial').value, state.config.paperInitialKrw); if (!confirm(`${won(initial)} PAPER 계좌를 완전히 초기화할까요? 보유분·PAPER 주문·PAPER 거래기록이 모두 지워집니다`)) return; try { await api('/api/reset', { initialKrw: initial, orderKrw: inputNumber($('#paperOrder').value, state.config.paperOrderKrw) }); toast('PAPER 계좌를 완전히 초기화했습니다'); } catch (error) { toast(error.message, true); } }
function buildOrderBody(confirmLive = false) { const amount = Math.max(10_000, inputNumber($('#orderAmount').value)); const position = currentPosition(); const b = { action: selectedAction, orderType: selectedOrderType, amountKrw: amount, limitPrice: inputNumber($('#limitPrice').value), leverage: inputNumber($('#leverage').value, state.config.futuresLeverage || 1), confirmLive }; if (selectedAction === 'sell') { const holding = currentAccount().balances?.find((item) => item.asset === baseAsset()); b.qty = holding?.free || 0; } if (selectedAction === 'close') b.closeSide = position?.side === 'SHORT' ? 'BUY' : 'SELL'; return b; }
function submitOrder() { if (!state) return; if (isLive()) { const body = buildOrderBody(false); const action = orderActionText(); $('#confirmText').textContent = `${niceSymbol(state.market.symbol)} ${action} 주문을 실제 Binance 계좌로 전송합니다`;
    $('#confirmDetails').innerHTML = `<span>방향</span><b>${action}</b><span>주문 유형</span><b>${selectedOrderType === 'market' ? '시장가' : '지정가'}</b><span>주문 금액</span><b>${won(body.amountKrw)}</b><span>현재 예상가</span><b>${usd(state.market.price)} · ${won(state.market.priceKrw)}</b>${isFutures() ? `<span>레버리지</span><b>${body.leverage}배</b>` : ''}`; $('#confirmDialog').showModal(); return; }
  sendPaperOrder(); }
async function sendPaperOrder() { try { const body = buildOrderBody(false); if (body.action === 'sell') body.action = 'close'; const result = await api('/api/order', body); toast(result.message || 'PAPER 주문을 처리했습니다'); } catch (error) { toast(error.message, true); } }
async function sendLiveOrder() { try { const result = await api('/api/order', buildOrderBody(true)); $('#confirmDialog').close(); toast(result.order ? `실계좌 주문이 Binance에 접수되었습니다 · ${result.order.symbol}` : '실계좌 주문을 전송했습니다'); } catch (error) { $('#confirmDialog').close(); toast(error.message, true); } }
async function boot() { try { const response = await fetch('/api/state', { cache: 'no-store' }); update(await response.json()); setupInteractions(); const stream = new EventSource('/api/stream'); stream.addEventListener('state', (event) => update(JSON.parse(event.data))); stream.onerror = () => { $('#connection').textContent = '● 실시간 화면을 다시 연결합니다'; }; } catch (error) { toast(`로컬 서버 연결 실패: ${error.message}`, true); } }
boot();
