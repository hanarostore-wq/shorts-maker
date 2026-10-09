import { $, $$, bus, S, connect, disconnect, api, setToken, fmtInt, fmtPct, toast, tradeNotice } from './core.js?v=1.10.68';
import { initExchange } from './exchange.js?v=1.10.68';
import { initPages, onRoute, toggleAuto } from './pages.js?v=1.10.68';
import { initMainBoard, onMainRoute } from './mainboard.js?v=1.10.68';

const ROUTES = ['main', 'exchange', 'auto', 'investments', 'settings'];
// This is the owner's active YuJin Traders conversation. Opening the named popup at
// this deep link avoids returning to the Manus task list on every launch.
const MANUS_CHAT_URL = 'https://manus.im/app/VOCIGM1M01mVF2EUbkyDzg';
const MANUS_EXTENSION_CHANNEL = 'yujin-manus-popup-position-v1';
let manusExtensionReady = false;

function route() {
  const r = (location.hash.replace(/^#\/?/, '') || 'main').split('?')[0];
  const name = ROUTES.includes(r) ? r : 'main';
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${name}`));
  $$('.gnb-menu a').forEach((a) => a.classList.toggle('on', a.dataset.route === name));
  $$('.mobile-dock a').forEach((a) => a.classList.toggle('on', a.dataset.route === name));
  if (name === 'main') onMainRoute(); else onRoute(name);
  window.scrollTo(0, 0);
}

function formatClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dayKo = ['일','월','화','수','목','금','토'][d.getDay()];
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}(${dayKo}) ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function updateTopMeta() {
  const metaClock = $('#metaClock');
  if (metaClock) metaClock.textContent = formatClock();

  const st = S.status || {};
  const sum = S.summary || {};
  const j = sum.jev || {};
  const metaVer = $('#metaVersion');
  const clientVer = 'v1.10.63';
  if (metaVer) metaVer.textContent = `${clientVer}`;

  const metaLat = $('#metaLatency');
  if (metaLat) {
    const parts = [];
    if (st.lastBinanceLatency != null) {
      parts.push(`Binance 수신 간격 ${Math.round(st.lastBinanceLatency)}ms`);
    } else if (st.binance) {
      parts.push('Binance 정상 수신');
    } else {
      parts.push('Binance 연결 대기');
    }
    if (j.lastLatency != null) {
      parts.push(`Jev 최근 ${Math.round(j.lastLatency)}ms·평균 ${Math.round(j.avgLatency ?? j.lastLatency)}ms`);
    } else if (sum.effectiveDecisionMode === 'rule') {
      parts.push('순수 규칙');
    }
    metaLat.textContent = parts.join(' · ') || '수신 대기';
  }
}

function renderChips() {
  updateTopMeta();
  applyTheme();
  const st = S.status || {};
  const up = $('#chipBinance');
  up.className = `chip ${S.connected && st.binance ? 'ok' : 'bad'}`;
  up.title = S.connected ? (st.binance ? 'Binance 실시간 시세 수신 중' : 'Binance 연결 재시도 중') : '서버 연결 끊김';
  const m = S.summary;
  if (m) {
    const j = m.jev;
    const ruleMode = m.effectiveDecisionMode === 'rule';
    const chip = $('#chipJev');
    const recentErr = j.lastError && Date.now() - j.lastError.at < 60000;
    chip.className = `chip ${ruleMode ? 'warn' : recentErr ? 'bad' : 'ok'}`;
    chip.dataset.mode = ruleMode ? 'rule' : 'jev';
    chip.querySelector('.t').textContent = ruleMode ? '순수 규칙' : `Jev ${j.avgLatency != null ? Math.round(j.avgLatency) + 'ms' : ''}`;
    chip.title = ruleMode ? 'Jev API 호출 0회 · EMA 리본과 실시간 규칙으로 선별·매수·매도' : `${j.label}${recentErr ? `\n최근 오류: ${j.lastError.msg}` : ''}`;
  }
  const on = true;
  const t = $('#autoToggle');
  const isLive = S.config?.mode === 'live';
  const compact = window.matchMedia('(max-width: 760px)').matches;
  t.classList.toggle('on', on);
  t.disabled = false;
  t.querySelector('.lbl').textContent = compact ? '자동 ON' : '자동매매 ON';
  t.title = '자동매매는 항상 켜짐으로 유지';
  $('#connLost').classList.toggle('on', !S.connected);
  const modeChip = $('#chipMode');
  if (modeChip) {
    modeChip.querySelector('.lbl').textContent = isLive ? '실' : '모';
    modeChip.className = `chip chip-mode ${isLive ? 'live' : ''}`;
    modeChip.title = isLive ? '현재 실전투자 모드 (클릭 시 모의투자로 전환)' : '현재 모의투자 모드 (클릭 시 실전투자로 전환)';
  }
  if (m) {
    const judge = m.effectiveDecisionMode === 'rule' ? '순수 규칙형 · Jev API 0회' : 'Jev 보조형';
    $('#noticeText').innerHTML = `${isLive ? '<b style="color:var(--up)">실전투자 모드</b> · Binance 실제 주문 발송' : '모의투자 · 실제 주문 없음'} · 판단 <b>${judge}</b> · 총 평가 <b>${fmtInt(m.equity)}원</b> <span class="${m.totalPnl > 0 ? 'up' : m.totalPnl < 0 ? 'down' : ''}">${fmtPct(m.totalPnlPct)}</span>`;
  }
}

function applyTheme() {
  document.body.classList.add('dark');
}

function initTheme() {
  localStorage.setItem('yujin-theme', 'dark');
  applyTheme();
}

let manusPopup = null;

function initManusExtensionBridge() {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== MANUS_EXTENSION_CHANNEL) return;
    if (data.type === 'ready') manusExtensionReady = true;
    if (data.type === 'open-result' && !data.ok) toast(`Manus 창을 열지 못했습니다 · ${data.error || 'Whale 확장 프로그램을 새로고침해 주세요'}`, 'err');
  });
  // The extension replies only when it is installed on this exact dashboard origin.
  window.postMessage({ channel: MANUS_EXTENSION_CHANNEL, type: 'probe' }, window.location.origin);
}

function openLegacyManusPopup() {
  // Do not recreate or reposition a chat window the user has already moved.
  if (manusPopup && !manusPopup.closed) {
    manusPopup.focus();
    return;
  }
  const width = Math.min(440, Math.max(350, window.screen.availWidth - 48));
  const height = Math.min(780, Math.max(580, window.screen.availHeight - 90));
  const left = Math.max(0, Math.round(window.screenX + window.outerWidth - width - 18));
  const top = Math.max(0, Math.round(window.screenY + 48));
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  const chat = window.open(MANUS_CHAT_URL, 'yujin-manus-chat', features);
  if (chat) {
    manusPopup = chat;
    chat.focus();
  } else toast('팝업이 차단됐습니다 · Whale에서 이 사이트의 팝업을 허용해 주세요', 'err');
}

function initManusPopup() {
  const launch = $('#manusLauncher');
  launch?.addEventListener('click', () => {
    if (manusExtensionReady) {
      window.postMessage({ channel: MANUS_EXTENSION_CHANNEL, type: 'open', requestId: `manus-${Date.now()}` }, window.location.origin);
      return;
    }
    openLegacyManusPopup();
  });
}

function initControlRoomEscapeClose() {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || window.parent === window) return;
    // 슬롯·투자금 등 이 화면 안의 모달이 먼저 Esc를 처리한다.
    if (document.querySelector('.main-modal-backdrop')) return;
    window.parent.postMessage({ channel: 'yujin-control-room', type: 'escape-close' }, '*');
  });
}

function boot() {
    $('#chipMode')?.addEventListener('click', async () => {
    const nextMode = S.config?.mode === 'live' ? 'paper' : 'live';
    if (nextMode === 'live' && !confirm('실전투자 모드로 전환하시겠습니까? 실제 Binance 주문이 전송될 수 있습니다.')) return;
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify({ mode: nextMode }) });
      if (S.config) S.config.mode = nextMode;
      renderChips();
    } catch (e) {
      alert('모드 전환 실패: ' + (e.message || e));
    }
  });
  initTheme();
  initManusExtensionBridge();
  initManusPopup();
  initControlRoomEscapeClose();
  initMainBoard();
  initExchange();
  initPages();
  window.addEventListener('hashchange', route);
  setInterval(updateTopMeta, 1000);
  const autoBtn = $('#autoToggle');
  if (autoBtn) {
    let lastToggleAt = 0;
    const handleToggle = (e) => {
      const now = Date.now();
      if (now - lastToggleAt < 400) return;
      lastToggleAt = now;
      toggleAuto();
    };
    autoBtn.addEventListener('click', handleToggle);
    autoBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      handleToggle(e);
    });
  }
  bus.on('init', renderChips);
  bus.on('sum', renderChips);
  bus.on('cfg', renderChips);
  bus.on('conn', renderChips);
  bus.on('fill', tradeNotice);
  route();
  bus.on('auth-required', showLogin);
  $('#loginForm').addEventListener('submit', login);
  start();
}

let started = false;
async function start() {
  try {
    const a = await api('/api/auth');
    // 실전 모드가 아니고 모의투자 대시보드일 때는 화면을 가로막지 않고 바로 대시보드를 표시하며,
    // 필요 시 상단 로그인 버튼이나 주문 시 비밀번호를 입력할 수 있게 합니다.
    if (a.required && !a.ok && S.config?.mode === 'live') {
      connect();
      return showLogin(a);
    }
  } catch { /* server unreachable: connect() keeps retrying */ }
  hideLogin();
  if (!started) { started = true; connect(); } else connect();
}

function showLogin(a) {
  $('#login').classList.add('on');
  $('#loginErr').textContent = a && a.configured === false ? '서버에 비밀번호가 아직 설정되지 않았습니다 (DASHBOARD_PASSWORD)' : '';
  setTimeout(() => $('#loginPw').focus(), 50);
}
function hideLogin() { $('#login').classList.remove('on'); }

async function login(e) {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  $('#loginErr').textContent = '';
  try {
    const r = await api('/api/login', { password: $('#loginPw').value });
    setToken(r.token);
    $('#loginPw').value = '';
    await start();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  } finally { btn.disabled = false; }
}

boot();
