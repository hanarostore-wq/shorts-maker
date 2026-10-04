// 저장할 사진·영상의 빈 공간에 피드 내용 요약을 써 넣는다.
//  - 요약: 게시물 글의 첫 문장 중심으로 짧게 정리(브라우저 내장 AI 는 거절 문구를 돌려줄 수 있어 쓰지 않음)
//  - 위치: 사람(피부색)·복잡한 무늬가 적은 위/아래 띠를 골라 인물을 가리지 않게
//  - 사진은 원본에 바로 그리고, 영상은 모든 프레임에 그려 다시 인코딩한다(화질은 최대한 높게).
import * as MB from '../vendor/mediabunny.min.mjs';

// 영상·사진에 쓰는 글자 크기(모든 사이트 공통)
//   기준: 1086x1448 사진에서 28px(사용자가 맞다고 한 크기). 해상도가 달라도 화면에서 보이는 크기가 같도록
//   짧은 변 길이에 비례해 키우거나 줄인다(예: 1080x1920 → 28px, 720x1280 → 19px, 3840x2160 → 56px).
export const TEXT_PX = 28;
export const TEXT_BASE = 1086;
export function textPx(w, h) {
  const short = Math.min(Number(w) || 0, Number(h) || 0);
  if (!(short > 0)) return TEXT_PX;
  return Math.max(12, Math.round((TEXT_PX * short) / TEXT_BASE));
}

// ── 요약 ──
export function quickSummary(text) {
  let s = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\p{L}\p{N}_]+/gu, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const first = s.split(/(?<=[.!?。！？])\s+|\s*\n\s*/)[0].trim();
  let out = [...first].length >= 6 ? first : s;
  if ([...out].length > 60) out = `${[...out].slice(0, 58).join('').trim()}…`;
  return out;
}

// 브라우저 내장 요약 AI 는 쓰지 않는다: 게시물 내용에 따라 요약을 거부하고
// "죄송합니다. 해당 요청은 …도와드릴 수 없습니다" 같은 거절 문구를 돌려줘, 그 문구가 영상에 새겨지는 문제가 있었다.
// → 게시물 글에서 직접 첫 문장을 뽑아 짧게 만든다(항상 같은 결과, 거절 없음).
const REFUSAL = /죄송합니다|도와드릴 수 없|부적절한 콘텐츠|I can(?:no|')t help|I'm sorry|cannot assist|无法提供|申し訳/i;
export async function summarize(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const out = quickSummary(t);
  return REFUSAL.test(out) && !REFUSAL.test(t) ? '' : out;
}

// ── 빈 공간 고르기 ──
// 피부색 비율과 경계(무늬) 밀도가 낮은 띠가 '빈 공간'이다.
export function chooseRegion(source, w, h) {
  const sc = bandScores(source, w, h);
  return sc.bottom - BOTTOM_BIAS <= sc.top ? 'bottom' : 'top';
}

// 사람 얼굴은 보통 화면 위쪽에 있어서, 점수가 비슷하면 아래를 고른다
const BOTTOM_BIAS = 0.04;

// 영상: 첫 프레임(검은 화면·페이드 인일 때가 많음)만 보지 않고 영상 전체에서 여러 장을 골라 합산한다
export async function chooseRegionForTrack(vt) {
  const start = await vt.getFirstTimestamp().catch(() => 0);
  const end = await vt.computeDuration().catch(() => 0);
  const len = Math.max(0, end - start);
  const ts = len > 0 ? [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((f) => start + len * f) : [start];
  const sink = new MB.CanvasSink(vt, { width: 96, poolSize: 1 });
  let top = 0;
  let bottom = 0;
  let n = 0;
  for await (const wc of sink.canvasesAtTimestamps(ts)) {
    if (!wc) continue;
    const c = wc.canvas;
    const sc = bandScores(c, c.width, c.height);
    // 거의 단색인 프레임(검은 화면 등)은 판단에 쓰지 않는다
    if (sc.flat) continue;
    top += sc.top;
    bottom += sc.bottom;
    n++;
  }
  if (!n) return 'bottom';
  return bottom / n - BOTTOM_BIAS <= top / n ? 'bottom' : 'top';
}

export function bandScores(source, w, h) {
  const sw = 96;
  const sh = Math.max(16, Math.round((h / w) * sw));
  const c = new OffscreenCanvas(sw, sh);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(source, 0, 0, sw, sh);
  const px = x.getImageData(0, 0, sw, sh).data;
  const score = (y0, y1) => {
    let skin = 0;
    let edge = 0;
    let n = 0;
    for (let y = Math.floor(y0 * sh); y < Math.ceil(y1 * sh); y++) {
      for (let xx = 0; xx < sw; xx++) {
        const i = (y * sw + xx) * 4;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > 60) skin++;
        if (xx > 0) {
          const j = i - 4;
          edge += Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]);
        }
        n++;
      }
    }
    return (skin / n) * 3 + edge / n / 255;
  };
  // 화면 전체가 거의 단색인지(밝기 편차)
  let sum = 0;
  let sq = 0;
  const cnt = sw * sh;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += l;
    sq += l * l;
  }
  const mean = sum / cnt;
  const flat = Math.sqrt(Math.max(0, sq / cnt - mean * mean)) < 6;
  return { top: score(0.03, 0.22), bottom: score(0.76, 0.95), flat };
}

