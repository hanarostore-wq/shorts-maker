// 서비스워커: 다운로드 요청 접수 → 원본 주소 확정 → 저장(브라우저 다운로드 또는 오프스크린 엔진) → 진행 상황 알림
import { getSettings, DEFAULT_SETTINGS, effectiveSettings } from '../shared/settings.js';
import { buildFilename, sanitizeFolder, countryFolder, strictName } from '../shared/filename.js';
import { buildFromInfo } from './builders.js';
import { resolveBg } from './resolvers.js';

const jobs = new Map();
let jobSeq = 0;

// ───────────────────────────── 진행 상황 공유 ─────────────────────────────
function summary(job) {
  return {
    id: job.id,
    site: job.site,
    siteName: job.siteName,
    title: job.title,
    filename: job.filename || '',
    state: job.state, // running | done | error | canceled
    phase: job.phase, // resolve | download | mux | save
    percent: job.percent ?? null,
    bytes: job.bytes || 0,
    total: job.total || 0,
    quality: job.quality || '',
    where: job.where || '',
    warning: job.warning || '',
    captionUsed: job.captionUsed || '',
    error: job.error || null,
    downloadId: job.downloadId ?? null,
    pageUrl: job.pageUrl || '',
    created: job.created,
    finished: job.finished || 0,
  };
}

let persistTimer = 0;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = 0;
    // 받는 중·대기 중인 작업은 개수와 상관없이 전부, 끝난 작업은 최근 40개까지 팝업에 넘긴다
    const sorted = [...jobs.values()].sort((a, b) => b.created - a.created);
    const list = [...sorted.filter((j) => j.state === 'running'), ...sorted.filter((j) => j.state !== 'running').slice(0, 40)].map(summary);
    await chrome.storage.session.set({ jobs: list }).catch(() => {});
    const running = list.filter((j) => j.state === 'running').length;
    chrome.action.setBadgeText({ text: running ? String(running) : '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#7C4DFF' }).catch(() => {});
  }, 200);
}

function notify(job) {
  persist();
  if (job.tabId == null || job.tabId < 0) return;
  chrome.tabs.sendMessage(job.tabId, { type: 'smd:progress', job: summary(job) }, { frameId: job.frameId ?? 0 }).catch(() => {});
}

async function addHistory(job) {
  const r = await chrome.storage.local.get('history');
  const list = (r.history || []).filter((h) => h.id !== job.id);
  list.unshift(summary(job));
  await chrome.storage.local.set({ history: list.slice(0, 60) });
}

function finish(job, state, extra = {}) {
  if (job.state !== 'running') return;
  Object.assign(job, extra, { state, finished: Date.now() });
  if (state === 'done') job.percent = 100;
  notify(job);
  addHistory(job).catch(() => {});
  if (state === 'done' && job.dupKey && !job.request?.playMode) rememberDownload(job).catch(() => {});
  if (job.request?.playMode) playReady(job, state).catch(() => {});
}

// 팟플레이어 재생용으로 받은 파일: 기본 재생 프로그램으로 열어 보고, 결과를 페이지에 알린다. 재생용 파일은 최근 3개만 남긴다.
async function playReady(job, state) {
  const tell = (m) => job.tabId >= 0 && chrome.tabs.sendMessage(job.tabId, { type: 'smd:play-ready', ...m }, { frameId: job.frameId ?? 0 }).catch(() => {});
  if (state !== 'done') return tell({ error: job.error || { step: '재생용 파일 받기', reason: '받기에 실패했습니다.', action: '다운로드 버튼으로 받아서 재생하세요.' } });
  let opened = false;
  try {
    if (job.downloadId != null && chrome.downloads.open) {
      await chrome.downloads.open(job.downloadId);
      opened = true;
    }
  } catch {}
  tell({ opened, where: job.where || '' });
  const { playFiles = [] } = await chrome.storage.local.get('playFiles').catch(() => ({}));
  const list = [...playFiles.filter((id) => id !== job.downloadId), job.downloadId].filter((x) => x != null);
  for (const id of list.slice(0, -3)) {
    await chrome.downloads.removeFile(id).catch(() => {});
    await chrome.downloads.erase({ id }).catch(() => {});
  }
  await chrome.storage.local.set({ playFiles: list.slice(-3) }).catch(() => {});
}

