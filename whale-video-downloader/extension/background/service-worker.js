// 서비스워커: 다운로드 요청 접수 → 원본 주소 확정 → 저장(브라우저 다운로드 또는 오프스크린 엔진) → 진행 상황 알림
import { getSettings, DEFAULT_SETTINGS } from '../shared/settings.js';
import { buildFilename, sanitizeFolder } from '../shared/filename.js';
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
    const list = [...jobs.values()].sort((a, b) => b.created - a.created).slice(0, 40).map(summary);
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

async function startBrowserDownload(job, url, settings, phase) {
  const opts = (name, sub) => ({ url, filename: sub ? `${sub}/${name}` : name, conflictAction: 'uniquify', saveAs: !!settings.askEveryTime });
  let id;
  try {
    id = await chrome.downloads.download(opts(job.filename, sanitizeFolder(settings.subfolder)));
  } catch (err) {
    if (!/invalid filename/i.test(err?.message || '')) {
      throw {
        step: '다운로드 시작',
        reason: `브라우저가 다운로드를 시작하지 못했습니다: ${err?.message || err}`,
        action: '팝업 → 저장 위치의 하위 폴더 이름을 확인하고 다시 시도하세요.',
      };
    }
    // 일부 시스템(UTF-8 이 아닌 로케일)은 한글 파일 이름을 거부한다 → 영문 이름으로 다시 시도
    const ext = job.filename.split('.').pop();
    const base = asciiOnly(job.filename.replace(/\.[^.]+$/, '')).replace(/^[\s\-_[\]]+|[\s\-_[\]]+$/g, '');
    const name = `${base || `${job.site}_${asciiOnly(job.request?.id) || Date.now()}`}.${ext}`;
    try {
      id = await chrome.downloads.download(opts(name, asciiOnly(sanitizeFolder(settings.subfolder)).replace(/^\/+|\/+$/g, '')));
      job.filename = name;
      job.warning = '이 시스템이 한글 파일·폴더 이름을 지원하지 않아 영문 이름으로 저장했습니다.';
    } catch (err2) {
      throw {
        step: '다운로드 시작',
        reason: `브라우저가 파일 이름을 거부했습니다 (${err2?.message || err2}).`,
        action: '팝업 → 저장 설정에서 하위 폴더 이름을 영문으로 바꾸고 다시 시도하세요.',
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
const RETRYABLE_STEPS = new Set(['영상 데이터 받기', '영상 형식 분석', '영상·음성 합치기', '원본 주소 확인']);

async function runEngine(job, d, settings) {
  await ensureOffscreen();
  const mode = settings.saveMode === 'folder' ? 'folder' : 'downloads';
  const result = await new Promise((resolve, reject) => {
    job.engine = { resolve, reject };
    toOffscreen({ type: 'run', jobId: job.id, desc: d, filename: job.filename, mode, prefer: settings.quality }).catch((err) =>
      reject({ step: '저장 엔진 시작', reason: `저장 엔진과 통신하지 못했습니다: ${err?.message || err}`, action: '확장프로그램을 껐다 켠 뒤 다시 시도하세요.' }),
    );
  });
  job.engine = null;
  if (result.kind === 'written') {
    job.where = `${result.folder || settings.folderName || '선택한 폴더'}${result.folder ? '/' : ''}${result.name}`;
    job.filename = result.name;
    return;
  }
  // OPFS 임시 파일 → 브라우저 다운로드 폴더로 이동
  if (result.warning) job.warning = result.warning;
  job.phase = 'save';
  job.percent = null;
  notify(job);
  try {
    await startBrowserDownload(job, result.blobUrl, settings, 'save');
  } finally {
    toOffscreen({ type: 'cleanup', jobId: job.id }).catch(() => {});
  }
}

async function attempt(job, d, settings) {
  const ruleId = d.headers ? await addHeaderRule(descriptorDomains(d), d.headers).catch(() => 0) : 0;
  try {
    // 브라우저 다운로드 관리자 요청에는 declarativeNetRequest 헤더가 붙지 않는다(실측).
    // Referer/User-Agent 가 필요한 CDN 은 처음부터 확장 엔진으로 받아 웨일 다운로드 목록에 실패 항목이 남지 않게 한다.
    const native = d.type === 'file' && settings.saveMode !== 'folder' && !d.rangeParam && d.credentials !== 'omit' && !headerOps(d.headers || {}).length;
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
  const settings = await getSettings();
  const req = job.request;
  let desc;
  try {
    if (req.info) desc = buildFromInfo(req.site, req.info, settings.quality, req.pageUrl);
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
  applyCredentials(desc, req);
  const chain = [desc, ...(desc.fallbacks || [])];
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const d = chain[i];
    job.quality = d.quality?.label || job.quality || '';
    job.filename = buildFilename(settings.filenameTemplate, {
      title: job.title || desc.title,
      site: job.site,
      siteName: job.siteName,
      id: req.id,
      author: req.author || desc.author,
      quality: job.quality,
    }, d.ext || 'mp4');
    try {
      await attempt(job, d, settings);
      return finish(job, 'done');
    } catch (err) {
      lastErr = err;
      if (job.canceled) return;
      const e = toErr(err, '다운로드');
      console.warn('[영상 다운로더] 시도 실패', i + 1, '/', chain.length, e);
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

// ───────────────────────────── 메시지 라우터 ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  switch (msg.type) {
    case 'smd:download': {
      const job = createJob(msg.request || {}, sender);
      sendResponse({ jobId: job.id });
      return;
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
    case 'smd:open-picker': {
      chrome.windows.create({ url: chrome.runtime.getURL(`picker/picker.html?mode=${msg.mode || 'pick'}`), type: 'popup', width: 480, height: 640, focused: true });
      sendResponse({ ok: true });
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

chrome.runtime.onInstalled.addListener(async (details) => {
  const r = await chrome.storage.local.get('settings');
  if (!r.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  if (details.reason === 'install') chrome.action.setBadgeText({ text: '' }).catch(() => {});
  // 설치·업데이트 전에 열려 있던 탭에도 바로 버튼이 뜨도록 스크립트를 넣는다(새로고침 불필요).
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => []);
  for (const t of tabs) {
    if (t.discarded) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content/hook.js'], world: 'MAIN' }).catch(() => {});
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content/sites.js', 'content/core.js'] }).catch(() => {});
  }
});