function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let cur = '';
  for (const ch of [...text]) {
    const next = cur + ch;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur.trim());
      cur = ch;
      if (lines.length === maxLines) break;
    } else cur = next;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  if (lines.length === maxLines && [...lines.join('')].length < [...text].length) {
    lines[maxLines - 1] = `${[...lines[maxLines - 1]].slice(0, -1).join('')}…`;
  }
  return lines;
}

// 캡처한 피드 본문 이미지를 화면 맨 위에 바짝 붙인다(화면을 덜 가리게 가로는 꽉 채우고 높이는 최대 18%).
export function drawShotOverlay(ctx, w, h, img) {
  const iw = img.width;
  const ih = img.height;
  const k = Math.min(w / iw, (h * 0.18) / ih);
  const dw = Math.round(iw * k);
  const dh = Math.round(ih * k);
  const x = Math.round((w - dw) / 2);
  const y = 0;
  const r = Math.max(3, Math.min(dw, dh) * 0.06);
  ctx.save();
  // 아래쪽 모서리만 둥글게(위는 화면 끝에 붙음)
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dw, y);
  ctx.arcTo(x + dw, y + dh, x, y + dh, r);
  ctx.arcTo(x, y + dh, x, y, r);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, dw, dh);
  ctx.restore();
}

// 글자(요약) 또는 캡처 이미지 중 있는 것으로 그린다
// 항상 화면 맨 위에 붙인다(사용자 요청: 아래·가운데를 가리지 않게)
export function drawOverlay(ctx, w, h, ov) {
  if (ov?.image) drawShotOverlay(ctx, w, h, ov.image);
  else if (ov?.text) drawTopLeftText(ctx, w, h, ov.text);
}

export function drawCaption(ctx, w, h, text, pos, flush = false) {
  if (!text) return;
  // 모든 사이트 공통: 1086px 기준 28px, 해상도에 비례(사용자 요청)
  const size = textPx(w, h);
  ctx.save();
  ctx.font = `700 ${size}px "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif`;
  ctx.textBaseline = 'top';
  const maxW = w * 0.86;
  const lines = wrap(ctx, text, maxW - size * 1.2, flush ? 2 : 3);
  const lh = Math.round(size * 1.32);
  const boxW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2);
  const boxH = lines.length * lh + size * 0.8;
  const bx = (w - boxW) / 2;
  const by = flush ? 0 : pos === 'top' ? h * 0.04 : h * 0.94 - boxH;
  const r = size * 0.5;
  ctx.fillStyle = 'rgba(10,10,18,0.58)';
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
  ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r);
  ctx.arcTo(bx, by + boxH, bx, by, r);
  ctx.arcTo(bx, by, bx + boxW, by, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = size * 0.15;
  lines.forEach((l, i) => {
    const lw = ctx.measureText(l).width;
    ctx.fillText(l, (w - lw) / 2, by + size * 0.4 + i * lh);
  });
  ctx.restore();
}

// ── 사진 ──
export async function captionImage(blob, ov, kind) {
  if (typeof ov === 'string') ov = { text: ov };
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  drawOverlay(ctx, bmp.width, bmp.height, ov);
  const type = kind === 'jpg' ? 'image/jpeg' : 'image/png';
  return c.convertToBlob({ type, quality: 0.95 });
}