// ───────────── 중복 다운로드 막기 ─────────────
// 받은 파일을 '사이트+게시물·영상 ID'(사진은 원본 주소)로 기억해 두고, 같은 것을 다시 받으려 하면
// 웨일 다운로드 기록으로 파일이 아직 있는지 확인한다. 있으면 받지 않고 안내(다시 받기 가능), 지워졌으면 그냥 받는다.
const REG_KEY = 'dlRegistry';
const REG_MAX = 5000;
function dupKeyOf(req, desc) {
  if (desc?.type === 'image' || req.kind === 'image') return `img:${String(desc?.url || req.info?.image?.url || '').replace(/#.*$/, '')}`;
  if (req.id) return `${req.site}:${req.id}`;
  const u = String(desc?.url || req.pageUrl || '').replace(/[?#].*$/, '');
  return u ? `${req.site}:${u}` : '';
}
async function rememberDownload(job) {
  const r = await chrome.storage.local.get(REG_KEY);
  const reg = r[REG_KEY] || {};
  reg[job.dupKey] = { downloadId: job.downloadId ?? null, where: job.where || '', filename: job.filename || '', title: job.title || '', t: Date.now() };
  const keys = Object.keys(reg);
  if (keys.length > REG_MAX) for (const k of keys.sort((a, b) => reg[a].t - reg[b].t).slice(0, keys.length - REG_MAX)) delete reg[k];
  await chrome.storage.local.set({ [REG_KEY]: reg });
}
// 이미 받은 파일이면 그 정보를, 아니면 null
async function findDuplicate(key) {
  if (!key) return null;
  const reg = (await chrome.storage.local.get(REG_KEY))[REG_KEY] || {};
  const rec = reg[key];
  if (!rec) return null;
  let item = null;
  if (rec.downloadId != null) {
    // 웨일(크롬)은 search 를 불러야 파일이 남아 있는지 확인을 시작하고, 결과는 조금 뒤에 반영된다 → 한 번 묻고 잠깐 기다렸다 다시 묻는다
    const first = (await chrome.downloads.search({ id: rec.downloadId }).catch(() => []))[0] || null;
    if (first && first.exists !== false) {
      // 확인 결과(onChanged 의 exists 변경)를 최대 2초 기다리며 중간중간 다시 조회한다(바쁠 때 느림)
      const t0 = Date.now();
      item = first;
      while (Date.now() - t0 < 2000) {
        await new Promise((resolve) => {
          const t = setTimeout(done, 400);
          function onChanged(d) {
            if (d.id === rec.downloadId && d.exists) done();
          }
          function done() {
            clearTimeout(t);
            chrome.downloads.onChanged.removeListener(onChanged);
            resolve();
          }
          chrome.downloads.onChanged.addListener(onChanged);
        });
        item = (await chrome.downloads.search({ id: rec.downloadId }).catch(() => []))[0] || null;
        if (!item || item.exists === false) break;
      }
    } else item = first;
  }
  // 다운로드 기록에 있고 파일이 지워졌으면 → 다시 받아도 됨(기억 지움)
  if (item && (item.exists === false || item.state === 'interrupted')) {
    delete reg[key];
    await chrome.storage.local.set({ [REG_KEY]: reg });
    return null;
  }
  return { ...rec, where: item?.filename || rec.where, verified: !!item };
}

function toErr(err, step) {
  if (err && err.reason) {
    return { step: err.step || step, reason: err.reason, action: err.action || '페이지를 새로고침한 뒤 다시 시도하세요.', detail: err.detail || '' };
  }
  return {
    step,
    reason: `예상하지 못한 오류: ${err?.message || err}`,
    action: '페이지를 새로고침한 뒤 다시 시도하세요. 계속되면 팝업의 최근 기록에서 오류를 확인하세요.',
    detail: String(err?.stack || '').slice(0, 400),
  };
}

// ───────────────────────────── 요청 헤더 (Referer/Origin/User-Agent) ─────────────────────────────
// 영상 CDN 대부분은 원래 사이트에서 온 요청인지 Referer 로 확인한다. 브라우저 fetch 는 Referer 를 바꿀 수 없어서
// declarativeNetRequest 세션 규칙으로 확장프로그램 자신의 요청(탭 없음)에만 붙인다.
let ruleSeq = 1000;
const baseDomain = (host) => {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const sld = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  if (tld.length === 2 && /^(co|com|net|org|gov|ac|or|ne|go)$/.test(sld)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
};

function headerOps(h) {
  const ops = [];
  if (h.referer) ops.push({ header: 'referer', operation: 'set', value: h.referer });
  if (h.origin) ops.push({ header: 'origin', operation: 'set', value: h.origin });
  if (h.ua) ops.push({ header: 'user-agent', operation: 'set', value: h.ua });
  if (h.stripOrigin) {
    ops.push({ header: 'origin', operation: 'remove' });
    ops.push({ header: 'referer', operation: 'remove' });
  }
  return ops;
}

async function addHeaderRule(domains, headers) {
  const ops = headerOps(headers || {});
  if (!ops.length || !domains.length) return 0;
  const id = ++ruleSeq;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 2,
        action: { type: 'modifyHeaders', requestHeaders: ops },
        condition: { requestDomains: [...new Set(domains)], tabIds: [chrome.tabs.TAB_ID_NONE] },
      },
    ],
  });
  return id;
}

async function removeRule(id) {
  if (id) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
}

async function withHeaders(domains, headers, fn) {
  const id = await addHeaderRule(domains, headers).catch(() => 0);
  try {
    return await fn();
  } finally {
    await removeRule(id);
  }
}

function descriptorDomains(d) {
  const urls = [];
  const take = (s) => {
    if (!s) return;
    if (s.url) urls.push(s.url);
    if (s.init) urls.push(s.init);
    if (s.segments?.length) urls.push(s.segments[0]);
  };
  take(d);
  take(d.video);
  take(d.audio);
  const out = [];
  for (const u of urls) {
    try { out.push(baseDomain(new URL(u).hostname)); } catch {}
  }
  return out;
}

// 이전 세션에서 남은 규칙 정리
chrome.declarativeNetRequest.getSessionRules().then((rules) => {
  const ids = rules.map((r) => r.id);
  if (ids.length) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}).catch(() => {});

// ───────────────────────────── 네트워크 감지 (일반 사이트·네이버용) ─────────────────────────────
const sniffs = new Map(); // tabId -> [{url, kind, ct, size, t, frameId}]
const SEGMENT = /\.(ts|m4s|aac|m4a|vtt|webvtt|key)(\?|$)|\/seg[-_]?\d+|[?&](range|bytestart)=/i;

