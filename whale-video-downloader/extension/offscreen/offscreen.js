// 오프스크린 문서: 영상 데이터를 받아 합치고(필요 시) 파일로 쓴다.
//   mode = 'folder'    → 사용자가 고른 폴더(File System Access)에 바로 저장
//   mode = 'downloads' → OPFS 임시 파일에 쓴 뒤 blob 주소를 서비스워커에 넘겨 브라우저 다운로드 폴더로 저장
import { copyFile, mergeStreams, remuxHls, StepError, STEP } from './engine.js';
import { idbGet, DIR_KEY } from '../shared/idb.js';

const running = new Map(); // jobId -> { ac, target }
const finished = new Map(); // jobId -> { url, cleanup }
const reserved = new Set();

const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', flv: 'video/x-flv', mpg: 'video/mpeg', m4a: 'audio/mp4' };

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

async function tmpDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('smd-tmp', { create: true });
}

// 이전 실행에서 남은 임시 파일 정리
(async () => {
  try {
    const dir = await tmpDir();
    for await (const [name] of dir.entries()) await dir.removeEntry(name).catch(() => {});
  } catch {}
})();

async function uniqueName(dir, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 1000; i++) {
    const n = i ? `${base} (${i})${ext}` : name;
    if (reserved.has(n)) continue;
    try {
      await dir.getFileHandle(n);
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        reserved.add(n);
        return n;
      }
      if (err?.name === 'TypeMismatchError') continue;
      throw err;
    }
  }
  throw new StepError(STEP.WRITE, '같은 이름의 파일이 너무 많습니다.', '저장 폴더를 정리하거나 파일 이름 형식을 바꾸세요.');
}

async function folderTarget(dir, filename) {
  const name = await uniqueName(dir, filename);
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  return {
    kind: 'folder',
    name,
    folder: dir.name,
    writable,
    async fail() {
      await writable.abort().catch(() => {});
      await dir.removeEntry(name).catch(() => {});
      reserved.delete(name);
    },
    release() {
      reserved.delete(name);
    },
  };
}

async function opfsTarget(jobId, filename) {
  const dir = await tmpDir();
  const tmpName = `${jobId}.part`;
  const fh = await dir.getFileHandle(tmpName, { create: true });
  const writable = await fh.createWritable();
  return {
    kind: 'opfs',
    name: filename,
    writable,
    fh,
    async fail() {
      await writable.abort().catch(() => {});
      await dir.removeEntry(tmpName).catch(() => {});
    },
    async cleanup() {
      await dir.removeEntry(tmpName).catch(() => {});
    },
    release() {},
  };
}

async function chooseTarget(jobId, filename, mode) {
  let warning = '';
  if (mode === 'folder') {
    let dir = null;
    try { dir = await idbGet(DIR_KEY); } catch {}
    let state = 'none';
    if (dir) {
      try { state = await dir.queryPermission({ mode: 'readwrite' }); } catch { state = 'denied'; }
    }
    if (state === 'granted') {
      try {
        return { target: await folderTarget(dir, filename), warning };
      } catch (err) {
        if (err instanceof StepError) throw err;
        warning = `선택한 폴더(${dir.name})에 파일을 만들지 못해 기본 다운로드 폴더에 저장했습니다 (${err?.name || err}). 폴더가 삭제·이동됐다면 팝업에서 저장 폴더를 다시 선택하세요.`;
      }
    } else if (state === 'none') {
      warning = '저장 폴더가 아직 선택되지 않아 기본 다운로드 폴더에 저장했습니다. 확장프로그램 아이콘 → 저장 위치 → "폴더 선택"을 누르세요.';
    } else {
      warning = `선택한 폴더(${dir.name})의 쓰기 권한이 만료되어(브라우저를 다시 켜면 한 번 더 허용해야 함) 기본 다운로드 폴더에 저장했습니다. 확장프로그램 아이콘 → 저장 위치 → "권한 다시 허용"을 누르세요.`;
    }
  }
  return { target: await opfsTarget(jobId, filename), warning };
}

async function run({ jobId, desc, filename, mode, prefer }) {
  const ac = new AbortController();
  const counter = { bytes: 0 };
  let last = 0;
  let quality = desc.quality?.label || '';
  const onProgress = (p) => {
    const now = Date.now();
    if (now - last < 250 && p.percent !== 100) return;
    last = now;
    send({ type: 'smd:engine-progress', jobId, phase: p.phase, percent: p.percent ?? null, bytes: p.bytes ?? counter.bytes, total: p.total || 0, quality });
  };
  let target;
  try {
    const chosen = await chooseTarget(jobId, filename, mode);
    target = chosen.target;
    running.set(jobId, { ac, target });
    const hooks = {
      counter,
      signal: ac.signal,
      onProgress,
      onQuality: (q) => {
        if (q?.height) {
          const short = Math.min(q.width || q.height, q.height);
          quality = short >= 2160 ? '4K' : `${short}p`;
        }
      },
    };
    if (desc.type === 'file') {
      const w = target.writable;
      await copyFile(desc, { write: (buf, position) => w.write({ type: 'write', position, data: buf }) }, hooks);
      await w.close();
    } else if (desc.type === 'merge') {
      await mergeStreams({ ...desc, title: desc.title }, target.writable, hooks);
    } else if (desc.type === 'hls') {
      await remuxHls({ url: desc.url, credentials: desc.credentials, prefer: desc.prefer || prefer, title: desc.title }, target.writable, hooks);
    } else {
      throw new StepError(STEP.PARSE, `지원하지 않는 다운로드 방식입니다 (${desc.type}).`, '확장프로그램을 최신 버전으로 업데이트하세요.');
    }
    running.delete(jobId);
    target.release();
    if (target.kind === 'folder') {
      send({ type: 'smd:engine-result', jobId, kind: 'written', name: target.name, folder: target.folder, quality });
      return;
    }
    const file = await target.fh.getFile();
    if (!file.size) throw new StepError(STEP.WRITE, '저장된 파일 크기가 0 바이트입니다.', '다시 시도하세요.');
    // MIME 타입이 없으면 브라우저가 확장자를 .txt 등으로 바꿔 버린다 → 확장자에 맞는 타입을 붙인다(복사 없음).
    const ext = (filename.split('.').pop() || 'mp4').toLowerCase();
    const url = URL.createObjectURL(file.slice(0, file.size, MIME[ext] || 'video/mp4'));
    finished.set(jobId, { url, cleanup: target.cleanup });
    send({ type: 'smd:engine-result', jobId, kind: 'ready', blobUrl: url, size: file.size, warning: chosen.warning, quality });
  } catch (err) {
    running.delete(jobId);
    await target?.fail().catch(() => {});
    const e = err instanceof StepError
      ? err.toJSON()
      : err?.name === 'AbortError'
        ? { step: '다운로드', reason: '사용자가 다운로드를 취소했습니다.', action: '필요하면 다시 다운로드하세요.' }
        : { step: STEP.WRITE, reason: `파일을 쓰는 중 오류가 발생했습니다: ${err?.message || err}`, action: '저장 위치 설정을 확인한 뒤 다시 시도하세요.', detail: String(err?.stack || '').slice(0, 300) };
    send({ type: 'smd:engine-error', jobId, error: e });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'ping') {
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'run') {
    run(msg);
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'cancel') {
    running.get(msg.jobId)?.ac.abort();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'cleanup') {
    const f = finished.get(msg.jobId);
    if (f) {
      finished.delete(msg.jobId);
      URL.revokeObjectURL(f.url);
      f.cleanup?.();
    }
    sendResponse({ ok: true });
  }
});

send({ type: 'smd:offscreen-ready' });
