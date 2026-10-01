// 다운로드 엔진: 원본 파일 복사, 영상+음성 병합, HLS → MP4 리먹스.
// 재인코딩은 하지 않는다. 서버가 준 압축 데이터를 그대로 옮겨 담기 때문에 화질 손실이 없다.
import * as MB from '../vendor/mediabunny.min.mjs';

export class StepError extends Error {
  constructor(step, reason, action, detail) {
    super(`[${step}] ${reason}`);
    this.name = 'StepError';
    this.step = step;
    this.reason = reason;
    this.action = action;
    this.detail = detail ? String(detail).slice(0, 400) : '';
  }
  toJSON() {
    return { step: this.step, reason: this.reason, action: this.action, detail: this.detail };
  }
}

export const STEP = {
  FETCH: '영상 데이터 받기',
  PARSE: '영상 형식 분석',
  MUX: '영상·음성 합치기',
  WRITE: '파일 쓰기',
};

const MB_CHUNK = 8 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

export function describeHttp(status) {
  if (status === 401 || status === 403) {
    return {
      reason: `서버가 접근을 거부했습니다 (HTTP ${status}). 영상 주소가 만료됐거나 로그인·지역 제한이 걸린 영상입니다.`,
      action: '페이지를 새로고침(F5)한 뒤 다시 다운로드하세요. 로그인이 필요한 영상이면 해당 사이트에 로그인 후 시도하세요.',
    };
  }
  if (status === 404 || status === 410) {
    return {
      reason: `영상 주소를 찾을 수 없습니다 (HTTP ${status}). 삭제됐거나 주소가 만료됐습니다.`,
      action: '페이지를 새로고침한 뒤 다시 시도하세요.',
    };
  }
  if (status === 429) {
    return {
      reason: '요청이 너무 많아 서버가 잠시 차단했습니다 (HTTP 429).',
      action: '1~2분 기다렸다가 다시 시도하세요.',
    };
  }
  if (status >= 500) {
    return { reason: `영상 서버 오류입니다 (HTTP ${status}).`, action: '잠시 후 다시 시도하세요.' };
  }
  return { reason: `예상하지 못한 응답입니다 (HTTP ${status}).`, action: '페이지를 새로고침한 뒤 다시 시도하세요.' };
}

function toStepError(err, step) {
  if (err instanceof StepError) return err;
  if (err instanceof HttpError) {
    const d = describeHttp(err.status);
    return new StepError(STEP.FETCH, d.reason, d.action, err.url);
  }
  if (err?.name === 'AbortError') {
    return new StepError(step, '사용자가 다운로드를 취소했습니다.', '필요하면 다시 다운로드 버튼을 누르세요.');
  }
  if (err?.name === 'QuotaExceededError') {
    return new StepError(STEP.WRITE, '디스크 공간이 부족합니다.', '저장 드라이브의 여유 공간을 확보한 뒤 다시 시도하세요.', err.message);
  }
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return new StepError(STEP.WRITE, '선택한 저장 폴더에 쓸 권한이 없습니다.', '확장프로그램 아이콘을 눌러 저장 폴더 권한을 다시 허용하세요.', err.message);
  }
  if (err instanceof TypeError && /fetch|network|Failed/i.test(err.message)) {
    return new StepError(STEP.FETCH, '네트워크 연결이 끊겼거나 영상 서버에 연결할 수 없습니다.', '인터넷 연결을 확인한 뒤 다시 시도하세요.', err.message);
  }
  return new StepError(step, `처리 중 오류가 발생했습니다: ${err?.message || err}`, '페이지를 새로고침한 뒤 다시 시도하세요. 계속되면 팝업의 최근 기록에서 오류 내용을 확인하세요.', err?.stack);
}

// googlevideo 처럼 Range 헤더 대신 &range= 쿼리를 쓰는 CDN 지원.
function applyRange(url, start, end, rangeParam) {
  if (!rangeParam) return url;
  const u = new URL(url);
  u.searchParams.set('range', `${start}-${end}`);
  return u.href;
}

const PARAM_CHUNK = 10 * 1024 * 1024;