// ── 영상: 모든 프레임에 요약 글자를 그리고 다시 인코딩 ──
export async function captionVideo(file, ov, writable, onProgress) {
  if (typeof ov === 'string') ov = { text: ov };
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('비디오 트랙 없음');
    const w = await vt.getDisplayWidth();
    const h = await vt.getDisplayHeight();
    const codec = await MB.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h });
    if (!codec) throw new Error('이 브라우저에서 쓸 수 있는 영상 인코더가 없습니다');
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: false }), target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    const conv = await MB.Conversion.init({
      input,
      output,
      video: {
        codec,
        bitrate: MB.QUALITY_VERY_HIGH,
        forceTranscode: true,
        processedWidth: w,
        processedHeight: h,
        process: (sample) => {
          sample.draw(ctx, 0, 0, w, h);
          drawOverlay(ctx, w, h, ov);
          return canvas;
        },
      },
    });
    if (!conv.isValid) throw new Error(`변환 불가: ${conv.discardedTracks.map((d) => d.reason).join(', ')}`);
    // 영상 트랙이 빠지면(이 브라우저가 해당 코덱을 해독·인코딩 못 함) 소리만 남은 파일이 되므로 실패로 처리한다
    const vDrop = conv.discardedTracks.find((d) => d.track?.type === 'video' || d.track?.isVideoTrack?.());
    if (vDrop) throw new Error(`이 브라우저가 영상(${await vt.getCodec().catch(() => '?')})을 다시 인코딩할 수 없습니다: ${vDrop.reason}`);
    conv.onProgress = (p) => onProgress?.(p * 100);
    await conv.execute();
    return { codec, pos: 'top' };
  } finally {
    try { input.dispose(); } catch {}
  }
}

// ── 피드 스크린샷 ──
// 탭 화면 전체 캡처(dataUrl)에서 게시물 영역만 잘라 낸다. 없으면 요약 글자로 카드를 그린다.
export async function cropShot(shot, which = 'rect') {
  if (!shot?.dataUrl || !shot[which]) throw new Error(shot?.dataUrl ? '게시물 영역을 찾지 못했습니다' : '찍어 둔 피드 화면이 없습니다');
  const r0 = shot[which];
  // 여러 조각(영상 위 작성자 + 영상 아래 본문 등)은 각각 잘라 위아래로 이어 붙인다
  if (Array.isArray(r0.rects) && r0.rects.length > 1) {
    const pieces = [];
    for (const rr of r0.rects) pieces.push(await cropShot({ dataUrl: shot.dataUrl, [which]: { ...rr, vw: r0.vw, vh: r0.vh } }, which));
    const w = Math.max(...pieces.map((p) => p.width));
    const h = pieces.reduce((n, p) => n + p.height, 0);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    // 바탕색은 첫 조각 왼쪽 위 색(사이트 배경)으로
    const px = pieces[0].getContext('2d').getImageData(1, 1, 1, 1).data;
    ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    for (const p of pieces) {
      ctx.drawImage(p, 0, y);
      y += p.height;
    }
    return c;
  }
  const blob = await (await fetch(shot.dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const r = r0;
  // 캡처 크기 = 화면 크기 × 화면 배율. 세로는 창마다 다르게 잘릴 수 있어 가로 비율 하나로 맞춘다.
  const sx = bmp.width / (r.vw || bmp.width);
  const sy = sx;
  const x = Math.max(0, Math.round(r.x * sx));
  const y = Math.max(0, Math.round(r.y * sy));
  const w = Math.min(bmp.width - x, Math.round(r.w * sx));
  const h = Math.min(bmp.height - y, Math.round(r.h * sy));
  if (w < 20 || h < 10) throw new Error(`잘라 낼 게시물 영역이 너무 작습니다 (${w}×${h})`);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  bmp.close?.();
  return which === 'textRect' ? trimEdges(c) : c;
}

// 가장자리의 바탕색만 있는 줄·칸을 잘라 글자에 바짝 붙인다
export function trimEdges(c) {
  const w = c.width;
  const h = c.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, w, h).data;
  const bg = [d[0], d[1], d[2]];
  const diff = (i) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 36;
  const rowHas = (y) => {
    for (let x = 0; x < w; x++) if (diff((y * w + x) * 4)) return true;
    return false;
  };
  const colHas = (x, y0, y1) => {
    for (let y = y0; y <= y1; y++) if (diff((y * w + x) * 4)) return true;
    return false;
  };
  let top = 0;
  while (top < h - 1 && !rowHas(top)) top++;
  let bottom = h - 1;
  while (bottom > top && !rowHas(bottom)) bottom--;
  let left = 0;
  while (left < w - 1 && !colHas(left, top, bottom)) left++;
  let right = w - 1;
  while (right > left && !colHas(right, top, bottom)) right--;
  const nw = right - left + 1;
  const nh = bottom - top + 1;
  if (nw < 10 || nh < 6 || (nw === w && nh === h)) return c;
  const out = new OffscreenCanvas(nw, nh);
  out.getContext('2d').drawImage(c, left, top, nw, nh, 0, 0, nw, nh);
  return out;
}

export function textCard(summary, meta = {}) {
  const w = 1080;
  const h = 1080;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1d1b3a');
  g.addColorStop(1, '#0b0b12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 40px "Pretendard","Malgun Gothic","Noto Sans KR",sans-serif';
  ctx.textBaseline = 'top';
  const head = [meta.site, meta.author].filter(Boolean).join(' · ');
  if (head) ctx.fillText(head, 80, 90);
  drawCaption(ctx, w, h, summary || meta.site || '피드', 'bottom');
  // 가운데에 크게 한 번 더(카드 본문)
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px "Pretendard","Malgun Gothic","Noto Sans KR",sans-serif';
  const lines = wrap(ctx, summary || '', w - 160, 5);
  lines.forEach((l, i) => ctx.fillText(l, 80, 260 + i * 86));
  return c;
}

// 스크린샷(또는 카드)을 얻는다. 실패 이유는 경고로 돌려준다.
export async function feedImage(caption, summary) {
  try {
    return { canvas: await cropShot(caption.shot), from: 'shot' };
  } catch (err) {
    const why = caption.shotError || err?.message || String(err);
    return { canvas: textCard(summary, caption), from: 'card', why };
  }
}

export async function canvasPng(canvas) {
  return canvas.convertToBlob({ type: 'image/png' });
}

// ── ② 재인코딩 없이: 영상 데이터는 그대로 복사하고 표지 사진·설명 정보만 넣는다 ──
export async function coverVideo(file, { cover, title, comment }, writable) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const data = new Uint8Array(await cover.arrayBuffer());
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: false }), target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    const conv = await MB.Conversion.init({
      input,
      output,
      showWarnings: false,
      tags: (t) => ({
        ...t,
        title: title || t.title,
        comment: comment || t.comment,
        description: comment || t.description,
        images: [{ data, mimeType: cover.type || 'image/png', kind: 'coverFront', name: 'feed.png' }],
      }),
    });
    if (!conv.isValid) throw new Error(`변환 불가: ${conv.discardedTracks.map((d) => d.reason).join(', ')}`);
    const vDrop = conv.discardedTracks.find((d) => d.track?.type === 'video' || d.track?.isVideoTrack?.());
    if (vDrop) throw new Error(`영상 트랙을 그대로 옮기지 못했습니다: ${vDrop.reason}`);
    await conv.execute();
  } finally {
    try { input.dispose(); } catch {}
  }
}