function classify(url, ct) {
  if (/googlevideo\.com|youtube\.com\/api|\/videoplayback/.test(url)) return null;
  if (/apis\.naver\.com\/.*(vod\/play|playback)/.test(url)) return 'naver-api';
  if (/\.m3u8(\?|$)/i.test(url) || /mpegurl/i.test(ct)) return 'hls';
  if (/\.mpd(\?|$)/i.test(url) || /dash\+xml/i.test(ct)) return 'dash';
  if (SEGMENT.test(url)) return null;
  if (/^video\/(mp4|webm|quicktime|x-m4v|x-flv|x-matroska)/i.test(ct) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'file';
  return null;
}

chrome.webRequest.onResponseStarted.addListener(
  (d) => {
    if (d.tabId < 0 || !/^https?:/.test(d.url) || (d.statusCode !== 200 && d.statusCode !== 206)) return;
    const h = {};
    for (const x of d.responseHeaders || []) h[x.name.toLowerCase()] = x.value;
    const ct = h['content-type'] || '';
    const kind = classify(d.url, ct);
    if (!kind) return;
    const size = Number(/\/(\d+)\s*$/.exec(h['content-range'] || '')?.[1]) || Number(h['content-length']) || 0;
    const list = sniffs.get(d.tabId) || [];
    const key = d.url.replace(/([?&])(range|_|t)=[^&]*/g, '$1');
    const prev = list.find((s) => s.key === key);
    if (prev) {
      prev.t = Date.now();
      prev.size = Math.max(prev.size, size);
    } else {
      list.unshift({ key, url: d.url, kind, ct, size, t: Date.now(), frameId: d.frameId });
      if (list.length > 80) list.pop();
    }
    sniffs.set(d.tabId, list);
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders'],
);

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) sniffs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  sniffs.delete(tabId);
  tabVideos.delete(tabId);
});

const tabVideos = new Map(); // tabId -> Map(frameId -> {count, site})

// ───────────────────────────── 오프스크린 문서 (병합·저장 엔진) ─────────────────────────────
let creating = null;
let offscreenReady = null;
let markReady = null;

async function ensureOffscreen() {
  if (!chrome.offscreen) {
    throw { step: '저장 엔진 시작', reason: '이 브라우저 버전은 확장프로그램 저장 엔진(offscreen)을 지원하지 않습니다.', action: '웨일 브라우저를 최신 버전으로 업데이트하세요.' };
  }
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) {
    if (!offscreenReady) await pingOffscreen();
    return;
  }
  if (!creating) {
    offscreenReady = new Promise((r) => (markReady = r));
    creating = chrome.offscreen
      .createDocument({ url: 'offscreen/offscreen.html', reasons: ['BLOBS'], justification: '영상과 음성을 원본 화질 그대로 합쳐 파일로 저장합니다.' })
      .finally(() => (creating = null));
  }
  await creating;
  await Promise.race([offscreenReady, new Promise((r) => setTimeout(r, 3000))]);
}

async function pingOffscreen() {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' });
      if (r?.ok) {
        offscreenReady = Promise.resolve();
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
}

const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg });

// ───────────────────────────── 브라우저 다운로드 관리자 ─────────────────────────────
const INTERRUPT = {
  FILE_FAILED: ['파일 저장', '파일을 저장하지 못했습니다.', '저장 폴더가 존재하고 쓰기 가능한지 확인하세요.'],
  FILE_ACCESS_DENIED: ['파일 저장', '저장 폴더에 쓸 권한이 없습니다.', '팝업 → 저장 위치에서 다른 폴더를 지정하세요.'],
  FILE_NO_SPACE: ['파일 저장', '디스크 공간이 부족합니다.', '저장 드라이브의 여유 공간을 확보한 뒤 다시 시도하세요.'],
  FILE_NAME_TOO_LONG: ['파일 저장', '파일 이름 또는 경로가 너무 깁니다.', '팝업 → 파일 이름 형식을 "제목만"으로 바꾸거나 하위 폴더 이름을 짧게 하세요.'],
  FILE_TOO_LARGE: ['파일 저장', '저장 드라이브가 이 크기의 파일을 지원하지 않습니다 (FAT32 4GB 제한 등).', 'NTFS/exFAT 드라이브로 저장 위치를 바꾸세요.'],
  FILE_VIRUS_INFECTED: ['파일 저장', '백신 프로그램이 파일 저장을 차단했습니다.', '백신 예외 설정을 확인하세요.'],
  FILE_BLOCKED: ['파일 저장', '브라우저 보안 정책이 파일 저장을 차단했습니다.', '웨일 설정 → 다운로드 차단 정책을 확인하세요.'],
  FILE_SECURITY_CHECK_FAILED: ['파일 저장', '보안 검사에 실패해 저장이 차단됐습니다.', '다시 시도하세요.'],
  FILE_TOO_SHORT: ['영상 데이터 받기', '서버가 파일을 끝까지 보내지 않았습니다.', '다시 시도하세요.'],
  FILE_HASH_MISMATCH: ['영상 데이터 받기', '받은 파일이 손상됐습니다.', '다시 시도하세요.'],
  NETWORK_FAILED: ['영상 데이터 받기', '네트워크 오류로 다운로드가 끊겼습니다.', '인터넷 연결을 확인한 뒤 다시 시도하세요.'],
  NETWORK_TIMEOUT: ['영상 데이터 받기', '영상 서버 응답이 너무 느려 시간 초과됐습니다.', '잠시 후 다시 시도하세요.'],
  NETWORK_DISCONNECTED: ['영상 데이터 받기', '인터넷 연결이 끊겼습니다.', '연결을 확인한 뒤 다시 시도하세요.'],
  NETWORK_SERVER_DOWN: ['영상 데이터 받기', '영상 서버가 응답하지 않습니다.', '잠시 후 다시 시도하세요.'],
  NETWORK_INVALID_REQUEST: ['영상 데이터 받기', '영상 서버가 요청을 거부했습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.'],
  SERVER_FAILED: ['영상 데이터 받기', '영상 서버 오류로 다운로드가 실패했습니다.', '잠시 후 다시 시도하세요.'],
  SERVER_NO_RANGE: ['영상 데이터 받기', '영상 서버가 이어받기를 지원하지 않습니다.', '다시 시도하세요.'],
  SERVER_BAD_CONTENT: ['영상 데이터 받기', '영상 주소가 만료됐거나 잘못된 응답을 받았습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.'],
  SERVER_UNAUTHORIZED: ['영상 데이터 받기', '영상 서버가 로그인을 요구합니다 (HTTP 401).', '사이트에 로그인한 뒤 새로고침하고 다시 시도하세요.'],
  SERVER_CERT_PROBLEM: ['영상 데이터 받기', '영상 서버의 보안 인증서에 문제가 있습니다.', '잠시 후 다시 시도하세요.'],
  SERVER_FORBIDDEN: ['영상 데이터 받기', '영상 서버가 접근을 거부했습니다 (HTTP 403). 주소가 만료됐을 수 있습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.'],
  SERVER_UNREACHABLE: ['영상 데이터 받기', '영상 서버에 연결할 수 없습니다.', '인터넷 연결을 확인하세요.'],
  SERVER_CONTENT_LENGTH_MISMATCH: ['영상 데이터 받기', '받은 크기가 서버가 알려준 크기와 다릅니다.', '다시 시도하세요.'],
  SERVER_CROSS_ORIGIN_REDIRECT: ['영상 데이터 받기', '영상 서버가 다른 주소로 넘겼습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.'],
  USER_CANCELED: ['다운로드', '사용자가 다운로드를 취소했습니다.', '필요하면 다시 다운로드 버튼을 누르세요.'],
  USER_SHUTDOWN: ['다운로드', '브라우저가 종료되어 다운로드가 중단됐습니다.', '다시 다운로드하세요.'],
  CRASH: ['다운로드', '브라우저 오류로 다운로드가 중단됐습니다.', '다시 다운로드하세요.'],
};