export function makeFetchFn({ rangeParam = false, size = 0, credentials = 'include', counter, signal } = {}) {
  return async (input, init = {}) => {
    let url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
    const range = headers.get('Range');
    let start = -1;
    if (rangeParam && range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        start = Number(m[1]);
        // 열린 범위(bytes=N-)는 10MB 조각으로 끊어 요청한다. 응답이 끝나면 mediabunny 가 이어서 다시 요청한다.
        let end = m[2] ? Number(m[2]) : start + PARAM_CHUNK - 1;
        if (size) end = Math.min(end, size - 1);
        url = applyRange(url, start, end, true);
        headers.delete('Range');
      }
    }
    const res = await fetch(url, {
      ...init,
      headers,
      credentials,
      cache: 'no-store',
      signal: init.signal || signal,
    });
    if (!res.ok && res.status !== 206) throw new HttpError(res.status, url);
    if (start >= 0 && res.status === 200) {
      // range 쿼리로 부분 응답이 200 으로 온다: mediabunny 가 206 으로 이해하도록 맞춘다.
      const len = Number(res.headers.get('content-length') || 0);
      const h = new Headers(res.headers);
      h.set('Content-Range', `bytes ${start}-${start + Math.max(len, 1) - 1}/${size || '*'}`);
      return wrapCount(new Response(res.body, { status: 206, headers: h }), counter);
    }
    return wrapCount(res, counter);
  };
}

function wrapCount(res, counter) {
  if (!counter || !res.body) return res;
  const counting = new TransformStream({
    transform(chunk, ctrl) {
      counter.bytes += chunk.byteLength;
      ctrl.enqueue(chunk);
    },
  });
  return new Response(res.body.pipeThrough(counting), { status: res.status, statusText: res.statusText, headers: res.headers });
}

function retryDelay(previousAttempts, error) {
  if (error instanceof HttpError) {
    if (error.status === 429 || error.status >= 500) return previousAttempts < 3 ? 1 + previousAttempts * 2 : null;
    return null;
  }
  return previousAttempts < 3 ? 1 + previousAttempts : null;
}

function urlSource(stream, opts) {
  return new MB.UrlSource(stream.url, {
    fetchFn: makeFetchFn({ rangeParam: !!stream.rangeParam, size: Number(stream.size) || 0, credentials: stream.credentials || 'include', counter: opts.counter, signal: opts.signal }),
    getRetryDelay: retryDelay,
    parallelism: 3,
    maxCacheSize: 48 * 1024 * 1024,
  });
}

// DASH SegmentTemplate 처럼 조각 파일로 나뉜 스트림: 초기화 조각 + 미디어 조각을 이어 붙여 하나의 파일로 만든다.
async function segmentsBlob(stream, { counter, signal }) {
  const urls = [stream.init, ...(stream.segments || [])].filter(Boolean);
  const parts = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      let lastErr;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(urls[i], { credentials: stream.credentials || 'include', cache: 'no-store', signal });
          if (!res.ok) throw new HttpError(res.status, urls[i]);
          const buf = await res.arrayBuffer();
          counter.bytes += buf.byteLength;
          parts[i] = new Blob([buf]);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (err?.name === 'AbortError') throw err;
          const delay = retryDelay(attempt, err);
          if (delay == null) break;
          await new Promise((r) => setTimeout(r, delay * 1000));
        }
      }
      if (lastErr) throw lastErr;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return new Blob(parts);
}

async function sourceFor(stream, opts) {
  if (stream.segments?.length) return new MB.BlobSource(await segmentsBlob(stream, opts));
  return urlSource(stream, opts);
}

// ─────────────────────────────── 원본 파일 그대로 복사 ───────────────────────────────

async function fetchRange(url, start, end, stream, signal, read = true) {
  const rangeParam = !!stream.rangeParam;
  const target = applyRange(url, start, end, rangeParam);
  const headers = rangeParam ? {} : { Range: `bytes=${start}-${end}` };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(target, { headers, credentials: stream.credentials || 'include', cache: 'no-store', signal });
      if (!res.ok) throw new HttpError(res.status, target);
      if (!read) return { res };
      const buf = new Uint8Array(await res.arrayBuffer());
      return { res, buf };
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') throw err;
      const delay = retryDelay(attempt, err);
      if (delay == null) throw err;
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  throw lastErr;
}

