import { getSettings, saveSettings, SITE_LIST } from '../shared/settings.js';
import { buildFilename, sanitizeFolder } from '../shared/filename.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let settings = await getSettings();
const siteMeta = Object.fromEntries(SITE_LIST.map((s) => [s.id, s]));

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;

// ───────────── 탭 ─────────────
function showTab(name) {
  $$('.tab').forEach((t, i) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('on', on);
    if (on) $('.tab-ink').style.transform = `translateX(${i * 100}%)`;
  });
  $$('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
  try { sessionStorage.setItem('tab', name); } catch {}
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
try { if (sessionStorage.getItem('tab')) showTab(sessionStorage.getItem('tab')); } catch {}

// ───────────── 설정 바인딩 ─────────────
function seg(el, value, onPick) {
  const btns = [...el.querySelectorAll('button')];
  const paint = (v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  paint(value);
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      paint(b.dataset.v);
      onPick(b.dataset.v);
    }),
  );
  return paint;
}

const save = async (patch) => {
  settings = await saveSettings(patch);
  renderPreview();
};

$('#showButtons').checked = settings.showButtons !== false;
$('#showButtons').addEventListener('change', (e) => save({ showButtons: e.target.checked }));

$('#subfolder').value = settings.subfolder || '';
$('#subfolder').addEventListener('change', (e) => {
  const clean = sanitizeFolder(e.target.value);
  e.target.value = clean;
  save({ subfolder: clean });
});
$('#askEveryTime').checked = !!settings.askEveryTime;
$('#askEveryTime').addEventListener('change', (e) => save({ askEveryTime: e.target.checked }));

$$('input[name="quality"]').forEach((r) => {
  r.checked = r.value === settings.quality;
  r.addEventListener('change', () => r.checked && save({ quality: r.value }));
});

const tplSel = $('#filenameTemplate');
if (![...tplSel.options].some((o) => o.value === settings.filenameTemplate)) {
  tplSel.add(new Option('사용자 지정', settings.filenameTemplate));
}
tplSel.value = settings.filenameTemplate;
tplSel.addEventListener('change', () => save({ filenameTemplate: tplSel.value }));

function renderPreview() {
  const name = buildFilename(settings.filenameTemplate, { title: '여름 바다 브이로그', site: 'youtube', siteName: '유튜브', id: 'dQw4w9WgXcQ', author: '하나로', quality: '1080p' }, 'mp4');
  const sub = sanitizeFolder(settings.subfolder);
  const where = `${shownFolder}/${sub ? `${sub}/` : ''}`;
  $('#filenamePreview').innerHTML = `예시: ${escapeHtml(where)}<b>${escapeHtml(name)}</b>`;
}

seg($('#buttonPosition'), settings.buttonPosition || 'mid-right', (v) => save({ buttonPosition: v }));
const activeTab = async () => {
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  return forced ? chrome.tabs.get(forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
};
$('#placeButton').addEventListener('click', async () => {
  const tab = await activeTab();
  const r = tab && (await chrome.tabs.sendMessage(tab.id, { type: 'smd:edit-placement' }, { frameId: 0 }).catch(() => null));
  if (r?.ok) window.close();
  else $('#placeNote').textContent = '영상이 있는 웹페이지 탭에서 눌러 주세요. 방금 연 탭이면 새로고침(F5) 후 다시 시도하세요.';
});
$('#resetPlacement').addEventListener('click', async () => {
  const tab = await activeTab();
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  const id = SITE_HOSTS.find(([re]) => re.test(host))?.[1] || 'generic';
  const placements = { ...(settings.placements || {}) };
  delete placements[id];
  await save({ placements });
  $('#placeNote').textContent = '이 사이트의 직접 배치를 지웠어요. 위에서 고른 위치를 사용합니다.';
});
$('#genericButtons').checked = settings.genericButtons !== false;
$('#genericButtons').addEventListener('change', (e) => save({ genericButtons: e.target.checked }));

// ───────────── 저장 폴더 (웨일 다운로드 폴더) ─────────────
let shownFolder = '다운로드 폴더';
$('#changeFolder').addEventListener('click', async () => {
  for (const url of ['whale://settings/downloads', 'chrome://settings/downloads']) {
    try {
      await chrome.tabs.create({ url });
      return;
    } catch {}
  }
  $('#folderHint').textContent = '설정 창을 열지 못했어요. 주소창에 whale://settings/downloads 를 입력하세요.';
});

async function renderFolder() {
  // 이 확장프로그램이 마지막으로 저장한 파일 위치로 현재 저장 폴더를 보여 준다.
  const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 50, state: 'complete' }).catch(() => []);
  const mine = items.find((i) => i.byExtensionId === chrome.runtime.id && i.filename) || items.find((i) => i.filename);
  if (mine) {
    const sep = mine.filename.includes('\\') ? '\\' : '/';
    let dir = mine.filename.slice(0, mine.filename.lastIndexOf(sep));
    const sub = sanitizeFolder(settings.subfolder).split('/').join(sep);
    if (sub && dir.endsWith(sep + sub)) dir = dir.slice(0, -(sub.length + 1));
    shownFolder = dir;
    $('#folderPath').textContent = dir;
    $('#folderPath').title = dir;
  } else {
    $('#folderPath').textContent = '웨일 다운로드 폴더';
  }
  renderPreview();
}
renderFolder();
$('#imageButtons').checked = settings.imageButtons !== false;
$('#imageButtons').addEventListener('change', (e) => save({ imageButtons: e.target.checked }));