const dlWaiters = new Map(); // downloadId -> {resolve, reject, job}

chrome.downloads.onChanged.addListener(async (delta) => {
  const w = dlWaiters.get(delta.id);
  if (!w) return;
  if (delta.state?.current === 'complete') {
    dlWaiters.delete(delta.id);
    const [item] = await chrome.downloads.search({ id: delta.id });
    w.resolve(item);
  } else if (delta.state?.current === 'interrupted') {
    dlWaiters.delete(delta.id);
    const [item] = await chrome.downloads.search({ id: delta.id });
    const code = item?.error || delta.error?.current || 'FAILED';
    const m = INTERRUPT[code] || ['다운로드', `다운로드가 중단됐습니다 (${code}).`, '다시 시도하세요.'];
    w.reject({ step: m[0], reason: m[1], action: m[2], detail: code, interrupt: code });
  }
});

async function waitDownload(job, id, phase) {
  const done = new Promise((resolve, reject) => dlWaiters.set(id, { resolve, reject, job }));
  const timer = setInterval(async () => {
    const [item] = await chrome.downloads.search({ id }).catch(() => []);
    if (!item) return;
    if (phase === 'download') {
      job.phase = 'download';
      job.bytes = item.bytesReceived;
      job.total = item.totalBytes > 0 ? item.totalBytes : 0;
      job.percent = job.total ? (item.bytesReceived / job.total) * 100 : null;
      notify(job);
    }
    if (item.state === 'complete' && dlWaiters.has(id)) {
      dlWaiters.get(id).resolve(item);
      dlWaiters.delete(id);
    }
  }, 600);
  try {
    return await done;
  } finally {
    clearInterval(timer);
  }
}

const asciiOnly = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();

// 종류별 폴더: 사진 / 영상 1분30초 이하 / 영상 1분30초 초과 (설정 → 저장 폴더 안에 자동으로 만들어진다)
export const FOLDERS = { image: '사진', short: '영상 1분30초 이하', long: '영상 1분30초 초과' };
// 가장 위 폴더: 사이트 이름(유튜브 / 블루스카이 / X …). 지원 목록 밖 사이트는 주소 이름(example.com)
const SITE_FOLDER = { 'X(트위터)': 'X', '네이버 TV·클립': '네이버' };
function siteFolderOf(job) {
  if (job.site === 'generic' || !job.siteName) {
    try {
      return new URL(job.pageUrl || job.request?.pageUrl || '').hostname.replace(/^www\./, '') || '기타 사이트';
    } catch {
      return '기타 사이트';
    }
  }
  return SITE_FOLDER[job.siteName] || job.siteName;
}

function saveFolder(job, settings) {
  if (job.request?.playMode) return '팟플레이어 재생';
  const parts = [sanitizeFolder(settings.subfolder)];
  // 사이트 폴더: '사이트별 폴더' 전체 켜기 > 지원 사이트 탭에서 사이트마다 넣은 폴더 이름(같은 이름이면 한 폴더로 합쳐짐) > 없으면 다운로드 폴더 그대로
  const own = (settings.siteFolderMap || {})[job.site];
  if (settings.siteFolders === true) parts.push(sanitizeFolder(siteFolderOf(job)));
  else if (own) parts.push(sanitizeFolder(own));
  if (settings.sortFolders !== false) parts.push(job.request?.kind === 'image' ? FOLDERS.image : (job.duration || 0) > 90 ? FOLDERS.long : FOLDERS.short);
  // 그 안에 나라별 하위 폴더 (한국 / 미국 / 중국 … / 기타). 파일 이름 앞 [국가] 표시와 같은 판단을 쓴다.
  if (settings.countryFolders !== false) parts.push(job.country || '기타');
  return parts.filter(Boolean).join('/');
}

