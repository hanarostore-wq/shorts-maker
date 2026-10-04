// 오프스크린 문서: 영상 데이터를 받아 합치고(필요 시) 파일로 쓴다.
//   OPFS 임시 파일에 쓴 뒤 blob 주소를 서비스워커에 넘겨 웨일 다운로드 폴더(사용자가 지정한 폴더)로 저장한다.
//   사진은 원본 그대로, jpg·png·gif 가 아니면 PNG 로 변환한다.
import { copyFile, mergeStreams, remuxHls, StepError, STEP } from './engine.js';
import { summarize, captionImage, captionVideo, feedImage, canvasPng, coverVideo, introVideo, cropShot, needsKorean, translateToKorean, withTranslation } from './caption.js';

// ① 방식: 찍어 둔 피드 글 부분 캡처가 있으면 그것을, 없으면 요약 글자를 붙인다
async function overlayFor(cap, summary, warns) {
  // 한국어가 아니면 번역(실패하면 원문 그대로 + 안내)
  let ko = '';
  if (cap.translate && cap.text && needsKorean(cap.text)) {
    try {
      ko = await translateToKorean(cap.text);
    } catch (err) {
      warns.push(`피드 글 번역 실패(번역 단계): ${err?.message || err} → 원문 그대로 넣었습니다. 인터넷 연결을 확인하거나 설정에서 '피드 글 한국어 번역'을 끄세요.`);
    }
  }
  if (cap.shot?.textRect) {
    try {
      let image = await cropShot(cap.shot, 'textRect');
      if (ko) image = withTranslation(image, ko);
      return { ov: { image }, used: `[피드 글 캡처${ko ? '+번역' : ''}] ${ko ? ko.slice(0, 60) : summary || ''}`.trim() };
    } catch (err) {
      warns.push(`피드 글 캡처를 쓰지 못해 요약 글자로 넣었습니다 (${err?.message || err}).`);
    }
  } else if (cap.shotError) warns.push(`피드 글 캡처를 쓰지 못해 요약 글자로 넣었습니다 (${cap.shotError}).`);
  const text = ko ? await summarize(ko) : summary;
  return text ? { ov: { text }, used: ko ? `[번역] ${text}` : text } : { ov: null, used: '' };
}

const running = new Map(); // jobId -> { ac, target }
const finished = new Map(); // jobId -> { url, cleanup }
const reserved = new Set();

const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', flv: 'video/x-flv', mpg: 'video/mpeg', m4a: 'audio/mp4' };

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

// ── 사진 ──
function imageKind(head) {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'gif';
  return '';
}

