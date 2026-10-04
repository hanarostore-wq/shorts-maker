import { test } from 'node:test';
import assert from 'node:assert/strict';

// 화면 없이 글자 그리기만 기록하는 가짜 캔버스
function fakeCtx() {
  const fonts = [];
  const ctx = {
    _font: '',
    get font() { return this._font; },
    set font(v) { this._font = v; fonts.push(v); },
    save() {}, restore() {}, strokeText() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {}, roundRect() {}, rect() {},
    measureText(t) { return { width: String(t).length * 14 }; },
  };
  return { ctx, fonts };
}

const cap = await import('../../extension/offscreen/caption.js').catch((err) => ({ loadError: err }));

test('글자 크기: 1086x1448 에서 28px, 해상도에 비례', { skip: cap.loadError && `caption.js 를 불러오지 못함: ${cap.loadError?.message}` }, () => {
  const cases = [[1086, 1448, 28], [1080, 1920, 28], [1920, 1080, 28], [720, 1280, 19], [543, 724, 14], [2172, 2896, 56], [3840, 2160, 56], [200, 200, 12]];
  for (const [w, h, px] of cases) {
    assert.equal(cap.textPx(w, h), px, `${w}x${h}`);
    const { ctx, fonts } = fakeCtx();
    cap.drawOverlay(ctx, w, h, { text: '크기 확인 문장입니다' });
    assert.ok(fonts.length && fonts.every((f) => f.includes(` ${px}px `)), `${w}x${h}: ${fonts.join(' | ')}`);
  }
  // 짧은 변 대비 글자 비율은 해상도가 달라도 같다(반올림 오차 1px 이내)
  for (const short of [720, 1080, 1440, 2160]) assert.ok(Math.abs(cap.textPx(short, short * 1.5) - (28 * short) / 1086) <= 0.5, `${short}`);
});

test('(오류 경로) 크기를 모르면 기본 28px', { skip: !!cap.loadError }, () => {
  assert.equal(cap.textPx(0, 0), 28);
  assert.equal(cap.textPx(NaN, undefined), 28);
});

test('(오류 경로) 글자가 없으면 아무것도 그리지 않음', { skip: !!cap.loadError }, () => {
  const { ctx, fonts } = fakeCtx();
  cap.drawOverlay(ctx, 1080, 1920, { text: '' });
  cap.drawOverlay(ctx, 1080, 1920, null);
  assert.equal(fonts.length, 0);
});
