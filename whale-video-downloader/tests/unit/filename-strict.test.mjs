import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePart, strictName } from '../../extension/shared/filename.js';

test('보이지 않는 글자(방향 표시·폭 없는 공백·변형 선택자)는 파일 이름에서 뺀다', () => {
  const t = sanitizePart('안녕​하세요‪ 영상️⁦끝⁩');
  assert.ok(!/[​‪️⁦⁩]/.test(t), JSON.stringify(t));
  assert.match(t, /안녕/);
  assert.match(t, /끝/);
  assert.equal(sanitizePart('~숨김'), '숨김');
});

test('엄격한 이름: 이모지·기호 빼고 한글·숫자는 남기고 확장자 유지', () => {
  assert.equal(strictName('[한국] 오늘 🌊 바다 ✨ 여행 [x-123].mp4'), '[한국] 오늘 바다 여행 [x-123].mp4');
  assert.ok(!/[^\x00-\x7f가-힣\s]/.test(strictName('😀😀😀.jpg').replace(/영상/, '')));
  // 오류 경로: 남는 글자가 없으면 기본 이름
  assert.equal(strictName('🌊🌊.mp4'), '영상.mp4');
});