// ── ③ 영상 맨 앞에 피드 화면 N초 (영상은 다시 인코딩, 소리는 그대로 복사해 뒤로 민다) ──
function fitDraw(ctx, src, w, h) {
  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, w, h);
  const sw = src.width;
  const sh = src.height;
  // 흐린 배경으로 빈칸을 채우고, 가운데에 원본 비율로 놓는다
  const cover = Math.max(w / sw, h / sh);
  ctx.save();
  ctx.filter = 'blur(24px) brightness(0.45)';
  ctx.drawImage(src, (w - sw * cover) / 2, (h - sh * cover) / 2, sw * cover, sh * cover);
  ctx.restore();
  const k = Math.min((w * 0.94) / sw, (h * 0.94) / sh);
  ctx.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
}

export async function introVideo(file, { image, seconds = 3, overlay = null }, writable, onProgress) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('비디오 트랙 없음');
    if (!(await vt.canDecode())) throw new Error(`이 브라우저가 영상(${await vt.getCodec().catch(() => '?')})을 해독할 수 없습니다`);
    const at = await input.getPrimaryAudioTrack();
    let w = await vt.getDisplayWidth();
    let h = await vt.getDisplayHeight();
    w -= w % 2;
    h -= h % 2;
    const codec = await MB.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h });
    if (!codec) throw new Error('이 브라우저에서 쓸 수 있는 영상 인코더가 없습니다');
    const total = (await input.computeDuration()) || 1;
    const stats = await vt.computePacketStats(60).catch(() => null);
    const fps = Math.min(60, Math.max(15, Math.round(stats?.averagePacketRate || 30)));

    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: false }), target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    const vSrc = new MB.VideoSampleSource({ codec, bitrate: MB.QUALITY_VERY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(vSrc, { frameRate: fps });
    let aSrc = null;
    let aCfg = null;
    if (at) {
      const acodec = await at.getCodec();
      aCfg = await at.getDecoderConfig();
      if (acodec && aCfg) {
        aSrc = new MB.EncodedAudioPacketSource(acodec);
        output.addAudioTrack(aSrc);
      }
    }
    const tags = await input.getMetadataTags().catch(() => ({}));
    output.setMetadataTags({ ...tags, images: undefined });
    await output.start();

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    // 1) 인트로 프레임
    fitDraw(ctx, image, w, h);
    const introFrames = Math.round(seconds * fps);
    for (let i = 0; i < introFrames; i++) {
      const s = new MB.VideoSample(canvas, { timestamp: i / fps, duration: 1 / fps });
      await vSrc.add(s, i === 0 ? { keyFrame: true } : undefined);
      s.close();
    }
    // 2) 본 영상 프레임(필요하면 요약 글자도 그린다)
    const vSink = new MB.VideoSampleSink(vt);
    let t0 = null;
    let first = true;
    for await (const sample of vSink.samples()) {
      if (t0 === null) t0 = Math.max(0, sample.timestamp);
      sample.draw(ctx, 0, 0, w, h);
      if (overlay) {
        drawOverlay(ctx, w, h, overlay);
      }
      const ts = seconds + Math.max(0, sample.timestamp - t0);
      const out = new MB.VideoSample(canvas, { timestamp: ts, duration: sample.duration || 1 / fps });
      await vSrc.add(out, first ? { keyFrame: true } : undefined);
      first = false;
      out.close();
      sample.close();
      onProgress?.(Math.min(95, ((ts - seconds) / total) * 95));
    }
    if (t0 === null) throw new Error('영상 프레임을 하나도 읽지 못했습니다');
    vSrc.close();
    // 3) 소리: 그대로 복사하되 인트로 길이만큼 뒤로 민다
    if (aSrc) {
      const pSink = new MB.EncodedPacketSink(at);
      let firstA = true;
      for await (const p of pSink.packets()) {
        const shifted = p.clone({ timestamp: seconds + Math.max(0, p.timestamp - t0) });
        await aSrc.add(shifted, firstA ? { decoderConfig: aCfg } : undefined);
        firstA = false;
      }
      aSrc.close();
    }
    await output.finalize();
    onProgress?.(100);
    return { codec, fps };
  } finally {
    try { input.dispose(); } catch {}
  }
}