async function toPng(blob) {
  let w, h, draw;
  try {
    const bmp = await createImageBitmap(blob);
    w = bmp.width;
    h = bmp.height;
    draw = (ctx) => ctx.drawImage(bmp, 0, 0);
  } catch {
    // SVG 등 createImageBitmap 이 못 읽는 형식은 <img> 로 그린다.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      w = img.naturalWidth || 1024;
      h = img.naturalHeight || 1024;
      draw = (ctx) => ctx.drawImage(img, 0, 0, w, h);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png'));
}

async function saveImage(jobId, desc) {
  let res;
  try {
    res = await fetch(desc.url, { credentials: desc.credentials || 'include', cache: 'no-store' });
  } catch (err) {
    throw new StepError('사진 저장', '사진 서버에 연결하지 못했습니다.', '인터넷 연결을 확인한 뒤 다시 시도하세요.', err?.message);
  }
  if (!res.ok) throw new StepError('사진 저장', `사진 서버가 HTTP ${res.status} 로 응답했습니다.`, '페이지를 새로고침한 뒤 다시 시도하세요.', desc.url);
  let blob = await res.blob();
  if (!blob.size) throw new StepError('사진 저장', '사진 데이터가 비어 있습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.');
  let ext = imageKind(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
  if (!ext) {
    try {
      blob = await toPng(blob);
    } catch (err) {
      throw new StepError('사진 변환', `이 사진 형식(${blob.type || '알 수 없음'})을 PNG 로 바꾸지 못했습니다.`, '다른 사진으로 시도하거나 페이지를 새로고침하세요.', err?.message);
    }
    ext = 'png';
  }
  let extra = null;
  let warning = '';
  let captionUsed = '';
  if (desc.caption?.overlay && (desc.caption.text || desc.caption.shot?.textRect) && ext !== 'gif') {
    try {
      const warns = [];
      const summary = desc.caption.text ? await summarize(desc.caption.text) : '';
      const { ov, used } = await overlayFor(desc.caption, summary, warns);
      warning = warns.join(' ');
      if (ov) {
        captionUsed = used;
        const orig = blob;
        blob = await captionImage(blob, ov, ext);
        if (desc.caption.keepOriginal) extra = { blobUrl: URL.createObjectURL(orig.slice(0, orig.size, MIME[ext] || 'image/png')), ext };
      }
    } catch (err) {
      warning = `사진에 요약 글자를 넣지 못해 원본으로 저장했습니다 (${err?.message || err}).`;
    }
  }
  const url = URL.createObjectURL(blob.slice(0, blob.size, MIME[ext] || 'image/png'));
  finished.set(jobId, { url, extraUrl: extra?.blobUrl });
  send({ type: 'smd:engine-result', jobId, kind: 'ready', blobUrl: url, size: blob.size, ext, extra, warning, captionUsed });
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
  let measured = 0;
  try {
    if (desc.type === 'image') {
      await saveImage(jobId, desc);
      return;
    }
    target = await opfsTarget(jobId, filename);
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
      measured = (await mergeStreams({ ...desc, title: desc.title }, target.writable, hooks))?.duration || 0;
    } else if (desc.type === 'hls') {
      measured = (await remuxHls({ url: desc.url, credentials: desc.credentials, prefer: desc.prefer || prefer, title: desc.title }, target.writable, hooks))?.duration || 0;
    } else {
      throw new StepError(STEP.PARSE, `지원하지 않는 다운로드 방식입니다 (${desc.type}).`, '확장프로그램을 최신 버전으로 업데이트하세요.');
    }
    running.delete(jobId);
    const file = await target.fh.getFile();
    if (!file.size) throw new StepError(STEP.WRITE, '저장된 파일 크기가 0 바이트입니다.', '다시 시도하세요.');
    // MIME 타입이 없으면 브라우저가 확장자를 .txt 등으로 바꿔 버린다 → 확장자에 맞는 타입을 붙인다(복사 없음).
    let ext = (filename.split('.').pop() || 'mp4').toLowerCase();
    let outFile = file;
    let cleanup = target.cleanup;
    let warning = '';
    const extras = [];
    const warns = [];
    let captionUsed = '';
    const cap = desc.caption;
    if (cap && (cap.overlay || cap.cover || cap.intro)) {
      const summary = cap.text ? await summarize(cap.text) : '';
      let overlay = null;
      captionUsed = summary;
      if (cap.overlay) {
        const o = await overlayFor(cap, summary, warns);
        overlay = o.ov;
        if (o.used) captionUsed = o.used;
      }
      let feed = null;
      if (cap.cover || cap.intro) {
        send({ type: 'smd:engine-progress', jobId, phase: 'shot', percent: null, quality });
        feed = await feedImage(cap, summary);
        if (feed.from === 'card') warns.push(`피드 화면 대신 요약 글자 카드를 썼습니다 (${feed.why}).`);
      }
      const origFile = file;
      const cleanups = [target.cleanup];
      // ①·③: 다시 인코딩 (③ 이 켜져 있으면 ① 글자도 같은 과정에서 함께 그린다)
      if (cap.intro || overlay) {
        const re = await opfsTarget(`${jobId}-cap`, filename);
        try {
          send({ type: 'smd:engine-progress', jobId, phase: 'caption', percent: 0, quality });
          const prog = (pct) => onProgress({ phase: 'caption', percent: Math.min(99, pct) });
          if (cap.intro) await introVideo(outFile, { image: feed.canvas, seconds: 3, overlay }, re.writable, prog);
          else await captionVideo(outFile, overlay, re.writable, prog);
          const reFile = await re.fh.getFile();
          if (!reFile.size) throw new Error('결과 파일이 비어 있음');
          outFile = reFile;
          ext = 'mp4';
          cleanups.push(re.cleanup);
        } catch (err) {
          await re.fail().catch(() => {});
          const what = cap.intro ? '영상 시작에 피드 화면 3초를 넣지' : overlay?.image ? '영상에 피드 글 캡처를 넣지' : '영상에 요약 글자를 넣지';
          warns.push(`${what} 못해 원본으로 저장했습니다 (${err?.message || err}).`);
        }
      }
      // ②: 재인코딩 없이 표지·설명 정보 + 같은 이름 PNG
      if (cap.cover) {
        let png = null;
        try {
          png = await canvasPng(feed.canvas);
        } catch (err) {
          warns.push(`피드 스크린샷 PNG 를 만들지 못했습니다 (${err?.message || err}).`);
        }
        if (png) {
          extras.push({ blobUrl: URL.createObjectURL(png), ext: 'png', suffix: '', label: '피드 스크린샷 PNG' });
          const cv = await opfsTarget(`${jobId}-cov`, filename);
          try {
            await coverVideo(outFile, { cover: png, title: desc.title || '', comment: [cap.text, cap.pageUrl].filter(Boolean).join('\n\n') }, cv.writable);
            const cvFile = await cv.fh.getFile();
            if (!cvFile.size) throw new Error('결과 파일이 비어 있음');
            outFile = cvFile;
            ext = 'mp4';
            cleanups.push(cv.cleanup);
          } catch (err) {
            await cv.fail().catch(() => {});
            warns.push(`영상 표지에 피드 화면을 넣지 못했습니다(스크린샷 PNG 는 옆에 저장) (${err?.message || err}).`);
          }
        }
      }
      if (outFile !== origFile && cap.keepOriginal && (cap.overlay || cap.intro)) {
        const oext = (filename.split('.').pop() || 'mp4').toLowerCase();
        extras.push({ blobUrl: URL.createObjectURL(origFile.slice(0, origFile.size, MIME[oext] || 'video/mp4')), ext: oext, suffix: ' (원본)', label: '원본 영상' });
      }
      cleanup = async () => {
        for (const c of cleanups) await c().catch(() => {});
      };
    }
    warning = warns.join(' ');
    const url = URL.createObjectURL(outFile.slice(0, outFile.size, MIME[ext] || 'video/mp4'));
    finished.set(jobId, { url, cleanup, extraUrls: extras.map((x) => x.blobUrl) });
    send({ type: 'smd:engine-result', jobId, kind: 'ready', blobUrl: url, size: outFile.size, quality, duration: measured, ext: ext !== (filename.split('.').pop() || '').toLowerCase() ? ext : undefined, extras, warning, captionUsed });
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
      if (f.extraUrl) URL.revokeObjectURL(f.extraUrl);
      for (const u of f.extraUrls || []) URL.revokeObjectURL(u);
      f.cleanup?.();
    }
    sendResponse({ ok: true });
  }
});

send({ type: 'smd:offscreen-ready' });