export async function copyFile(stream, writer, { onProgress, signal, counter }) {
  const url = stream.url;
  let total = Number(stream.size) || 0;

  // 1) 첫 조각을 범위 요청으로 받아 서버의 Range 지원 여부와 전체 크기를 확인한다.
  const firstEnd = (total ? Math.min(total, MB_CHUNK) : MB_CHUNK) - 1;
  let res;
  try {
    ({ res } = await fetchRange(url, 0, firstEnd, stream, signal, false));
  } catch (err) {
    throw toStepError(err, STEP.FETCH);
  }
  const mime = res.headers.get('content-type') || '';
  const ranged = res.status === 206 || (stream.rangeParam && total > 0);

  if (!ranged) {
    // 서버가 Range 를 무시하고 전체 파일(200)을 보냈다 → 메모리에 쌓지 않고 받는 대로 파일에 쓴다.
    const len = Number(res.headers.get('content-length')) || 0;
    let pos = 0;
    try {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value, pos);
        pos += value.byteLength;
        counter.bytes += value.byteLength;
        onProgress?.({ phase: 'download', bytes: pos, total: len, percent: len ? (pos / len) * 100 : null });
      }
    } catch (err) {
      throw toStepError(err, STEP.FETCH);
    }
    if (!pos) throw new StepError(STEP.FETCH, '영상 서버가 빈 파일을 보냈습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.', url);
    if (len && pos < len) throw new StepError(STEP.FETCH, `파일을 끝까지 받지 못했습니다 (${pos}/${len} 바이트).`, '네트워크 상태를 확인하고 다시 시도하세요.', url);
    onProgress?.({ phase: 'download', bytes: pos, total: pos, percent: 100 });
    return { bytes: pos, mime };
  }

  const cr = res.headers.get('content-range');
  if (cr) {
    const m = /\/(\d+)\s*$/.exec(cr);
    if (m) total = Number(m[1]);
  }
  let first;
  try {
    first = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    throw toStepError(err, STEP.FETCH);
  }
  await writer.write(first, 0);
  let position = first.byteLength;
  counter.bytes += position;
  if (!total) total = position; // 크기를 모르면 첫 조각이 전부다.
  onProgress?.({ phase: 'download', bytes: position, total, percent: (position / total) * 100 });

  // 2) 나머지를 최대 4개 병렬로 받되, 파일에는 순서대로 쓴다.
  const parallel = 4;
  const pending = new Map();
  let nextStart = position;
  const schedule = () => {
    while (pending.size < parallel && nextStart < total) {
      const s = nextStart;
      const e = Math.min(total, s + MB_CHUNK) - 1;
      nextStart = e + 1;
      const p = fetchRange(url, s, e, stream, signal);
      p.catch(() => {}); // 순서대로 기다리기 전에 실패해도 처리되지 않은 거부로 남지 않게
      pending.set(s, p);
    }
  };
  schedule();
  while (position < total) {
    const job = pending.get(position);
    if (!job) break;
    let got;
    try {
      got = await job;
    } catch (err) {
      throw toStepError(err, STEP.FETCH);
    }
    pending.delete(position);
    if (!got.buf.byteLength) {
      throw new StepError(STEP.FETCH, '영상 서버가 빈 데이터를 보냈습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.', url);
    }
    await writer.write(got.buf, position);
    position += got.buf.byteLength;
    counter.bytes += got.buf.byteLength;
    onProgress?.({ phase: 'download', bytes: position, total, percent: (position / total) * 100 });
    schedule();
  }
  if (position < total) {
    throw new StepError(STEP.FETCH, `파일을 끝까지 받지 못했습니다 (${position}/${total} 바이트).`, '네트워크 상태를 확인하고 다시 시도하세요.', url);
  }
  return { bytes: position, mime };
}

// ─────────────────────────────── 패킷 복사 먹싱 ───────────────────────────────

