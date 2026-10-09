import { getSettings, saveSettings, SITE_LIST, SITE_FEATURES, effectiveSettings } from '../shared/settings.js';
import { buildFilename, sanitizeFolder } from '../shared/filename.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let settings = await getSettings();
let floatPos = (await chrome.storage.local.get('floatPos').catch(() => ({}))).floatPos || {}; // 떠 있는 버튼을 옮긴 위치(사이트별)
const siteMeta = Object.fromEntries(SITE_LIST.map((s) => [s.id, s]));

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;

// ───────────── 업데이트: 폴더에 새 버전 파일이 받아져 있으면 '업데이트' 단추 ─────────────
// (설치·업데이트 프로그램이 매시간 GitHub 에서 새 버전을 받아 확장 폴더에 덮어쓴다. 웨일은 다시 불러와야 적용된다)
const verNum = (v) => String(v || '0').split('.').map((n) => Number(n) || 0);
const newer = (a, b) => {
  const x = verNum(a);
  const y = verNum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
(async () => {
  try {
    const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    const cur = chrome.runtime.getManifest().version;
    if (newer(disk.version, cur)) {
      $('#newVer').textContent = `v${disk.version}`;
      $('#updateBar').hidden = false;
    }
  } catch {}
})();
$('#applyUpdate').addEventListener('click', () => chrome.runtime.reload());

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
  const name = buildFilename(settings.filenameTemplate, { title: '여름 바다 브이로그', site: 'youtube', siteName: '유튜브', id: 'dQw4w9WgXcQ', author: '하나로', quality: '1080p', flag: settings.flagPrefix === false ? false : settings.flagStyle === 'emoji' ? 'emoji' : 'name' }, 'mp4');
  const sub = sanitizeFolder(settings.subfolder);
  const where = `${shownFolder}/${sub ? `${sub}/` : ''}${settings.siteFolders === true ? '유튜브/' : ''}${settings.sortFolders !== false ? '영상 1분30초 이하/' : ''}${settings.countryFolders !== false ? '한국/' : ''}`;
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
  const imagePlacements = { ...(settings.imagePlacements || {}) };
  delete placements[id];
  delete imagePlacements[id];
  await save({ placements, imagePlacements });
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
    for (const cat of ['사진', '영상 1분30초 이하', '영상 1분30초 초과']) if (dir.endsWith(sep + cat)) dir = dir.slice(0, -(cat.length + 1));
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
for (const id of ['captionOnMedia', 'captionCover', 'captionIntro', 'captionKeepOriginal', 'translateCaption', 'ytShortsStats', 'xFollowButtons', 'pauseOffscreen', 'preventDuplicates', 'autoFollow', 'aiLabel', 'downloadedMark', 'xPhotoTapClose', 'bskyFollowButtons', 'followAllButton', 'noAutoplay', 'captionAuthor', 'alwaysShowButtons', 'ytLikeFloat', 'followFloat', 'seekBar', 'forceH264Aac', 'hideTextPosts']) {
  $(`#${id}`).checked = settings[id] !== false;
  $(`#${id}`).addEventListener('change', (e) => save({ [id]: e.target.checked }));
}
$('#potPlayer').checked = settings.potPlayer === true;
$('#potPlayer').addEventListener('change', (e) => save({ potPlayer: e.target.checked }));
$('#sortFolders').checked = settings.sortFolders !== false;
$('#sortFolders').addEventListener('change', (e) => save({ sortFolders: e.target.checked }));
$('#siteFolders').checked = settings.siteFolders === true;
$('#siteFolders').addEventListener('change', (e) => save({ siteFolders: e.target.checked }));
$('#countryFolders').checked = settings.countryFolders !== false;
$('#countryFolders').addEventListener('change', (e) => save({ countryFolders: e.target.checked }));
$('#flagPrefix').checked = settings.flagPrefix !== false;
$('#flagPrefix').addEventListener('change', (e) => save({ flagPrefix: e.target.checked }));
seg($('#flagStyle'), settings.flagStyle || 'name', (v) => save({ flagStyle: v }));
$('#videoSmall').checked = settings.videoSmall === true;
$('#videoSmall').addEventListener('change', (e) => save({ videoSmall: e.target.checked }));
seg($('#videoScale'), String(settings.videoScale || 70), (v) => save({ videoScale: Number(v) }));
$('#imageButtons').checked = settings.imageButtons !== false;
$('#imageButtons').addEventListener('change', (e) => save({ imageButtons: e.target.checked }));

// ───────────── 지원 사이트 ─────────────
// 내 폴더: 사용자가 만든 폴더 이름 목록(folderList) + 사이트에 이미 지정된 폴더 이름. 사이트마다 드롭다운으로 고른다
const cleanFolder = (v) => String(v || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 40);
const myFolders = () => [...new Set([...(settings.folderList || []), ...Object.values(settings.siteFolderMap || {})].map(cleanFolder).filter(Boolean))];
function folderMsg(text, err = false) {
  const m = $('#mfMsg');
  m.textContent = text;
  m.classList.toggle('err', err);
}
async function addFolder(raw) {
  const name = cleanFolder(raw);
  if (!name) {
    folderMsg('폴더 만들기 실패 — 단계: 이름 확인 · 원인: 폴더 이름이 비어 있거나 쓸 수 없는 글자(\\ / : * ? " < > |)만 있습니다 · 조치: 글자나 숫자로 된 이름을 입력하세요.', true);
    return '';
  }
  if (!myFolders().includes(name)) await save({ folderList: [...(settings.folderList || []), name] });
  folderMsg(`'${name}' 폴더를 만들었습니다. 아래 사이트의 '저장 폴더'에서 고르세요.`);
  return name;
}
async function removeFolder(name) {
  const map = { ...(settings.siteFolderMap || {}) };
  const moved = [];
  for (const [id, f] of Object.entries(map)) {
    if (cleanFolder(f) !== name) continue;
    delete map[id];
    moved.push(siteMeta[id]?.name || id);
  }
  await save({ folderList: (settings.folderList || []).filter((f) => cleanFolder(f) !== name), siteFolderMap: map });
  folderMsg(`'${name}' 폴더를 목록에서 지웠습니다${moved.length ? ` (${moved.join('·')} → 기본 폴더)` : ''}. 이미 저장된 파일은 그대로 있습니다.`);
  renderSites();
}
function renderFolders() {
  const box = $('#mfList');
  box.innerHTML = '';
  const list = myFolders();
  if (!list.length) box.innerHTML = '<span class="mf-empty">아직 만든 폴더가 없습니다</span>';
  for (const f of list) {
    const used = SITE_LIST.filter((s) => cleanFolder((settings.siteFolderMap || {})[s.id]) === f).map((s) => s.name);
    const chip = document.createElement('span');
    chip.className = 'mf-chip';
    chip.title = used.length ? `${used.join(', ')}` : '아직 이 폴더를 고른 사이트가 없습니다';
    chip.innerHTML = `<span>📁 ${escapeHtml(f)}${used.length ? ` <em>${used.length}</em>` : ''}</span><button type="button" title="폴더 목록에서 지우기">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => removeFolder(f));
    box.appendChild(chip);
  }
}
$('#mfAdd').addEventListener('click', async () => {
  if (await addFolder($('#mfName').value)) {
    $('#mfName').value = '';
    renderSites();
  }
});
$('#mfName').addEventListener('keydown', (e) => e.key === 'Enter' && $('#mfAdd').click());

function renderSites() {
  renderFolders();
  const ul = $('#siteList');
  ul.innerHTML = '';
  const folders = myFolders();
  for (const s of SITE_LIST) {
    const li = document.createElement('li');
    const fname = cleanFolder((settings.siteFolderMap || {})[s.id]);
    const opts = [`<option value="">기본 (묶지 않음)</option>`, ...folders.map((f) => `<option value="${escapeHtml(f)}" ${f === fname ? 'selected' : ''}>📁 ${escapeHtml(f)}</option>`), `<option value="__new">+ 새 폴더 만들기…</option>`];
    li.innerHTML = `<label class="site"><span class="sdot" style="background:${s.color}"></span><span class="n">${escapeHtml(s.name)}</span><input type="checkbox" ${settings.disabledSites?.includes(s.id) ? '' : 'checked'}><span class="sw"><i></i></span></label>
      <button type="button" class="link sfeat">이 사이트 기능 설정 ›</button>
      <label class="sfold" title="이 사이트 파일을 저장할 폴더. 같은 폴더를 고른 사이트끼리 한 폴더로 묶입니다"><span class="sfl">저장 폴더</span><select class="sfsel">${opts.join('')}</select></label>
      <div class="sfname" hidden><input type="text" class="sfin" maxlength="40" placeholder="새 폴더 이름" spellcheck="false"><button type="button" class="btn sfmk">만들기</button></div>`;
    const setFolder = async (v) => {
      const map = { ...(settings.siteFolderMap || {}) };
      if (v) map[s.id] = v;
      else delete map[s.id];
      await save({ siteFolderMap: map });
      renderSites();
    };
    li.querySelector('.sfeat').addEventListener('click', () => {
      renderSitePanel(s.id);
      showTab('site');
    });
    const sel = li.querySelector('.sfsel');
    sel.addEventListener('change', () => {
      if (sel.value === '__new') {
        li.querySelector('.sfname').hidden = false;
        li.querySelector('.sfin').focus();
        return;
      }
      setFolder(sel.value);
    });
    const make = async () => {
      const name = await addFolder(li.querySelector('.sfin').value);
      if (name) await setFolder(name);
    };
    li.querySelector('.sfmk').addEventListener('click', make);
    li.querySelector('.sfin').addEventListener('keydown', (e) => e.key === 'Enter' && make());
    li.querySelector('.site input').addEventListener('change', (e) => {
      const set = new Set(settings.disabledSites || []);
      if (e.target.checked) set.delete(s.id);
      else set.add(s.id);
      save({ disabledSites: [...set] });
    });
    ul.appendChild(li);
  }
}
renderSites();

// ───────────── 이 사이트: 사이트마다 기능 켜고 끄기 ─────────────
let spSite = 'generic';
function renderSitePanel(id) {
  spSite = id;
  const meta = siteMeta[id] || siteMeta.generic;
  $('#spTitle').textContent = `${meta.name} 기능`;
  $('#spDot').style.background = meta.color;
  const sel = $('#spSelect');
  if (!sel.options.length) {
    for (const s of SITE_LIST) sel.add(new Option(s.name, s.id));
    sel.addEventListener('change', () => renderSitePanel(sel.value));
  }
  sel.value = id;
  const eff = effectiveSettings(settings, id);
  const own = (settings.siteSettings || {})[id] || {};
  const box = $('#spList');
  box.innerHTML = '';
  const row = (name, desc, checked, changed, onChange, extra = '') => {
    const l = document.createElement('label');
    l.className = 'row-toggle';
    l.innerHTML = `<div><b>${escapeHtml(name)}${changed ? ' <em class="mine">이 사이트만</em>' : ''}</b><small>${escapeHtml(desc)}</small>${extra}</div><input type="checkbox" ${checked ? 'checked' : ''} /><span class="sw"><i></i></span>`;
    l.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
    return l;
  };
  const head = (t) => {
    const h = document.createElement('div');
    h.className = 'sp-group';
    h.textContent = t;
    return h;
  };
  // 버튼 표시·저장 폴더(사이트 고유 설정)
  box.appendChild(head('이 사이트'));
  box.appendChild(row('이 사이트에서 저장 버튼 표시', '끄면 이 사이트에서는 버튼을 띄우지 않습니다', !(settings.disabledSites || []).includes(id), false, async (on) => {
    const set = new Set(settings.disabledSites || []);
    if (on) set.delete(id);
    else set.add(id);
    await save({ disabledSites: [...set] });
    renderSites();
  }));
  const fname = (settings.siteFolderMap || {})[id] || '';
  box.appendChild(row('따로 폴더에 저장', fname ? `다운로드/${fname}/(1분30초 이하·초과·사진)/(국적)` : '끄면 기본 다운로드 폴더(1분30초 이하·초과·사진 → 국적)', !!fname, false, async (on) => {
    const map = { ...(settings.siteFolderMap || {}) };
    if (on) map[id] = map[id] || meta.name;
    else delete map[id];
    await save({ siteFolderMap: map });
    renderSites();
    renderSitePanel(id);
  }));
  // 떠 있는 버튼(좋아요·팔로우·목록 전부 팔로우)을 끌어서 옮긴 위치 되돌리기
  {
    const moved = Object.keys(floatPos[id] || {}).length > 0;
    const r = document.createElement('div');
    r.className = 'row-toggle sp-floatpos';
    r.innerHTML = `<div><b>떠 있는 버튼 위치</b><small>${moved ? '끌어서 옮긴 위치에 있습니다' : '처음 위치(오른쪽 아래). 버튼을 끌어서 옮길 수 있습니다'}</small></div>`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sp-floatreset';
    b.textContent = '처음으로';
    b.disabled = !moved;
    b.addEventListener('click', async () => {
      try {
        const all = { ...((await chrome.storage.local.get('floatPos')).floatPos || {}) };
        delete all[id];
        await chrome.storage.local.set({ floatPos: all });
        floatPos = all;
        renderSitePanel(id);
      } catch (err) {
        b.textContent = '되돌리기 실패';
        b.title = `단계: 위치 저장소 쓰기 · 원인: ${err?.message || err} · 조치: 팝업을 닫았다 다시 열고 누르세요`;
      }
    });
    r.appendChild(b);
    box.appendChild(r);
  }
  // 성능 진단: 지금 탭에서 확장 기능별로 쓴 시간과 페이지가 멈춘 시간(최근 60초)
  {
    const r = document.createElement('div');
    r.className = 'row-toggle sp-perf';
    r.innerHTML = '<div><b>성능 진단</b><small>이 페이지가 느릴 때 눌러 보세요. 확장 기능별로 쓴 시간과 페이지가 멈춘 시간(최근 60초)을 보여 줍니다</small><pre class="sp-perf-out" hidden></pre></div>';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sp-floatreset sp-perf-run';
    b.textContent = '진단';
    const out = r.querySelector('.sp-perf-out');
    b.addEventListener('click', async () => {
      out.hidden = false;
      out.textContent = '재는 중…';
      out.textContent = await perfText(currentTabId);
    });
    r.appendChild(b);
    box.appendChild(r);
  }
  let group = '';
  for (const f of SITE_FEATURES) {
    if (f.sites && !f.sites.includes(id)) continue;
    if (f.group !== group) {
      group = f.group;
      box.appendChild(head(group));
    }
    box.appendChild(row(f.name, f.desc, eff[f.key] === true, f.key in own, async (on) => {
      const ss = { ...(settings.siteSettings || {}) };
      ss[id] = { ...(ss[id] || {}), [f.key]: on };
      await save({ siteSettings: ss });
      renderSitePanel(id);
    }));
    // 크기(%) 고르기 — 이 사이트만 따로
    if (f.scaleKey) {
      const sel = document.createElement('div');
      sel.className = 'seg sp-scale';
      sel.style.margin = '0 0 8px';
      sel.innerHTML = [40, 50, 60, 70, 80, 90].map((n) => `<button type="button" data-v="${n}">${n}%</button>`).join('');
      seg(sel, String(eff[f.scaleKey] || 70), async (v) => {
        const ss = { ...(settings.siteSettings || {}) };
        ss[id] = { ...(ss[id] || {}), [f.scaleKey]: Number(v) };
        await save({ siteSettings: ss });
        renderSitePanel(id);
      });
      box.appendChild(sel);
    }
  }
}
$('#spReset').addEventListener('click', async () => {
  const ss = { ...(settings.siteSettings || {}) };
  delete ss[spSite];
  await save({ siteSettings: ss });
  renderSitePanel(spSite);
});

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

let currentTabId = null;
// 성능 진단 결과를 읽기 쉬운 글로(실패하면 단계·원인·조치)
async function perfText(tabId) {
  if (!tabId) return '진단 실패\n단계: 탭 찾기\n원인: 지금 보고 있는 웹페이지 탭을 찾지 못했습니다\n조치: 웹사이트 탭에서 확장프로그램 아이콘을 눌러 다시 여세요.';
  let r;
  try {
    r = await chrome.tabs.sendMessage(tabId, { type: 'smd:perf' }, { frameId: 0 });
  } catch (err) {
    return `진단 실패\n단계: 페이지 연결\n원인: 이 페이지의 확장 스크립트와 연결하지 못했습니다 (${err?.message || err})\n조치: 페이지를 새로고침(F5)한 뒤 다시 누르세요.`;
  }
  if (!r) return '진단 실패\n단계: 페이지 응답\n원인: 페이지가 진단 결과를 보내지 않았습니다(확장 업데이트 전에 열린 페이지일 수 있음)\n조치: 페이지를 새로고침(F5)하고 잠시 쓴 뒤 다시 누르세요.';
  const ours = r.parts.reduce((a, p) => a + p.ms, 0);
  const lines = [`최근 ${r.seconds}초 동안`, `· 확장 기능이 쓴 시간: 합계 ${ours}ms`];
  for (const p of r.parts.slice(0, 8)) lines.push(`   - ${p.name}: ${p.ms}ms (${p.n}번, 가장 길게 ${p.max}ms)`);
  lines.push(`· 페이지가 멈춘 시간(50ms 넘는 작업): ${r.longTasks.n}번, 합계 ${r.longTasks.ms}ms, 가장 길게 ${r.longTasks.max}ms`);
  lines.push(`· 페이지 안 사진 ${r.images}장 · 영상 ${r.videos}개 · 화면에 보이는 것 ${r.visible}개`);
  const share = r.longTasks.ms ? Math.round((ours / r.longTasks.ms) * 100) : 0;
  if (r.longTasks.ms > 1500 && ours < r.longTasks.ms * 0.2) lines.push(`→ 판단: 멈춤의 대부분은 사이트 자체 작업입니다(확장 몫 약 ${share}% 이하). 재생목록·탭을 줄이면 나아질 수 있습니다.`);
  else if (ours > 1500) lines.push(`→ 판단: 확장 기능이 시간을 많이 씁니다. 위에서 가장 큰 항목을 '이 사이트'에서 꺼 보세요.`);
  else lines.push('→ 판단: 확장 기능이 쓰는 시간은 작습니다.');
  return lines.join('\n');
}

async function renderPage() {
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const hint = $('#pageHint');
  const list = $('#videoList');
  list.innerHTML = '';
  if (!tab || !/^https?:/.test(tab.url || '')) {
    renderSitePanel('generic');
    $('#pageSite').textContent = '이 페이지에서는 사용할 수 없어요';
    hint.textContent = '웹사이트 탭에서 확장프로그램 아이콘을 눌러 주세요';
    return;
  }
  currentTabId = tab.id;
  const host = new URL(tab.url).hostname;
  const siteId = SITE_HOSTS.find(([re]) => re.test(host))?.[1] || 'generic';
  renderSitePanel(siteId);
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
const PHASE = { encode: 'H.264·AAC 변환 중', caption: '피드 내용 넣는 중', shot: '피드 화면 찍는 중', queue: '대기 중', resolve: '원본 주소 찾는 중', download: '받는 중', mux: '영상·음성 합치는 중', save: '파일 저장 중' };

async function renderJobs() {
  const [{ jobs = [] }, { history = [] }] = await Promise.all([chrome.storage.session.get('jobs'), chrome.storage.local.get('history')]);
  const seen = new Set();
  const uniq = [...jobs, ...history].filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
  // 받는 중 → 대기 중(먼저 넣은 순서) 은 전부, 끝난 것은 최근 25개
  const active = uniq.filter((j) => j.state === 'running' && j.phase !== 'queue').sort((a, b) => a.created - b.created);
  const queued = uniq.filter((j) => j.state === 'running' && j.phase === 'queue').sort((a, b) => a.created - b.created);
  const ended = uniq.filter((j) => j.state !== 'running').sort((a, b) => b.created - a.created).slice(0, 25);
  const all = [...active, ...queued, ...ended];
  const ul = $('#jobList');
  ul.innerHTML = '';
  $('#jobEmpty').style.display = all.length ? 'none' : '';
  const sum = $('#jobSummary');
  if (sum) {
    sum.textContent = active.length || queued.length ? `받는 중 ${active.length}개 · 대기 중 ${queued.length}개` : '';
    sum.style.display = active.length || queued.length ? '' : 'none';
  }
  const cq = $('#cancelQueued');
  if (cq) {
    cq.style.display = queued.length ? '' : 'none';
    cq.textContent = `대기 ${queued.length}개 모두 취소`;
    cq.onclick = async () => {
      for (const j of queued) await chrome.runtime.sendMessage({ type: 'smd:cancel', jobId: j.id }).catch(() => {});
    };
  }
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
      const order = j.phase === 'queue' ? ` ${queued.indexOf(j) + 1}번째` : '';
      js.innerHTML = `${escapeHtml(meta.name)} · ${PHASE[j.phase] || '진행 중'}${order}${pct}${bytes ? ` · ${bytes}` : ''}${q}`;
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

// ── 설정 내보내기 / 불러오기 ──
{
  const msg = (text, ok) => {
    const el = $('#backupMsg');
    el.textContent = text;
    el.className = `backup-msg ${ok ? 'ok' : 'err'}`;
  };
  $('#exportSettings').addEventListener('click', async () => {
    try {
      const r = await chrome.storage.local.get('settings');
      const blob = new Blob([JSON.stringify({ app: 'whale-video-downloader', version: chrome.runtime.getManifest().version, settings: r.settings || {} }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: '영상다운로더-설정.json', saveAs: true, conflictAction: 'uniquify' });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msg('설정 파일을 저장했습니다. 새로 설치한 뒤 "설정 불러오기"로 되살릴 수 있습니다.', true);
    } catch (err) {
      msg(`설정 내보내기 실패(파일 저장 단계): ${err?.message || err} → 다운로드 폴더 권한을 확인한 뒤 다시 누르세요.`, false);
    }
  });
  $('#importSettings').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch (err) {
      return msg(`설정 불러오기 실패(파일 읽기 단계): JSON 형식이 아닙니다 (${err?.message || err}) → "설정 내보내기"로 만든 파일을 고르세요.`, false);
    }
    const st = data?.settings && typeof data.settings === 'object' ? data.settings : null;
    if (!st || data.app !== 'whale-video-downloader') return msg('설정 불러오기 실패(내용 확인 단계): 이 확장프로그램의 설정 파일이 아닙니다 → "설정 내보내기"로 만든 파일을 고르세요.', false);
    try {
      await chrome.storage.local.set({ settings: { ...settings, ...st } });
      msg('설정을 불러왔습니다. 팝업을 다시 열면 바뀐 스위치가 보입니다.', true);
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      msg(`설정 불러오기 실패(저장 단계): ${err?.message || err} → 확장프로그램을 새로고침한 뒤 다시 시도하세요.`, false);
    }
  });
}
