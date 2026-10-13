import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readPasswordCsv, siteOf, matchItems, mergeItems } from '../../extension/black/black-pw-core.js';

test('CSV: 따옴표·쉼표·줄바꿈이 든 칸, BOM, CRLF', () => {
  const rows = parseCsv('﻿name,url,username,password,note\r\n"a,b",https://a.com/,"u""1","p,\nw",\r\n');
  assert.deepEqual(rows, [['name', 'url', 'username', 'password', 'note'], ['a,b', 'https://a.com/', 'u"1', 'p,\nw', '']]);
});

test('비밀번호 CSV(크롬·웨일 형식): 항목과 건너뛴 줄 번호·이유', () => {
  const r = readPasswordCsv('name,url,username,password,note\nnaver,https://nid.naver.com/nidlogin.login,me,pw1,\nnone,,x,y,\nempty,https://a.com/,u,,\nbad,::::,u,p,\n');
  assert.equal(r.items.length, 1);
  assert.deepEqual({ host: r.items[0].host, username: r.items[0].username, password: r.items[0].password }, { host: 'nid.naver.com', username: 'me', password: 'pw1' });
  assert.deepEqual(r.skipped.map((s) => s.line), [3, 4, 5]);
  assert.match(r.skipped[0].why, /주소 없음/);
  assert.match(r.skipped[1].why, /비밀번호 없음/);
});

test('비밀번호 CSV(오류 경로): 형식이 다르거나 비었으면 단계·원인·조치', () => {
  const a = readPasswordCsv('title,link,pass\nx,y,z\n');
  assert.equal(a.error.step, 'CSV 형식 확인');
  assert.match(a.error.action, /name,url,username,password/);
  const b = readPasswordCsv('');
  assert.equal(b.error.step, 'CSV 읽기');
});

test('사이트 맞추기: 같은 주소는 바로, 같은 상위 도메인은 후보', () => {
  assert.equal(siteOf('nid.naver.com'), 'naver.com');
  assert.equal(siteOf('www.gmarket.co.kr'), 'gmarket.co.kr');
  assert.equal(siteOf('localhost'), 'localhost');
  const items = [{ host: 'nid.naver.com', username: 'a' }, { host: 'm.naver.com', username: 'b' }, { host: 'naver.com.evil.io', username: 'c' }];
  const m = matchItems(items, 'nid.naver.com');
  assert.deepEqual(m.exact.map((i) => i.username), ['a']);
  assert.deepEqual(m.near.map((i) => i.username), ['b']); // 다른 사이트(evil.io)는 후보에도 안 넣음
});

test('합치기: 같은 주소+아이디는 비밀번호만 바꿈', () => {
  let n = 0;
  const cur = [{ id: 'x', host: 'a.com', username: 'u', password: 'old' }];
  const m = mergeItems(cur, [{ host: 'a.com', username: 'u', password: 'new' }, { host: 'a.com', username: 'u2', password: 'p' }, { host: 'a.com', username: 'u', password: 'new' }], () => `id${n++}`);
  assert.equal(m.added, 1);
  assert.equal(m.updated, 1);
  assert.equal(m.same, 1);
  assert.equal(m.items.find((i) => i.username === 'u').password, 'new');
  assert.equal(cur[0].password, 'old'); // 원본은 그대로
});
