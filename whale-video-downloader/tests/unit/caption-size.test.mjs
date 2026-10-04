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

test('영상·사진 위 글자는 크기와 상관없이 28px 고정', { skip: cap.loadError && `caption.js 를 불러오지 못함: ${cap.loadError?.message}` }, () => {
  assert.equal(cap.TEXT_PX, 28);
  for (const [w, h] of [[360, 640], [720, 1280], [1080, 1920], [1920, 1080], [3840, 2160]]) {
    const { ctx, fonts } = fakeCtx();
    cap.drawOverlay(ctx, w, h, { text: '고정 크기 확인 문장입니다' });
    assert.ok(fonts.length && fonts.every((f) => / 28px /.test(f)), `${w}x${h}: ${fonts.join(' | ')}`);
  }
});

test('(오류 경로) 글자가 없으면 아무것도 그리지 않음', { skip: !!cap.loadError }, () => {
  const { ctx, fonts } = fakeCtx();
  cap.drawOverlay(ctx, 1080, 1920, { text: '' });
  cap.drawOverlay(ctx, 1080, 1920, null);
  assert.equal(fonts.length, 0);
});