async function startBrowserDownload(job, url, settings, phase) {
  const opts = (name, sub) => ({ url, filename: sub ? `${sub}/${name}` : name, conflictAction: 'uniquify', saveAs: !!settings.askEveryTime });
  let id;
  try {
    id = await chrome.downloads.download(opts(job.filename, saveFolder(job, settings)));
  } catch (err) {
    if (!/invalid filename/i.test(err?.message || '')) {
      throw {
        step: '다운로드 시작',
        reason: `브라우저가 다운로드를 시작하지 못했습니다: ${err?.message || err}`,
        action: '팝업 → 저장 위치의 하위 폴더 이름을 확인하고 다시 시도하세요.',
      };
    }
    // 브라우저가 파일 이름을 거부함(이모지·보이지 않는 글자·너무 긴 이름 등).
    //   폴더는 한글 그대로 두고 ① 이모지·기호를 뺀 짧은 한글 이름 → ② 영문 이름 순으로 다시 시도한다(영문 폴더는 만들지 않음).
    const folder = saveFolder(job, settings);
    const ext = job.filename.split('.').pop();
    const strict = strictName(job.filename);
    const base = asciiOnly(job.filename.replace(/\.[^.]+$/, '')).replace(/^[\s\-_[\]]+|[\s\-_[\]]+$/g, '');
    const ascii = `${base || `${job.site}_${asciiOnly(job.request?.id) || Date.now()}`}.${ext}`;
    let lastErr = err;
    for (const [name, note] of [[strict, '파일 이름에 브라우저가 허용하지 않는 글자(이모지·특수 기호 등)가 있어 그 글자를 빼고 저장했습니다.'], [ascii, '브라우저가 한글 파일 이름을 거부해 파일 이름만 영문으로 저장했습니다(폴더는 그대로).']]) {
      if (id != null || name === job.filename) continue;
      try {
        id = await chrome.downloads.download(opts(name, folder));
        job.filename = name;
        job.warning = note;
      } catch (e) {
        lastErr = e;
      }
    }
    if (id == null) {
      throw {
        step: '다운로드 시작',
        reason: `브라우저가 파일 이름을 거부했습니다 (${lastErr?.message || lastErr}).`,
        action: '팝업 → 저장 설정에서 하위 폴더 이름·파일 이름 형식을 확인하고 다시 시도하세요.',
      };
    }
  }
  job.downloadId = id;
  notify(job);
  const item = await waitDownload(job, id, phase);
  job.where = item?.filename || '';
  return item;
}

// ───────────────────────────── 작업 실행 ─────────────────────────────
const RETRYABLE_STEPS = new Set(['사진 저장', '영상 데이터 받기', '영상 형식 분석', '영상·음성 합치기', '원본 주소 확인', '임시 파일 읽기']);

async function runEngine(job, d, settings) {
  await ensureOffscreen();
  const mode = 'downloads';
  const result = await new Promise((resolve, reject) => {
    job.engine = { resolve, reject };
    toOffscreen({ type: 'run', jobId: job.id, desc: d, filename: job.filename, mode, prefer: settings.quality }).catch((err) =>
      reject({ step: '저장 엔진 시작', reason: `저장 엔진과 통신하지 못했습니다: ${err?.message || err}`, action: '확장프로그램을 껐다 켠 뒤 다시 시도하세요.' }),
    );
  });
  job.engine = null;
  // 사진은 실제 형식에 맞춰 확장자를 정한다(jpg/png/gif 그대로, 그 밖은 PNG 로 변환됨)
  if (result.ext) job.filename = job.filename.replace(/\.[^.]+$/, `.${result.ext}`);
  if (!job.duration && result.duration) job.duration = result.duration;
  if (result.warning) job.warning = result.warning;
  if (result.captionUsed) job.captionUsed = result.captionUsed;
  // OPFS 임시 파일 → 웨일 다운로드 폴더로 저장
  job.phase = 'save';
  job.percent = null;
  notify(job);
  try {
    await startBrowserDownload(job, result.blobUrl, settings, 'save');
    // 함께 저장할 파일: 원본은 이름 끝에 (원본), 피드 스크린샷은 같은 이름 .png
    const extras = result.extras || (result.extra ? [{ ...result.extra, suffix: ' (원본)' }] : []);
    for (const ex of extras) {
      if (!ex?.blobUrl) continue;
      const main = job.filename;
      const dl = job.downloadId;
      // 같은 이름 파일이 있어 '(1)' 처럼 바뀌어 저장됐으면 함께 저장하는 파일도 그 이름을 따른다
      const savedStem = (job.where || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '');
      const stem = savedStem ? main.replace(/[^/]+$/, savedStem) : main.replace(/\.[^.]+$/, '');
      job.filename = `${stem}${ex.suffix || ''}.${ex.ext || main.split('.').pop()}`;
      try {
        await startBrowserDownload(job, ex.blobUrl, settings, 'save');
      } catch (err) {
        job.warning = [job.warning, `${ex.label || '추가 파일'}을 저장하지 못했습니다 (${err?.reason || err?.message || err}).`].filter(Boolean).join(' ');
      } finally {
        job.filename = main;
        job.downloadId = dl;
      }
    }
  } finally {
    toOffscreen({ type: 'cleanup', jobId: job.id }).catch(() => {});
  }
}

async function attempt(job, d, settings) {
  const ruleId = d.headers ? await addHeaderRule(descriptorDomains(d), d.headers).catch(() => 0) : 0;
  try {
    // 브라우저 다운로드 관리자 요청에는 declarativeNetRequest 헤더가 붙지 않는다(실측).
    // Referer/User-Agent 가 필요한 CDN 은 처음부터 확장 엔진으로 받아 웨일 다운로드 목록에 실패 항목이 남지 않게 한다.
    const native = d.type === 'file' && !d.caption && !d.rangeParam && d.credentials !== 'omit' && !headerOps(d.headers || {}).length;
    if (native) {
      job.phase = 'download';
      notify(job);
      try {
        await startBrowserDownload(job, d.url, settings, 'download');
        return;
      } catch (err) {
        // 서버/네트워크 문제는 확장프로그램 엔진으로 한 번 더 시도(쿠키·Referer 처리 방식이 다름)
        if (!err?.interrupt || !/^(SERVER_|NETWORK_)/.test(err.interrupt) || job.canceled) throw err;
        job.downloadId = null;
      }
    }
    job.phase = d.type === 'file' ? 'download' : 'mux';
    job.percent = 0;
    notify(job);
    await runEngine(job, d, settings);
  } finally {
    await removeRule(ruleId);
  }
}