// ───────────── 지원 사이트 ─────────────
function renderSites() {
  const ul = $('#siteList');
  ul.innerHTML = '';
  for (const s of SITE_LIST) {
    const li = document.createElement('li');
    li.innerHTML = `<label class="site"><span class="sdot" style="background:${s.color}"></span><span class="n">${escapeHtml(s.name)}</span><input type="checkbox" ${settings.disabledSites?.includes(s.id) ? '' : 'checked'}><span class="sw"><i></i></span></label>`;
    li.querySelector('input').addEventListener('change', (e) => {
      const set = new Set(settings.disabledSites || []);
      if (e.target.checked) set.delete(s.id);
      else set.add(s.id);
      save({ disabledSites: [...set] });
    });
    ul.appendChild(li);
  }
}
renderSites();

// ───────────── 현재 탭 ─────────────
const SITE_HOSTS = [
  [/(^|\.)youtube(-nocookie)?\.com$/, 'youtube'], [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$/, 'facebook'], [/(^|\.)(x|twitter)\.com$/, 'x'], [/(^|\.)bsky\.app$/, 'bluesky'],
  [/(^|\.)xiaohongshu\.com$/, 'xiaohongshu'], [/(^|\.)douyin\.com$/, 'douyin'], [/(^|\.)kuaishou\.com$/, 'kuaishou'],
  [/(^|\.)bilibili\.com$/, 'bilibili'], [/(^|\.)weibo\.(com|cn)$/, 'weibo'], [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)pinterest\./, 'pinterest'], [/(^|\.)naver\.com$/, 'naver'], [/(^|\.)vimeo\.com$/, 'vimeo'], [/(^|\.)dailymotion\.com$/, 'dailymotion'],
];
const fmtDur = (s) => {
  if (!(s > 0) || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';

async function renderPage() {
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const hint = $('#pageHint');
  const list = $('#videoList');
  list.innerHTML = '';
  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('#pageSite').textContent = '이 페이지에서는 사용할 수 없어요';
    hint.textContent = '웹사이트 탭에서 확장프로그램 아이콘을 눌러 주세요';
    return;
  }
  const host = new URL(tab.url).hostname;
  const siteId = SITE_HOSTS.find(([re]) => re.test(host))?.[1] || 'generic';
  const meta = siteMeta[siteId];
  $('#pageSite').textContent = siteId === 'generic' ? host : meta.name;
  $('#pageDot').style.background = meta.color;
  const { frames } = await chrome.runtime.sendMessage({ type: 'smd:tab-frames', tabId: tab.id }).catch(() => ({ frames: [] }));
  const ids = new Set([0, ...(frames || []).filter((f) => f.count > 0).map((f) => f.frameId)]);
  const videos = [];
  let connected = false;
  for (const frameId of ids) {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'smd:list' }, { frameId }).catch(() => null);
    if (r) connected = true;
    for (const v of r || []) videos.push({ ...v, frameId });
  }
  const info = connected ? await chrome.tabs.sendMessage(tab.id, { type: 'smd:images-info' }, { frameId: 0 }).catch(() => null) : null;
  if (info?.count) {
    const b = $('#saveAllImages');
    b.style.display = '';
    b.textContent = `이 페이지 사진 ${info.count}장 모두 저장`;
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = '저장 요청 중…';
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'smd:save-all-images' }, { frameId: 0 }).catch(() => null);
      b.textContent = r?.started ? `${r.started}장 저장 시작 — 아래 최근 다운로드에서 확인` : '사진을 저장하지 못했어요. 페이지를 새로고침한 뒤 다시 시도하세요.';
    };
  }
  if (!connected) {
    hint.textContent = '이 탭에는 아직 확장프로그램이 연결되지 않았어요. 페이지를 새로고침(F5)하면 영상 아래에 버튼이 나타나요.';
    return;
  }
  videos.sort((a, b) => Number(b.visible) - Number(a.visible));
  if (!videos.length) {
    hint.textContent = '이 화면에서 영상을 찾지 못했어요. 영상을 재생하면 나타납니다.';
    return;
  }
  hint.textContent = `영상 ${videos.length}개 감지됨${videos.some((v) => v.visible) ? ' · 화면에 보이는 영상이 위에 있어요' : ''}`;
  videos.slice(0, 8).forEach((v, i) => {
    const li = document.createElement('li');
    li.className = 'vitem';
    const res = v.width && v.height ? `재생 중 ${Math.min(v.width, v.height)}p` : '해상도 확인 전';
    li.innerHTML = `<div class="thumb">${PLAY}</div><div class="vmeta"><b>영상 ${i + 1}${v.visible ? ' · 화면에 보임' : ''}</b><small>${escapeHtml([fmtDur(v.duration), res].filter(Boolean).join(' · '))} · 원본 최고화질로 저장</small></div><button class="btn sm">다운로드</button>`;
    if (v.poster && /^https:/.test(v.poster)) {
      li.querySelector('.thumb').style.backgroundImage = `url("${v.poster.replace(/"/g, '%22')}"), var(--grad)`;
    }
    li.querySelector('button').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '요청됨';
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'smd:start', key: v.key }, { frameId: v.frameId }).catch(() => null);
      if (!r?.ok) {
        b.textContent = '실패';
        hint.textContent = '페이지 연결이 끊겼어요. 페이지를 새로고침(F5)한 뒤 다시 시도하세요.';
      }
    });
    list.appendChild(li);
  });
}
renderPage();

