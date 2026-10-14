import test from 'node:test';
import assert from 'node:assert/strict';
import { histogram, histDiff, pixelDiff, sceneScore, pickCuts, sceneRanges, sceneSuffix, clampMinSec } from '../../extension/shared/scenes.js';

const solid = (r, g, b, n = 16) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) px.set([r, g, b, 255], i * 4);
  return px;
};

test('색 분포: 같은 색은 차이 0, 전혀 다른 색은 1', () => {
  assert.equal(histDiff(histogram(solid(200, 10, 10)), histogram(solid(200, 10, 10))), 0);
  assert.equal(histDiff(histogram(solid(200, 10, 10)), histogram(solid(10, 10, 200))), 1);
});

test('픽셀 차이: 색 분포가 같아도 배치가 바뀌면 전환 점수가 오른다', () => {
  const a = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const b = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  assert.equal(histDiff(histogram(a), histogram(b)), 0);
  assert.equal(pixelDiff(a, b), 1);
  assert.equal(sceneScore(histogram(a), histogram(b), a, b), 1);
  assert.equal(pixelDiff(a, a), 0);
});

test('최소 길이: 0.5초 번쩍임은 장면으로 만들지 않고 더 뚜렷한 전환 하나만 남긴다', () => {
  const cands = [
    { t: 3.0, d: 0.9 }, // 장면 A → 번쩍임
    { t: 3.5, d: 0.8 }, // 번쩍임 → 장면 B
    { t: 6.5, d: 0.7 }, // 장면 B → C
    { t: 7.0, d: 0.1 }, // 움직임(전환 아님)
  ];
  assert.deepEqual(pickCuts(cands, { start: 0, end: 10, minSec: 2 }), [3.0, 6.5]);
  // 최소 길이를 짧게 하면 번쩍임도 따로 나뉜다
  assert.deepEqual(pickCuts(cands, { start: 0, end: 10, minSec: 0.5 }), [3.0, 3.5, 6.5]);
});

test('최소 길이: 영상 처음·끝에 붙은 짧은 장면은 만들지 않는다', () => {
  assert.deepEqual(pickCuts([{ t: 0.5, d: 1 }, { t: 9.2, d: 1 }, { t: 5, d: 0.6 }], { start: 0, end: 10, minSec: 2 }), [5]);
});

test('전환이 없으면 자를 지점도 없다(장면 하나 = 파일을 더 만들지 않음)', () => {
  assert.deepEqual(pickCuts([{ t: 2, d: 0.1 }, { t: 4, d: 0.39 }], { start: 0, end: 10 }), []);
  assert.deepEqual(sceneRanges([], 0, 10), [{ start: 0, end: 10 }]);
});

test('장면 수 제한: 많으면 차이가 큰 것부터', () => {
  const cands = Array.from({ length: 10 }, (_, i) => ({ t: (i + 1) * 3, d: 0.5 + i * 0.01 }));
  const cuts = pickCuts(cands, { start: 0, end: 40, minSec: 1, max: 4 });
  assert.deepEqual(cuts, [24, 27, 30]);
  assert.equal(sceneRanges(cuts, 0, 40).length, 4);
});

test('장면 구간과 파일 이름 번호', () => {
  assert.deepEqual(sceneRanges([3, 6.5], 0, 10), [{ start: 0, end: 3 }, { start: 3, end: 6.5 }, { start: 6.5, end: 10 }]);
  assert.equal(sceneSuffix(0, 3), ' (장면 01)');
  assert.equal(sceneSuffix(104, 120), ' (장면 105)');
});

test('최소 길이 값 범위: 0.5~30초, 이상한 값은 2초', () => {
  assert.equal(clampMinSec(0.1), 0.5);
  assert.equal(clampMinSec(99), 30);
  assert.equal(clampMinSec('abc'), 2);
  assert.equal(clampMinSec(undefined), 2);
  assert.equal(clampMinSec(3), 3);
});