async function runJob(job) {
  const req = job.request;
  const settings = effectiveSettings(await getSettings(), req.site);
  let desc;
  try {
    if (req.info?.image) desc = buildImage(req.info.image, req.pageUrl);
    else if (req.info) desc = buildFromInfo(req.site, req.info, settings.quality, req.pageUrl);
    else if (req.bg) {
      desc = await resolveBg(req, {
        prefer: settings.quality,
        pageUrl: req.pageUrl,
        withHeaders,
        sniffed: () => (sniffs.get(job.tabId) || []).slice().sort((a, b) => b.t - a.t),
      });
    } else throw { step: '원본 주소 확인', reason: '영상 정보가 비어 있습니다.', action: '페이지를 새로고침한 뒤 다시 시도하세요.' };
  } catch (err) {
    return finish(job, 'error', { error: toErr(err, '원본 주소 확인') });
  }
  if (job.canceled) return;
  if (!job.title && desc.title) job.title = desc.title;
  // 같은 파일 중복 다운로드 막기
  job.dupKey = dupKeyOf(req, desc);
  if (settings.preventDuplicates !== false && !req.force && job.dupKey) {
    const running = [...jobs.values()].find((j) => j !== job && j.state === 'running' && j.dupKey === job.dupKey);
    if (running) {
      return finish(job, 'error', { error: { step: '중복 확인', reason: '같은 파일을 지금 받고 있습니다.', action: '받기가 끝날 때까지 기다리세요.', duplicate: true, running: true } });
    }
    const dup = await findDuplicate(job.dupKey).catch(() => null);
    if (dup) {
      const name = String(dup.where || dup.filename || '').split(/[\\/]/).pop();
      return finish(job, 'error', {
        error: {
          step: '중복 확인',
          reason: `이미 받은 파일입니다${name ? `: ${name}` : ''}${dup.verified ? '' : ' (웨일 다운로드 기록이 지워져 파일이 남아 있는지 확인하지 못했습니다)'}.`,
          action: '같은 파일을 또 받으려면 "다시 받기"를 누르세요.',
          duplicate: true,
          where: dup.where || '',
          downloadId: dup.verified ? dup.downloadId : null,
        },
      });
    }
  }
  job.duration = Number(req.duration) || Number(desc.duration) || 0;
  applyCredentials(desc, req);
  // 화면에서 본문을 못 찾았으면 사이트 데이터의 본문(desc.title)을 쓴다. 탭 제목은 쓰지 않는다.
  const capText = String(req.captionText ?? '').trim() || (desc.title && desc.title !== req.title ? String(desc.title).trim() : '') || (req.captionText === undefined ? String(req.title || '').trim() : '');
  const isImage = desc.type === 'image';
  const play = !!req.playMode; // 팟플레이어 재생용으로 받는 것은 글자 넣기 없이 원본 그대로
  const cap = {
    overlay: !play && settings.captionOnMedia !== false && (!!capText || (settings.captionAuthor !== false && !!(req.authorHandle || req.authorName))),
    // ②·③ 은 영상에만 (사진은 ① 만)
    cover: !play && !isImage && !!settings.captionCover,
    intro: !play && !isImage && !!settings.captionIntro,
  };
  if (cap.overlay || cap.cover || cap.intro) {
    const caption = {
      text: capText,
      ...cap,
      keepOriginal: !!settings.captionKeepOriginal,
      translate: settings.translateCaption !== false,
      shot: req.shotData || null,
      shotError: req.shotError || '',
      site: req.siteName || req.site || '',
      author: req.author || desc.author || '',
      authorName: settings.captionAuthor === false ? '' : req.authorName || '',
      authorHandle: settings.captionAuthor === false ? '' : req.authorHandle || '',
      pageUrl: req.pageUrl || '',
    };
    for (const d of [desc, ...(desc.fallbacks || [])]) d.caption = caption;
  }
  delete req.shotData;
  // 동시에 너무 많이 받지 않도록 최대 5개씩(사진 일괄 저장 대비)
  if (active >= MAX_ACTIVE) {
    job.phase = 'queue';
    notify(job);
    await new Promise((r) => waiting.push(r));
  }
  active++;
  try {
    await runChain(job, desc, settings, req);
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const MAX_ACTIVE = 5; // 동시에 받는 개수(예전 3개)
let active = 0;
const waiting = [];

async function runChain(job, desc, settings, req) {
  if (job.canceled) return;
  const chain = [desc, ...(desc.fallbacks || [])];
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const d = chain[i];
    job.quality = d.quality?.label || job.quality || '';
    // 나라 판단은 게시물 원문 본문으로(없으면 사이트 데이터의 본문 → 제목)
    const countryText = String(req.captionText || '').trim() || String(desc.title || '').trim() || `${job.title || ''} ${req.author || desc.author || ''}`;
    job.country = countryFolder(countryText, job.site);
    job.filename = buildFilename(settings.filenameTemplate, {
      title: job.title || desc.title,
      site: job.site,
      siteName: job.siteName,
      id: req.id,
      author: req.author || desc.author,
      quality: job.quality,
      ai: settings.aiLabel !== false && !!req.ai,
      countryText,
      flag: settings.flagPrefix === false ? false : settings.flagStyle === 'emoji' ? 'emoji' : 'name',
    }, d.ext || 'mp4');
    if (req.playMode) {
      // 재생용 파일: 짧은 영문 이름 · .m4v(일반 다운로드 .mp4 와 구분 → '이 형식 항상 열기'를 재생용 파일에만 켤 수 있음)
      const ext = !d.ext || d.ext === 'mp4' ? 'm4v' : d.ext;
      job.filename = `${job.site}-${String(req.id || Date.now()).replace(/[^\w-]/g, '').slice(0, 40) || Date.now()}.${ext}`;
    }
    try {
      await attempt(job, d, settings);
      return finish(job, 'done');
    } catch (err) {
      lastErr = err;
      if (job.canceled) return;
      const e = toErr(err, '다운로드');
      console.warn('[영상 다운로더] 시도 실패', i + 1, '/', chain.length, e);
      // 임시 파일 읽기 오류는 같은 주소로 한 번 더(새 임시 파일 이름으로)
      if (e.step === '임시 파일 읽기' && !job.staleRetried) {
        job.staleRetried = true;
        i--;
        continue;
      }
      if (!RETRYABLE_STEPS.has(e.step)) break;
    }
  }
  finish(job, 'error', { error: toErr(lastErr, '다운로드') });
}

// 쿠키는 페이지와 같은 사이트의 주소에만 붙인다(페이지 데이터로 받은 다른 사이트 주소에 사용자 쿠키를 보내지 않음).
// 네트워크 감지(sniff)로 찾은 주소는 페이지 플레이어가 이미 쿠키와 함께 받은 주소라 그대로 둔다.
function applyCredentials(desc, req) {
  let pageBase = '';
  try { pageBase = baseDomain(new URL(req.pageUrl).hostname); } catch {}
  const sniffed = req.bg?.kind === 'sniff';
  const fix = (s) => {
    if (!s || s.credentials) return;
    const u = s.url || s.init || s.segments?.[0];
    if (!u) return;
    let host = '';
    try { host = baseDomain(new URL(u).hostname); } catch {}
    s.credentials = sniffed || (pageBase && host === pageBase) ? 'include' : 'omit';
  };
  for (const d of [desc, ...(desc.fallbacks || [])]) {
    fix(d);
    fix(d.video);
    fix(d.audio);
  }
}

function buildImage(image, pageUrl) {
  let referer = '';
  try { referer = `${new URL(pageUrl).origin}/`; } catch {}
  const urls = [...new Set([image.url, ...(image.fallbacks || [])].filter(Boolean))];
  const mk = (url) => ({ type: 'image', url, ext: 'png', headers: referer && !/^(data|blob):/.test(url) ? { referer } : undefined, quality: { label: image.width ? `${image.width}×${image.height}` : '원본' } });
  return { ...mk(urls[0]), fallbacks: urls.slice(1).map(mk) };
}

// ②·③ 방식에 쓸 피드 화면 스크린샷 (보이는 탭 화면 → 게시물 영역은 저장 엔진에서 잘라 냄)
let lastShot = 0;
async function captureShot(req, sender) {
  if ((!req.shot && !req.textShot) || sender.tab?.windowId == null) return null;
  // captureVisibleTab 은 초당 2회 제한이 있다
  const wait = 550 - (Date.now() - lastShot);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastShot = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  return { dataUrl, rect: req.shot || null, textRect: req.textShot || null };
}

function createJob(request, sender) {
  const job = {
    id: `j${Date.now().toString(36)}${(++jobSeq).toString(36)}`,
    tabId: sender.tab?.id ?? -1,
    frameId: sender.frameId ?? 0,
    request,
    site: request.site,
    siteName: request.siteName,
    title: request.title,
    pageUrl: request.pageUrl,
    state: 'running',
    phase: 'resolve',
    percent: null,
    created: Date.now(),
  };
  jobs.set(job.id, job);
  notify(job);
  runJob(job).catch((err) => finish(job, 'error', { error: toErr(err, '다운로드') }));
  return job;
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job || job.state !== 'running') return false;
  job.canceled = true;
  if (job.downloadId != null) chrome.downloads.cancel(job.downloadId).catch(() => {});
  toOffscreen({ type: 'cancel', jobId: id }).catch(() => {});
  finish(job, 'canceled', { error: { step: '다운로드', reason: '사용자가 취소했습니다.', action: '필요하면 다시 다운로드하세요.' } });
  return true;
}

