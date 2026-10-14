// 영상을 장면별로 나눈다.
//  1) 찾기: 프레임을 64x64 로 줄여 색 분포·픽셀을 앞 프레임과 비교(해독만 하고 인코딩은 없음)
//  2) 자르기: 정확하게 = 장면 첫 프레임부터 다시 인코딩 / 빠르게 = 다시 인코딩 없이 복사(바로 앞 키프레임부터 담고 그 부분은 '재생 안 함'으로 표시 — 파일이 커지고, 이 표시를 무시하는 플레이어는 앞 1~2초를 보여 줌)
import * as MB from '../vendor/mediabunny.min.mjs';
import { histogram, sceneScore, pickCuts, sceneRanges, SCENE_THRESHOLD } from '../shared/scenes.js';

const stepError = (step, message) => Object.assign(new Error(message), { step });

export async function findScenes(file, { minSec } = {}, onProgress) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw stepError('장면 찾기', '영상 트랙이 없습니다');
    if (!(await vt.canDecode())) throw stepError('장면 찾기', `이 브라우저가 영상(${await vt.getCodec().catch(() => '?')})을 해독할 수 없습니다`);
    const start = Math.max(0, await vt.getFirstTimestamp().catch(() => 0));
    const end = (await input.computeDuration().catch(() => 0)) || start;
    const len = Math.max(0.001, end - start);
    const sink = new MB.CanvasSink(vt, { width: 64, height: 64, fit: 'fill', poolSize: 2 });
    const small = new OffscreenCanvas(64, 64);
    const ctx = small.getContext('2d', { willReadFrequently: true });
    const cands = [];
    let prev = null;
    let frames = 0;
    for await (const wc of sink.canvases()) {
      ctx.drawImage(wc.canvas, 0, 0, 64, 64);
      const px = ctx.getImageData(0, 0, 64, 64).data;
      const h = histogram(px);
      if (prev) cands.push({ t: wc.timestamp, d: sceneScore(prev.h, h, prev.px, px) });
      prev = { h, px };
      frames++;
      onProgress?.(Math.min(1, (wc.timestamp - start) / len));
    }
    if (!frames) throw stepError('장면 찾기', '영상 프레임을 하나도 읽지 못했습니다');
    const cuts = pickCuts(cands, { start, end, minSec });
    // 장면이 하나뿐일 때 이유를 알려 주려고: 기준을 넘은 전환 수(0.2초 안에 붙은 것은 하나로), 가장 큰 변화 점수
    let strong = 0;
    let lastT = -1;
    let maxScore = 0;
    for (const c of cands) {
      maxScore = Math.max(maxScore, c.d);
      if (c.d >= SCENE_THRESHOLD && c.t - lastT > 0.2) {
        strong++;
        lastT = c.t;
      }
    }
    return { start, end, frames, cuts, ranges: sceneRanges(cuts, start, end), strong, maxScore };
  } finally {
    try { input.dispose(); } catch {}
  }
}

// 정확하게 자를 때 쓸 영상 인코더(없으면 null → 빠르게 자르기로 바꾼다)
export async function sceneCodec(file) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) return null;
    const width = await vt.getDisplayWidth();
    const height = await vt.getDisplayHeight();
    return await MB.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height, bitrate: MB.QUALITY_VERY_HIGH });
  } finally {
    try { input.dispose(); } catch {}
  }
}

// 한 장면을 MP4 로 쓴다. codec 을 주면 다시 인코딩(정확), 없으면 복사(빠름). 소리는 그대로 복사해 같은 구간만 남긴다
export async function cutScene(file, { start, end, codec = null }, writable) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: false }), target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    const conv = await MB.Conversion.init({
      input,
      output,
      showWarnings: false,
      trim: { start, end },
      video: codec ? { codec, bitrate: MB.QUALITY_VERY_HIGH, forceTranscode: true } : undefined,
    });
    if (!conv.isValid) throw stepError('장면 자르기 준비', `자를 수 없습니다: ${conv.discardedTracks.map((d) => d.reason).join(', ')}`);
    const vDrop = conv.discardedTracks.find((d) => d.track?.type === 'video' || d.track?.isVideoTrack?.());
    if (vDrop) throw stepError('장면 자르기 준비', `영상 트랙을 옮기지 못했습니다: ${vDrop.reason}`);
    await conv.execute();
  } finally {
    try { input.dispose(); } catch {}
  }
}
