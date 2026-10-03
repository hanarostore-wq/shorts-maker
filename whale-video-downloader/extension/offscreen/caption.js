// 저장할 사진·영상의 빈 공간에 피드 내용 요약을 써 넣는다.
//  - 요약: 브라우저 내장 요약 AI(있을 때) → 없으면 첫 문장 중심으로 짧게 정리
//  - 위치: 사람(피부색)·복잡한 무늬가 적은 위/아래 띠를 골라 인물을 가리지 않게
//  - 사진은 원본에 바로 그리고, 영상은 모든 프레임에 그려 다시 인코딩한다(화질은 최대한 높게).
import * as MB from '../vendor/mediabunny.min.mjs';

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

export async function summarize(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  // 크롬 계열 내장 요약 AI(지원하는 브라우저에서만). 2.5초 안에 안 되면 간단 요약으로.
  try {
    if (t.length > 80 && 'Summarizer' in self && (await self.Summarizer.availability()) === 'available') {
      const run = (async () => {
        const sm = await self.Summarizer.create({ type: 'tldr', length: 'short', format: 'plain-text' });
        return (await sm.summarize(t)).trim();
      })();
      const r = await Promise.race([run, new Promise((res) => setTimeout(() => res(''), 2500))]);
      if (r) return quickSummary(r);
    }
  } catch {}
  return quickSummary(t);
}

// ── 빈 공간 고르기 ──
// 피부색 비율과 경계(무늬) 밀도가 낮은 띠가 '빈 공간'이다.
export function chooseRegion(source, w, h) {
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
  const cands = [
    { pos: 'top', s: score(0.03, 0.22) },
    { pos: 'bottom', s: score(0.76, 0.95) },
  ];
  cands.sort((a, b) => a.s - b.s);
  return cands[0].pos;
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

export function drawCaption(ctx, w, h, text, pos) {
  if (!text) return;
  const size = Math.round(Math.max(16, Math.min(64, Math.min(w, h * 0.9) * 0.045)));
  ctx.save();
  ctx.font = `700 ${size}px "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif`;
  ctx.textBaseline = 'top';
  const maxW = w * 0.86;
  const lines = wrap(ctx, text, maxW - size * 1.2, 3);
  const lh = Math.round(size * 1.32);
  const boxW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2);
  const boxH = lines.length * lh + size * 0.8;
  const bx = (w - boxW) / 2;
  const by = pos === 'top' ? h * 0.04 : h * 0.94 - boxH;
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
export async function captionImage(blob, text, kind) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  drawCaption(ctx, bmp.width, bmp.height, text, chooseRegion(bmp, bmp.width, bmp.height));
  const type = kind === 'jpg' ? 'image/jpeg' : 'image/png';
  return c.convertToBlob({ type, quality: 0.95 });
}

// ── 영상: 모든 프레임에 요약 글자를 그리고 다시 인코딩 ──
export async function captionVideo(file, text, writable, onProgress) {
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
    let pos = null;
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
          if (!pos) pos = chooseRegion(canvas, w, h);
          drawCaption(ctx, w, h, text, pos);
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
    return { codec, pos };
  } finally {
    try { input.dispose(); } catch {}
  }
}