async function trackDuration(track) {
  try {
    const d = await track.getDurationFromMetadata();
    if (d && Number.isFinite(d)) return d;
  } catch {}
  try {
    return await track.computeDuration();
  } catch {
    return 0;
  }
}

async function pickBestVideo(input, prefer) {
  const tracks = await input.getVideoTracks();
  if (!tracks.length) return null;
  const scored = [];
  for (const t of tracks) {
    let w = 0, h = 0, br = 0, codec = null;
    try { w = await t.getDisplayWidth(); h = await t.getDisplayHeight(); } catch {}
    try { br = (await t.getBitrate()) || 0; } catch {}
    try { codec = await t.getCodec(); } catch {}
    const compat = codec === 'avc' ? 1 : 0;
    scored.push({ t, area: w * h, br, compat, w, h, codec });
  }
  scored.sort((a, b) =>
    prefer === 'compat'
      ? b.compat - a.compat || b.area - a.area || b.br - a.br
      : b.area - a.area || b.br - a.br || b.compat - a.compat,
  );
  return scored[0];
}

async function pickBestAudio(input, videoTrack) {
  let tracks = [];
  if (videoTrack) {
    try {
      tracks = (await videoTrack.getPairableTracks()).filter((t) => t.isAudioTrack());
    } catch {}
  }
  if (!tracks.length) tracks = await input.getAudioTracks();
  if (!tracks.length) return null;
  let best = null;
  for (const t of tracks) {
    let br = 0;
    try { br = (await t.getBitrate()) || 0; } catch {}
    const codec = await t.getCodec().catch(() => null);
    const score = br + (codec === 'aac' ? 1 : 0);
    if (!best || score > best.score) best = { t, score };
  }
  return best.t;
}

async function copyPackets({ video, audio, writable, onProgress, counter, signal, title }) {
  if (!video && !audio) {
    throw new StepError(STEP.PARSE, '영상에서 재생 가능한 트랙을 찾지 못했습니다.', '다른 화질이 있는 영상인지 확인하고 페이지를 새로고침한 뒤 다시 시도하세요.');
  }
  const output = new MB.Output({
    format: new MB.Mp4OutputFormat({ fastStart: false }),
    target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
  });
  let vSrc = null;
  let aSrc = null;
  let vConfig = null;
  let aConfig = null;
  const duration = Math.max(video ? await trackDuration(video) : 0, audio ? await trackDuration(audio) : 0);

  if (video) {
    const codec = await video.getCodec();
    if (!codec) throw new StepError(STEP.PARSE, '지원하지 않는 영상 코덱입니다.', '설정에서 "호환성 우선(H.264)"을 켜고 다시 시도하세요.');
    vSrc = new MB.EncodedVideoPacketSource(codec);
    let rotation = 0;
    try { rotation = await video.getRotation(); } catch {}
    output.addVideoTrack(vSrc, { rotation });
    vConfig = await video.getDecoderConfig();
  }
  if (audio) {
    const codec = await audio.getCodec();
    if (codec) {
      aSrc = new MB.EncodedAudioPacketSource(codec);
      let languageCode;
      try { languageCode = await audio.getLanguageCode(); } catch {}
      output.addAudioTrack(aSrc, languageCode && languageCode !== 'und' ? { languageCode } : {});
      aConfig = await audio.getDecoderConfig();
    }
  }
  if (title) {
    try { output.setMetadataTags({ title: String(title).slice(0, 200) }); } catch {}
  }
  await output.start();

  const iters = [];
  if (vSrc) iters.push({ it: new MB.EncodedPacketSink(video).packets(), src: vSrc, meta: { decoderConfig: vConfig }, first: true, kind: 'video' });
  if (aSrc) iters.push({ it: new MB.EncodedPacketSink(audio).packets(), src: aSrc, meta: { decoderConfig: aConfig }, first: true, kind: 'audio' });

  // 첫 패킷 시간이 음수(오디오 프라이밍)인 경우 전체를 같은 양만큼 밀어 0 이상으로 맞춘다.
  for (const s of iters) {
    const r = await s.it.next();
    s.cur = r.done ? null : r.value;
  }
  const minStart = Math.min(...iters.filter((s) => s.cur).map((s) => s.cur.timestamp), 0);
  const shift = minStart < 0 ? -minStart : 0;

  let lastReport = 0;
  let maxTs = 0;
  let packets = 0;
  while (true) {
    if (signal?.aborted) {
      await output.cancel().catch(() => {});
      throw new DOMException('aborted', 'AbortError');
    }
    let pick = null;
    for (const s of iters) if (s.cur && (!pick || s.cur.timestamp < pick.cur.timestamp)) pick = s;
    if (!pick) break;
    let packet = pick.cur;
    if (shift) packet = packet.clone({ timestamp: packet.timestamp + shift });
    await pick.src.add(packet, pick.first ? pick.meta : undefined);
    pick.first = false;
    packets++;
    maxTs = Math.max(maxTs, packet.timestamp);
    const r = await pick.it.next();
    pick.cur = r.done ? null : r.value;
    const now = Date.now();
    if (now - lastReport > 250) {
      lastReport = now;
      onProgress?.({ phase: 'mux', percent: duration ? Math.min(99, (maxTs / duration) * 100) : 0, bytes: counter.bytes });
    }
  }
  if (!packets) {
    await output.cancel().catch(() => {});
    throw new StepError(STEP.MUX, '영상 데이터가 비어 있습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.');
  }
  await output.finalize();
  onProgress?.({ phase: 'mux', percent: 100, bytes: counter.bytes });
  return { duration, packets };
}

