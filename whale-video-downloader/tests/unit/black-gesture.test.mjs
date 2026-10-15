import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/black/black-gesture-core.js';

const core = globalThis.__SMD_GESTURE_CORE;
const drag = (pts, opt) => {
  const t = core.createTracker(opt);
  t.start(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) t.move(x, y);
  return t;
};
// 한 방향으로 n 개 점(간격 step)을 찍는다
const line = (x, y, dx, dy, n = 6, step = 10) => Array.from({ length: n }, (_, i) => [x + dx * step * (i + 1), y + dy * step * (i + 1)]);

test('한 방향: ← ↑ ↓ → 를 읽는다', () => {
  assert.equal(drag([[300, 300], ...line(300, 300, -1, 0)]).dirs, 'L');
  assert.equal(drag([[300, 300], ...line(300, 300, 1, 0)]).dirs, 'R');
  assert.equal(drag([[300, 300], ...line(300, 300, 0, -1)]).dirs, 'U');
  assert.equal(drag([[300, 300], ...line(300, 300, 0, 1)]).dirs, 'D');
});

test('꺾는 제스처: 위로 갔다 왼쪽(UL), 아래로 갔다 오른쪽(DR)', () => {
  assert.equal(drag([[300, 300], ...line(300, 300, 0, -1), ...line(300, 240, -1, 0)]).dirs, 'UL');
  assert.equal(drag([[300, 300], ...line(300, 300, 0, 1), ...line(300, 360, 1, 0)]).dirs, 'DR');
});

test('같은 방향으로 길게 끌어도 방향은 하나, 세 번째 꺾음은 무시(최대 2획)', () => {
  assert.equal(drag([[0, 0], ...line(0, 0, 1, 0, 30)]).dirs, 'R');
  assert.equal(drag([[300, 300], ...line(300, 300, 1, 0), ...line(360, 300, 0, 1), ...line(360, 360, -1, 0)]).dirs, 'RD');
});

test('떨림: 최소 이동(24px) 안쪽은 방향이 안 생기고, 8px 데드존 기준 far 로 구분', () => {
  const t = drag([[100, 100], [103, 101], [106, 99], [104, 104]]);
  assert.equal(t.dirs, '');
  assert.ok(t.far < core.DEAD_ZONE);
  const t2 = drag([[100, 100], [112, 100]]);
  assert.equal(t2.dirs, '');
  assert.ok(t2.far >= core.DEAD_ZONE);
});

test('반응 속도: 24px 만 움직여도 바로 방향이 잡힌다(move 가 true)', () => {
  const t = core.createTracker();
  t.start(0, 0);
  assert.equal(t.move(10, 0), false);
  assert.equal(t.move(25, 1), true);
  assert.equal(t.dirs, 'R');
});

test('동작 정하기: 기본값은 ← 뒤로 · ↑ 맨 위 · ↓ 탭 닫기, 모르는 제스처는 동작 없음', () => {
  const map = core.sanitizeMap(null);
  assert.equal(core.resolve('L', map), 'back');
  assert.equal(core.resolve('U', map), 'top');
  assert.equal(core.resolve('D', map), 'close');
  assert.equal(core.resolve('LL', map), 'none');
  assert.equal(core.resolve('', map), 'none');
});

test('저장값 정리: 모르는 제스처·동작은 버리고 빠진 것은 기본값으로', () => {
  const m = core.sanitizeMap({ L: 'forward', U: 'hack', ZZ: 'back', D: 5 });
  assert.equal(m.L, 'forward');
  assert.equal(m.U, 'top');
  assert.equal(m.D, 'close');
  assert.equal('ZZ' in m, false);
  assert.equal(core.sanitizeMap('x').R, 'forward');
});

test('화살표 글자', () => {
  assert.equal(core.arrows('UL'), '↑←');
  assert.equal(core.arrows(''), '');
});
