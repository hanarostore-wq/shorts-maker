// 블랙전용(개인용 기능) — 비밀번호 관리 공용 함수(서비스워커·단위 시험에서 씀). 유료판에서는 black/ 째 빠진다.
//  - CSV 읽기(크롬·웨일 내보내기 형식: name,url,username,password,note)
//  - 사이트 맞추기: 같은 주소(호스트)면 자동 입력, 같은 상위 도메인(예: m.naver.com ↔ nid.naver.com)이면 고를 수 있게 후보로

// 따옴표·쉼표·줄바꿈이 든 칸까지 읽는 CSV 읽기
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// 비밀번호 CSV → { items:[{url,host,username,password,name}], skipped:[{line, why}] } / 형식이 다르면 error
export function readPasswordCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { error: { step: 'CSV 읽기', reason: '파일이 비어 있습니다', action: '크롬·웨일의 비밀번호 내보내기로 만든 CSV 파일을 고르세요.' } };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iUrl = col('url', 'origin', 'website', 'login_uri', '주소', 'url 주소');
  const iUser = col('username', 'login', 'user', 'login_username', '아이디', '사용자 이름');
  const iPass = col('password', 'login_password', '비밀번호');
  const iName = col('name', 'title', '이름');
  if (iUrl < 0 || iPass < 0) return { error: { step: 'CSV 형식 확인', reason: `첫 줄에 url·password 칸이 없습니다 (첫 줄: ${rows[0].slice(0, 6).join(', ').slice(0, 80)})`, action: '크롬·웨일 비밀번호 설정의 "비밀번호 내보내기"로 만든 CSV 를 고르세요. 첫 줄이 name,url,username,password 이어야 합니다.' } };
  const items = [];
  const skipped = [];
  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const url = (r[iUrl] || '').trim();
    const password = r[iPass] || '';
    const host = hostOf(url);
    if (!host) return skipped.push({ line, why: url ? '주소를 읽을 수 없음' : '주소 없음' });
    if (!password) return skipped.push({ line, why: '비밀번호 없음' });
    items.push({ url, host, username: iUser >= 0 ? (r[iUser] || '').trim() : '', password, name: iName >= 0 ? (r[iName] || '').trim() : '' });
  });
  return { items, skipped };
}

export function hostOf(url) {
  try {
    const u = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return /^https?:$/.test(u.protocol) || u.protocol === 'android:' ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

// 상위 도메인(간단판): co.kr·com.au 처럼 두 단계 국가 도메인이면 세 칸, 아니면 두 칸
const TWO = /^(co|or|ne|go|ac|re|pe|com|net|org|gov|edu)\.[a-z]{2}$/;
export function siteOf(host) {
  const p = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (p.length <= 2 || /^\d+$/.test(p[p.length - 1])) return p.join('.');
  const last2 = p.slice(-2).join('.');
  return TWO.test(last2) ? p.slice(-3).join('.') : last2;
}

// 그 주소에 맞는 저장 항목: exact(같은 호스트) 먼저, 그다음 같은 상위 도메인
export function matchItems(items, host) {
  const h = String(host || '').toLowerCase();
  const exact = items.filter((i) => i.host === h);
  const site = siteOf(h);
  const near = items.filter((i) => i.host !== h && siteOf(i.host) === site);
  return { exact, near };
}

// 가져온 항목 합치기: 같은 호스트+아이디면 비밀번호만 바꿈
export function mergeItems(cur, incoming, newId) {
  const out = cur.map((i) => ({ ...i }));
  let added = 0;
  let updated = 0;
  let same = 0;
  for (const n of incoming) {
    const old = out.find((i) => i.host === n.host && i.username === n.username);
    if (!old) {
      out.push({ id: newId(), host: n.host, url: n.url, username: n.username, password: n.password, name: n.name || '', at: Date.now() });
      added++;
    } else if (old.password !== n.password) {
      old.password = n.password;
      old.at = Date.now();
      updated++;
    } else same++;
  }
  return { items: out, added, updated, same };
}
