import { test } from 'node:test';
import assert from 'node:assert/strict';

const cap = await import('../../extension/offscreen/caption.js').catch((err) => ({ loadError: err }));
const skip = cap.loadError && `caption.js 를 불러오지 못함: ${cap.loadError?.message}`;

test('본문 링크 빼기: 여러 모양의 주소를 빼고 글자만 남김', { skip }, () => {
  const cases = [
    ['그녀는 라이브 중이고 들어가서 말하십시오 https:// 18livehub.com/signup', '그녀는 라이브 중이고 들어가서 말하십시오'],
    ['She is live now https://18livehub.com/signup?ref=1 join', 'She is live now join'],
    ['look 18livehub.com/signup now', 'look now'],
    ['link: www.example.com/a', 'link'],
    ['watch t.co/AbC123', 'watch'],
    ['go to site[.]com today', 'go to today'],
    ['가입 👉 hxxps://bad.xyz', '가입'],
    ['(https://a.io)', ''],
  ];
  for (const [inp, want] of cases) assert.equal(cap.stripLinks(inp), want, inp);
});

test('본문 링크 빼기(오류 경로): 주소가 아닌 글자는 지우지 않음', { skip }, () => {
  const keep = ['가격은 3.5배 올랐다', 'I love it. Come here', 'Mr.Kim 안녕하세요', 'email me@x 아님', '', '좋아요.co 라는 말'];
  assert.equal(cap.stripLinks(keep[0]), keep[0]);
  assert.equal(cap.stripLinks(keep[1]), keep[1]);
  assert.equal(cap.stripLinks(keep[2]), keep[2]);
  assert.equal(cap.stripLinks(keep[4]), '');
  assert.equal(cap.stripLinks(null), '');
  assert.equal(cap.stripLinks(undefined), '');
});

test('요약·한국어 판단도 링크를 뺀 글자로', { skip }, () => {
  assert.equal(cap.quickSummary('https:// 18livehub.com/signup'), '');
  assert.equal(cap.needsKorean('안녕 https:// 18livehub.com/signup'), false);
});