// ───────────────────────────── 팟플레이어로 재생 ─────────────────────────────
// 다운로드와 같은 방법으로 원본 주소를 찾은 뒤 potplayer:// 주소로 연다. 팟플레이어가 설치할 때 스스로 등록한 연결을 쓰므로
//   PC 설정(레지스트리)을 따로 바꾸지 않는다(업데이트 bat 에 연결 등록을 넣었더니 백신이 bat 실행을 막았음).
//   유튜브는 영상·음성이 나뉘어 있어 영상 페이지 주소를 넘긴다(팟플레이어가 유튜브 주소를 직접 재생).
export function playableUrl(req, desc) {
  if (req.site === 'youtube' && req.id) return `https://www.youtube.com/watch?v=${req.id}`;
  // 최고 화질이 영상·음성 나뉜 형식이면, 함께 받아 둔 예비 후보 중 소리까지 든 하나짜리 파일(인스타 등)을 쓴다
  // 팟플레이어는 사이트 쿠키·Referer 를 보낼 수 없다 → 그런 것이 필요한 주소(틱톡 등)는 넘기지 않는다(먼저 받아서 연다)
  const plain = (d) => !(d.headers && Object.values(d.headers).some(Boolean)) && d.credentials !== 'include';
  for (const d of [desc, ...((desc && desc.fallbacks) || [])]) {
    if ((d?.type === 'file' || d?.type === 'hls') && /^https?:\/\//.test(d.url || '') && plain(d)) return d.url;
  }
  return '';
}
async function playExternal(req, sender) {
  const settings = effectiveSettings(await getSettings(), req.site);
  let desc = null;
  try {
    if (req.site !== 'youtube') {
      if (req.info) desc = buildFromInfo(req.site, req.info, settings.quality, req.pageUrl);
      else if (req.bg) desc = await resolveBg(req, { prefer: settings.quality, pageUrl: req.pageUrl, withHeaders, sniffed: () => (sniffs.get(sender.tab?.id) || []).slice().sort((a, b) => b.t - a.t) });
    }
  } catch (err) {
    return { error: toErr(err, '원본 주소 확인') };
  }
  if (desc) applyCredentials(desc, req);
  const url = playableUrl(req, desc);
  if (!url) {
    // 바로 넘길 주소가 없음(쿠키·Referer 가 필요하거나 영상·음성이 나뉨) → 먼저 받아서 팟플레이어(기본 재생 프로그램)로 연다
    const job = createJob({ ...req, playMode: true, force: true, captionText: '' }, sender);
    return { downloading: true, jobId: job.id };
  }
  const target = `potplayer://${url}`;
  chrome.storage.session.set({ lastExternalPlay: { url, at: Date.now() } }).catch(() => {});
  try {
    await chrome.tabs.update(sender.tab.id, { url: target });
  } catch (err) {
    return { error: { step: '팟플레이어 실행', reason: `웨일이 팟플레이어 연결을 열지 못했습니다 (${err?.message || err}).`, action: '팟플레이어가 설치돼 있는지 확인하고, 웨일이 "외부 프로그램 열기(PotPlayer)"를 물으면 허용하세요.' } };
  }
  return { ok: true, url };
}

// ───────────────────────────── 메시지 라우터 ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  switch (msg.type) {
    case 'smd:download': {
      const req = msg.request || {};
      // 클릭한 순간의 화면을 먼저 찍어 둔다(스크롤하면 피드가 바뀌므로). 실패해도 다운로드는 진행.
      captureShot(req, sender)
        .then((shot) => {
          if (shot) req.shotData = shot;
        })
        .catch((err) => {
          req.shotError = `피드 화면 찍기 실패: ${err?.message || err}`;
        })
        .finally(() => {
          delete req.shot;
          delete req.textShot;
          const job = createJob(req, sender);
          sendResponse({ jobId: job.id });
        });
      return true;
    }
    case 'smd:play-external': {
      playExternal(msg.request || {}, sender).then(sendResponse, (err) => sendResponse({ error: toErr(err, '팟플레이어 재생') }));
      return true;
    }
    case 'smd:videos': {
      if (sender.tab?.id == null) return;
      const m = tabVideos.get(sender.tab.id) || new Map();
      m.set(sender.frameId ?? 0, { count: msg.count, site: msg.site });
      tabVideos.set(sender.tab.id, m);
      return;
    }
    case 'smd:sniff-count': {
      sendResponse({ count: (sniffs.get(sender.tab?.id) || []).length });
      return;
    }
    case 'smd:show-file': {
      const job = jobs.get(msg.jobId);
      const id = msg.downloadId ?? job?.downloadId;
      if (id != null) chrome.downloads.show(id);
      sendResponse({ ok: id != null });
      return;
    }
    case 'smd:tab-frames': {
      const m = tabVideos.get(msg.tabId);
      sendResponse({ frames: m ? [...m.entries()].map(([frameId, v]) => ({ frameId, ...v })) : [] });
      return;
    }
    case 'smd:job-status': {
      const job = jobs.get(msg.jobId);
      sendResponse(job ? summary(job) : null);
      return;
    }
    case 'smd:cancel': {
      sendResponse({ ok: cancelJob(msg.jobId) });
      return;
    }
    // ── 오프스크린 엔진 → 서비스워커 ──
    case 'smd:offscreen-ready': {
      markReady?.();
      offscreenReady = Promise.resolve();
      return;
    }
    case 'smd:engine-progress': {
      const job = jobs.get(msg.jobId);
      if (!job || job.state !== 'running') return;
      job.phase = msg.phase;
      job.percent = msg.percent ?? null;
      job.bytes = msg.bytes || job.bytes;
      job.total = msg.total || job.total;
      if (msg.quality) job.quality = msg.quality;
      notify(job);
      return;
    }
    case 'smd:engine-result': {
      const job = jobs.get(msg.jobId);
      if (job?.engine) job.engine.resolve(msg);
      else if (msg.kind === 'ready') toOffscreen({ type: 'cleanup', jobId: msg.jobId }).catch(() => {});
      return;
    }
    case 'smd:engine-error': {
      const job = jobs.get(msg.jobId);
      if (job?.engine) job.engine.reject(msg.error);
      return;
    }
  }
});

