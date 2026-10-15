import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteKey, hostOfUrl, isExcluded, excludePatterns } from '../../extension/shared/exclude.js';

test('호스트 이름 정리: 앞의 www. 만 뺌, 대소문자 무시', () => {
  assert.equal(siteKey('WWW.YouTube.com'), 'youtube.com');
  assert.equal(siteKey('m.youtube.com'), 'm.youtube.com');
  assert.equal(siteKey(' x.com '), 'x.com');
  assert.equal(siteKey(''), '');
  assert.equal(siteKey(null), '');
});

test('주소에서 호스트: 웹 페이지만(새 탭·설정·확장 페이지·파일은 빈 글자)', () => {
  assert.equal(hostOfUrl('https://www.youtube.com/watch?v=1'), 'www.youtube.com');
  assert.equal(hostOfUrl('http://localhost:3000/a'), 'localhost');
  for (const u of ['chrome://settings', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///C:/a.html', '', undefined, 'not a url']) assert.equal(hostOfUrl(u), '');
});

test('제외 여부: 같은 호스트(www. 유무 무관)만, 하위 도메인·다른 사이트는 아님', () => {
  const list = ['youtube.com', 'x.com'];
  assert.equal(isExcluded(list, 'www.youtube.com'), true);
  assert.equal(isExcluded(list, 'youtube.com'), true);
  assert.equal(isExcluded(list, 'm.youtube.com'), false);
  assert.equal(isExcluded(list, 'twitter.com'), false);
  assert.equal(isExcluded(list, ''), false);
  assert.equal(isExcluded(undefined, 'x.com'), false);
});

test('content script 주소 패턴: 호스트와 www. 붙은 것, 중복 없음', () => {
  assert.deepEqual(excludePatterns(['youtube.com', 'www.youtube.com', 'x.com']), ['*://youtube.com/*', '*://www.youtube.com/*', '*://x.com/*', '*://www.x.com/*']);
  assert.deepEqual(excludePatterns([]), []);
});