export async function mergeStreams(job, writable, hooks) {
  const { counter, signal } = hooks;
  const inputs = [];
  try {
    const vIn = new MB.Input({ source: await sourceFor(job.video, { counter, signal }), formats: MB.ALL_FORMATS });
    inputs.push(vIn);
    const aIn = job.audio ? new MB.Input({ source: await sourceFor(job.audio, { counter, signal }), formats: MB.ALL_FORMATS }) : null;
    if (aIn) inputs.push(aIn);
    let video, audio;
    try {
      video = (await vIn.getPrimaryVideoTrack()) || null;
      audio = aIn ? await aIn.getPrimaryAudioTrack() : await vIn.getPrimaryAudioTrack();
    } catch (err) {
      throw toStepError(err, STEP.PARSE);
    }
    if (!video) throw new StepError(STEP.PARSE, '영상 스트림에서 비디오 트랙을 찾지 못했습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.');
    return await copyPackets({ video, audio, writable, ...hooks, title: job.title });
  } catch (err) {
    throw toStepError(err, STEP.MUX);
  } finally {
    for (const i of inputs) try { i.dispose(); } catch {}
  }
}

export async function remuxHls(job, writable, hooks) {
  const { counter, signal } = hooks;
  const input = new MB.Input({ source: urlSource(job, { counter, signal }), formats: MB.HLS_FORMATS });
  try {
    let best, audio;
    try {
      best = await pickBestVideo(input, job.prefer);
      audio = await pickBestAudio(input, best?.t);
    } catch (err) {
      if (err instanceof StepError) throw err;
      const e = toStepError(err, STEP.PARSE);
      if (!(err instanceof HttpError)) {
        e.reason = `HLS 재생목록을 해석하지 못했습니다: ${err?.message || err}`;
      }
      throw e;
    }
    if (best?.t && (await best.t.isLive().catch(() => false))) {
      throw new StepError(STEP.PARSE, '진행 중인 라이브 방송(끝나지 않은 HLS)은 다운로드할 수 없습니다.', '방송이 끝나 다시보기로 올라온 뒤 시도하세요.');
    }
    hooks.onQuality?.({ width: best?.w, height: best?.h, codec: best?.codec });
    return await copyPackets({ video: best?.t || null, audio, writable, ...hooks, title: job.title });
  } catch (err) {
    throw toStepError(err, STEP.MUX);
  } finally {
    try { input.dispose(); } catch {}
  }
}

// 단일 파일을 MP4 로 옮겨 담기 (예: .ts/.webm/.mov 원본을 MP4 로 통일할 때)
export async function remuxFile(job, writable, hooks) {
  return mergeStreams({ video: job, audio: null, title: job.title }, writable, hooks);
}

export { MB };