// 백업 복원이 끝난 뒤에 기본값·마이그레이션을 저장한다(둘이 동시에 쓰면 마이그레이션 표시가 지워질 수 있음)
restoreSettings().catch(() => {}).finally(() => getSettings().then((s) => chrome.storage.local.set({ settings: s })).catch(() => {}));

// 광고 차단 기능은 삭제했다(사용자 요청). 예전 버전이 남긴 광고 차단 규칙(9000~9099)은 지운다.
chrome.declarativeNetRequest.getDynamicRules().then((rules) => {
  const ids = rules.filter((r) => r.id >= 9000 && r.id < 9100).map((r) => r.id);
  if (ids.length) chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids }).catch(() => {});
}).catch(() => {});

// ───────────── 설정 기억(새 버전 설치·폴더 바꿔 다시 불러오기에도 유지) ─────────────
// 1) manifest 의 key 로 확장 ID 를 고정 → 같은 ID 의 저장소를 그대로 씀
// 2) 설정이 바뀔 때마다 웨일 동기화 저장소(storage.sync)에도 복사 → 지웠다가 다시 설치해도 되살림
async function restoreSettings() {
  const r = await chrome.storage.local.get('settings');
  if (r.settings) return false;
  const b = await chrome.storage.sync.get('settingsBackup').catch(() => ({}));
  if (b.settingsBackup && typeof b.settingsBackup === 'object') {
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...b.settingsBackup } });
    return true;
  }
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  return false;
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.settings?.newValue) chrome.storage.sync.set({ settingsBackup: c.settings.newValue }).catch((err) => console.warn('[영상 다운로더] 설정 백업 실패(동기화 저장소)', err?.message || err));
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await restoreSettings().catch(() => {});
  if (details.reason === 'install') chrome.action.setBadgeText({ text: '' }).catch(() => {});
  // 설치·업데이트 전에 열려 있던 탭에도 바로 버튼이 뜨도록 스크립트를 넣는다(새로고침 불필요).
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => []);
  for (const t of tabs) {
    if (t.discarded) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content/hook.js'], world: 'MAIN' }).catch(() => {});
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content/sites.js', 'content/core.js'] }).catch(() => {});
  }
});