// ───────────── 다운로드 기록 ─────────────
const fmtBytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)}GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n > 0 ? `${Math.max(1, Math.round(n / 1024))}KB` : '');
const PHASE = { queue: '대기 중', resolve: '원본 주소 찾는 중', download: '받는 중', mux: '영상·음성 합치는 중', save: '파일 저장 중' };

async function renderJobs() {
  const [{ jobs = [] }, { history = [] }] = await Promise.all([chrome.storage.session.get('jobs'), chrome.storage.local.get('history')]);
  const seen = new Set();
  const all = [...jobs, ...history].filter((j) => (seen.has(j.id) ? false : seen.add(j.id))).sort((a, b) => b.created - a.created).slice(0, 25);
  const ul = $('#jobList');
  ul.innerHTML = '';
  $('#jobEmpty').style.display = all.length ? 'none' : '';
  const tpl = $('#tplJob');
  for (const j of all) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const meta = { ...(siteMeta[j.site] || siteMeta.generic) };
    if (j.siteName) meta.name = j.siteName;
    li.querySelector('.sdot').style.background = meta.color;
    li.querySelector('.jt').textContent = j.title || j.filename || '영상';
    li.querySelector('.jt').title = j.where || j.filename || '';
    const js = li.querySelector('.js');
    const act = li.querySelector('.jact');
    const q = j.quality ? ` · ${escapeHtml(j.quality)}` : '';
    if (j.state === 'running') {
      li.classList.add('running');
      if (j.percent == null) li.classList.add('indet');
      li.querySelector('.bar i').style.width = `${Math.max(3, j.percent || 0)}%`;
      const pct = j.percent != null ? ` ${Math.floor(j.percent)}%` : '';
      const bytes = fmtBytes(j.bytes);
      js.innerHTML = `${escapeHtml(meta.name)} · ${PHASE[j.phase] || '진행 중'}${pct}${bytes ? ` · ${bytes}` : ''}${q}`;
      const c = document.createElement('button');
      c.className = 'link';
      c.textContent = '취소';
      c.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'smd:cancel', jobId: j.id }));
      act.appendChild(c);
    } else if (j.state === 'done') {
      js.innerHTML = `<span class="ok">저장 완료</span> · ${escapeHtml(meta.name)}${q}`;
      if (j.where) li.querySelector('.jt').title = j.where;
      if (j.warning) {
        li.classList.add('warned');
        li.querySelector('.jerr').innerHTML = `<div><b>안내</b><span>${escapeHtml(j.warning)}</span></div>`;
      }
      if (j.downloadId != null) {
        const s = document.createElement('button');
        s.className = 'btn ghost sm';
        s.textContent = '폴더 열기';
        s.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'smd:show-file', downloadId: j.downloadId }));
        act.appendChild(s);
      }
    } else {
      li.classList.add('error');
      const label = j.state === 'canceled' ? '<span class="wa">취소됨</span>' : '<span class="er">실패</span>';
      js.innerHTML = `${label} · ${escapeHtml(meta.name)}`;
      const e = j.error || {};
      li.querySelector('.jerr').innerHTML = `<div><b>단계</b><span>${escapeHtml(e.step || '-')}</span></div><div><b>원인</b><span>${escapeHtml(e.reason || '-')}</span></div><div><b>해결</b><span>${escapeHtml(e.action || '-')}</span></div>`;
    }
    ul.appendChild(li);
  }
}
renderJobs();
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && changes.jobs) || (area === 'local' && changes.history)) renderJobs();
  if (area === 'local' && changes.settings) {
    settings = { ...settings, ...(changes.settings.newValue || {}) };
    renderFolder();
    renderPreview();
  }
});
$('#clearHistory').addEventListener('click', async () => {
  await chrome.storage.local.set({ history: [] });
  const { jobs = [] } = await chrome.storage.session.get('jobs');
  await chrome.storage.session.set({ jobs: jobs.filter((j) => j.state === 'running') });
  renderJobs();
});

// 폴더 선택 창에서 돌아오면 상태 갱신
window.addEventListener('focus', renderFolder);
renderPreview();

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
