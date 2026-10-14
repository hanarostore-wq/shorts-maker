// 장면 나누기 계산(브라우저·노드 공용, 영상 라이브러리 없이 숫자만 다룬다)
//  - 장면 전환: 아주 작게 줄인 프레임의 색 분포(히스토그램)가 앞 프레임과 크게 달라지는 지점
//  - 최소 길이: 이보다 짧은 장면은 만들지 않는다(번쩍임·빠른 컷이 조각 파일로 쏟아지지 않게)

// 전환 점수 = 색 분포 차이(0~1) + 픽셀 차이(0~1). 이 값을 넘으면 장면이 바뀐 것으로 본다
//  실측(64x64): 딱 끊기는 컷 1.2~1.4, 색이 비슷한 컷 약 0.6, 같은 장면의 움직임 0.25 아래
export const SCENE_THRESHOLD = 0.45;
// 장면 파일을 너무 많이 만들지 않게(전환이 더 많으면 차이가 큰 것부터 고른다)
export const MAX_SCENES = 50;
export const MIN_SEC_DEFAULT = 2;

export const clampMinSec = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(30, Math.max(0.5, n)) : MIN_SEC_DEFAULT;
};

// RGBA 픽셀 → 색 64칸(빨강·초록·파랑 각 4단계) 비율
export function histogram(px) {
  const h = new Float32Array(64);
  let n = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    h[((px[i] >> 6) << 4) | ((px[i + 1] >> 6) << 2) | (px[i + 2] >> 6)]++;
    n++;
  }
  if (n) for (let k = 0; k < 64; k++) h[k] /= n;
  return h;
}

// 두 색 분포의 차이: 0 = 같음, 1 = 겹치는 색이 하나도 없음
export function histDiff(a, b) {
  let s = 0;
  for (let k = 0; k < 64; k++) s += Math.abs(a[k] - b[k]);
  return s / 2;
}

// 같은 크기 두 프레임(RGBA)의 평균 픽셀 차이: 0 = 같음, 1 = 정반대. 색 분포가 비슷한 컷(같은 장소 다른 구도)을 잡는다
export function pixelDiff(a, b) {
  let s = 0;
  let n = 0;
  for (let i = 0; i + 3 < a.length && i + 3 < b.length; i += 4) {
    s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return n ? s / (n * 255) : 0;
}

export const sceneScore = (prevHist, hist, prevPx, px) => histDiff(prevHist, hist) + pixelDiff(prevPx, px);

// 전환 후보 [{ t, d }] 중에서 실제로 자를 지점을 고른다.
//  차이가 큰 것부터 보면서, 이미 고른 지점·영상 처음·끝과 minSec 이상 떨어진 것만 남긴다
//  → 0.3초짜리 번쩍임 앞뒤 두 전환 중 더 뚜렷한 하나만 남고, 짧은 장면은 이웃 장면에 붙는다
export function pickCuts(cands, { start = 0, end, minSec = MIN_SEC_DEFAULT, threshold = SCENE_THRESHOLD, max = MAX_SCENES } = {}) {
  const min = clampMinSec(minSec);
  const picked = [];
  const sorted = (cands || []).filter((c) => c && c.d >= threshold && Number.isFinite(c.t)).sort((a, b) => b.d - a.d);
  for (const c of sorted) {
    if (picked.length >= max - 1) break;
    if (c.t - start < min || end - c.t < min) continue;
    if (picked.some((p) => Math.abs(p - c.t) < min)) continue;
    picked.push(c.t);
  }
  return picked.sort((a, b) => a - b);
}

// 자를 지점 → 장면 구간 [{ start, end }]
export function sceneRanges(cuts, start, end) {
  const pts = [start, ...(cuts || []), end];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) if (pts[i + 1] > pts[i]) out.push({ start: pts[i], end: pts[i + 1] });
  return out;
}

// 파일 이름 끝에 붙는 번호: (장면 01), 장면이 100개 이상이면 세 자리
export const sceneSuffix = (i, total) => ` (장면 ${String(i + 1).padStart(Math.max(2, String(total).length), '0')})`;