// ── 한국어가 아닌 피드 글 번역 ──
// 한글 비율이 낮고 다른 글자가 충분하면 '한국어 아님'
export function needsKorean(text) {
  const t = String(text || '').replace(/https?:\/\/\S+|[#@][\p{L}\p{N}_]+/gu, ' ');
  const letters = (t.match(/\p{L}/gu) || []).length;
  const hangul = (t.match(/[\uac00-\ud7a3\u3131-\u318e]/g) || []).length;
  return letters >= 4 && hangul / letters < 0.3;
}

// 번역: 브라우저 내장 번역기(있고 바로 쓸 수 있을 때) → 없으면 구글 번역 공개 주소
export async function translateToKorean(text) {
  const t = String(text || '').trim().slice(0, 1500);
  if (!t) return '';
  // 내장 번역기는 준비(모델 내려받기 등)에 오래 걸리거나 멈출 수 있어 3초 안에 안 되면 건너뛴다
  const builtin = (async () => {
    if (!('Translator' in self) || !('LanguageDetector' in self)) return '';
    if ((await self.LanguageDetector.availability?.()) !== 'available') return '';
    const det = await self.LanguageDetector.create();
    const lang = (await det.detect(t))?.[0]?.detectedLanguage;
    if (!lang || lang === 'ko' || (await self.Translator.availability({ sourceLanguage: lang, targetLanguage: 'ko' })) !== 'available') return '';
    const tr = await self.Translator.create({ sourceLanguage: lang, targetLanguage: 'ko' });
    return (await tr.translate(t)).trim();
  })().catch(() => '');
  const fast = await Promise.race([builtin, new Promise((r) => setTimeout(() => r(''), 3000))]);
  if (fast) return fast;
  let res;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${encodeURIComponent(t)}`, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? '번역 서버가 10초 안에 응답하지 않았습니다' : `번역 서버에 연결하지 못했습니다(${err?.message || err})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`번역 서버가 HTTP ${res.status} 로 응답했습니다`);
  let j;
  try {
    j = await res.json();
  } catch {
    throw new Error('번역 결과 형식을 읽지 못했습니다');
  }
  const out = (Array.isArray(j?.[0]) ? j[0].map((x) => (Array.isArray(x) ? x[0] : '')).join('') : '').trim();
  if (!out) throw new Error('번역 결과가 비어 있습니다');
  return out;
}

// 캡처 이미지 아래에 한국어 번역 칸을 붙인다(캡처 바탕색에 맞춰 글자색을 고름)
export function withTranslation(img, ko, replace = false) {
  const w = img.width;
  const size = Math.round(Math.max(14, Math.min(40, w * 0.032)));
  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  probe.drawImage(img, 1, 1, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
  const meas = new OffscreenCanvas(10, 10).getContext('2d');
  meas.font = `600 ${size}px "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif`;
  const pad = Math.round(size * 0.7);
  // replace: 원문을 빼고 번역만(작성자 줄 아래에 본문처럼) / 아니면 '번역:' 칸을 덧붙임
  const lines = wrap(meas, replace ? ko : `번역: ${ko}`, Math.max(w, replace ? 600 : 0) - pad * 2, 6);
  const lh = Math.round(size * 1.4);
  const cw = replace ? Math.max(w, Math.min(1080, Math.ceil(Math.max(...lines.map((l) => meas.measureText(l).width))) + pad * 2)) : w;
  const h = img.height + (replace ? Math.round(pad * 0.4) : pad) + lines.length * lh + Math.round(pad * 0.6);
  const c = new OffscreenCanvas(cw, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, cw, h);
  ctx.drawImage(img, 0, 0);
  if (!replace) {
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.moveTo(pad, img.height + pad * 0.4);
    ctx.lineTo(w - pad, img.height + pad * 0.4);
    ctx.stroke();
  }
  ctx.font = meas.font;
  ctx.textBaseline = 'top';
  ctx.fillStyle = dark ? '#f1f3f5' : '#14171a';
  const y0 = img.height + (replace ? Math.round(pad * 0.4) : pad);
  lines.forEach((l, i) => ctx.fillText(l, replace ? 0 : pad, y0 + i * lh));
  return c;
}

// 화면 캡처가 없을 때: 피드 모양(작성자 이름 줄 + 본문) 카드를 직접 그린다
export function postCard(author, text) {
  const w = 1080;
  const pad = 36;
  const meas = new OffscreenCanvas(10, 10).getContext('2d');
  const bodyFont = '500 38px "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  const nameFont = '800 36px "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  meas.font = bodyFont;
  const lines = wrap(meas, String(text || '').replace(/\s+/g, ' ').trim(), w - pad * 2, 3);
  const nameH = author ? 52 : 0;
  const h = pad + nameH + lines.length * 52 + pad - 8;
  const c = new OffscreenCanvas(w, Math.max(h, 80));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, c.height);
  ctx.textBaseline = 'top';
  let y = pad - 6;
  if (author) {
    ctx.font = nameFont;
    ctx.fillStyle = '#e7e9ea';
    ctx.fillText(author, pad, y);
    y += nameH;
  }
  ctx.font = bodyFont;
  ctx.fillStyle = '#e7e9ea';
  lines.forEach((l, i) => ctx.fillText(l, pad, y + i * 52));
  return c;
}

// 피드 본문 글자만 왼쪽 위에 쓴다(상자 없이 흰 글자 + 검은 테두리, 최대 3줄)
export function drawTopLeftText(ctx, w, h, text) {
  if (!text) return;
  // 글자 크기: 1086x1448 에서 28px 를 기준으로 해상도에 비례(어느 해상도든 보이는 크기가 같게)
  const size = textPx(w, h);
  ctx.save();
  ctx.font = `800 ${size}px "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif`;
  ctx.textBaseline = 'top';
  const margin = Math.round(size / 2); // 왼쪽 위 여백도 글자 크기에 맞춰(28px 일 때 14px)
  const lines = wrap(ctx, text, w - margin * 2, 3);
  const lh = Math.round(size * 1.25);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.2);
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => {
    ctx.strokeText(l, margin, margin + i * lh);
    ctx.fillText(l, margin, margin + i * lh);
  });
  ctx.restore();
}
