// 블랙전용(개인용 기능) — 비밀번호 관리(서비스워커 쪽). 유료판에서는 tools/make-paid.mjs 가 이 파일과 import 줄을 뺀다.
//  - 보관: chrome.storage.local 의 blackPwVault(AES-GCM 암호문) + blackPwKey(이 PC 에서 만든 열쇠).
//    사용자 선택으로 마스터 비밀번호는 없다 → 같은 저장소에 열쇠가 있어 이 PC 에 접근한 사람은 풀 수 있음(디스크에 평문으로 남지 않게 하는 정도).
//  - 설정(settings)과 따로 두어 동기화 백업·설정 내보내기에 들어가지 않는다. 비밀번호는 기록(console)에 남기지 않는다.
//  - 페이지(content)는 자기 주소의 항목만 받는다(주소는 메시지 내용이 아니라 브라우저가 알려 준 sender 로 판단)
import { readPasswordCsv, matchItems, mergeItems, hostOf, siteOf } from './black-pw-core.js';

const VAULT = 'blackPwVault';
const KEYK = 'blackPwKey';
const RECENT = 'blackPwRecent';
const UNDO = 'blackPwUndo'; // 되돌리기용(바꾸기 전 비밀번호) — 브라우저를 닫으면 사라지는 저장소, 2분만
// 큰 보관함(비밀번호 수천 개)도 되도록 조금씩 나눠 바꾼다(한 번에 펼치면 'Maximum call stack size exceeded')
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let cache = null; // 풀어 둔 항목(서비스워커가 살아 있는 동안만)
let lock = Promise.resolve();
const serial = (fn) => {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
};

async function key() {
  let { [KEYK]: raw } = await chrome.storage.local.get(KEYK);
  if (!raw) {
    raw = b64(crypto.getRandomValues(new Uint8Array(32)));
    await chrome.storage.local.set({ [KEYK]: raw });
  }
  return crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function load() {
  if (cache) return cache;
  const { [VAULT]: v } = await chrome.storage.local.get(VAULT);
  if (!v) return (cache = []);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, await key(), unb64(v.data));
    cache = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw { step: '비밀번호 보관함 열기', reason: '보관함을 풀지 못했습니다(열쇠가 바뀌었거나 저장소가 손상됨)', action: '확장을 다시 설치했다면 이전 보관함은 열 수 없습니다. CSV 로 다시 불러오세요.' };
  }
  return cache;
}
async function store(items) {
  let rec;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(items)));
    rec = { iv: b64(iv), data: b64(data), n: items.length };
  } catch (err) {
    throw { step: '보관함 암호화', reason: `비밀번호 ${items.length}개를 암호화하지 못했습니다 (${err?.message || err})`, action: '확장을 최신으로 업데이트한 뒤 다시 해 보세요. 계속되면 이 안내를 그대로 보내 주세요.' };
  }
  try {
    await chrome.storage.local.set({ [VAULT]: rec });
  } catch (err) {
    throw { step: '보관함 저장', reason: `확장 저장소에 쓰지 못했습니다 (${err?.message || err})`, action: '디스크 공간을 확인한 뒤 다시 해 보세요.' };
  }
  cache = items;
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
async function opts() {
  const { settings } = await chrome.storage.local.get('settings');
  return { on: settings?.blackPwOn !== false, save: settings?.blackPwSave !== false };
}
const ext = (sender) => sender.id === chrome.runtime.id && String(sender.url || '').startsWith(`chrome-extension://${chrome.runtime.id}/`);
const pageHost = (sender) => (sender.frameId === 0 && sender.tab ? hostOf(sender.url || '') : '');
const STEP = { 'smd:pw-query': '저장된 비밀번호 불러오기', 'smd:pw-pick': '저장된 계정 고르기', 'smd:pw-capture': '비밀번호 저장', 'smd:pw-recent': '저장 알림', 'smd:pw-undo': '저장 되돌리기', 'smd:pw-list': '비밀번호 목록', 'smd:pw-import': 'CSV 합치기', 'smd:pw-delete': '지우기' };
const fail = (e, type) => ({ error: e?.step ? e : { step: STEP[type] || '비밀번호 처리', reason: String(e?.message || e), action: '확장을 최신으로 업데이트한 뒤 다시 해 보세요. 계속되면 이 안내를 그대로 보내 주세요.' } });

const handlers = {
  // ── 페이지(로그인 화면) ──
  async 'smd:pw-query'(msg, sender) {
    const host = pageHost(sender);
    const o = await opts();
    if (!host || !o.on) return { on: false };
    const { exact, near } = matchItems(await load(), host);
    return { on: true, exact: exact.map((i) => ({ id: i.id, username: i.username, password: i.password })), near: near.map((i) => ({ id: i.id, username: i.username, host: i.host })) };
  },
  async 'smd:pw-pick'(msg, sender) {
    const host = pageHost(sender);
    const it = (await load()).find((i) => i.id === msg.id);
    if (!host || !it || siteOf(it.host) !== siteOf(host)) return { error: { step: '저장된 계정 고르기', reason: '이 사이트에 맞는 저장 항목이 아닙니다', action: '팝업 블랙전용 → 비밀번호 목록에서 확인하세요.' } };
    return { username: it.username, password: it.password };
  },
  async 'smd:pw-capture'(msg, sender) {
    const host = pageHost(sender);
    const o = await opts();
    if (!host || !o.on || !o.save || !msg.password) return { result: 'off' };
    return serial(async () => {
      const items = await load();
      const username = String(msg.username || '').trim().slice(0, 200);
      const password = String(msg.password).slice(0, 500);
      const old = items.find((i) => i.host === host && i.username === username);
      let rec;
      if (!old) {
        const it = { id: newId(), host, url: `https://${host}/`, username, password, name: host, at: Date.now() };
        await store([...items, it]);
        rec = { result: 'added', id: it.id };
      } else if (old.password !== password) {
        const prev = old.password;
        await store(items.map((i) => (i === old ? { ...i, password, at: Date.now() } : i)));
        rec = { result: 'updated', id: old.id, prev };
      } else return { result: 'same' };
      // 로그인하면 페이지가 바로 바뀌므로, 다음 페이지에서 알림을 띄우도록 잠깐 기억(브라우저를 닫으면 사라지는 저장소)
      const { prev, ...pub } = rec;
      await chrome.storage.session.set({ [RECENT]: { ...pub, tabId: sender.tab.id, site: siteOf(host), username, at: Date.now() }, [UNDO]: { id: rec.id, result: rec.result, prev, at: Date.now() } }).catch(() => {});
      return { result: rec.result, id: rec.id };
    });
  },
  async 'smd:pw-recent'(msg, sender) {
    const host = pageHost(sender);
    const { [RECENT]: r } = await chrome.storage.session.get(RECENT).catch(() => ({}));
    if (!host || !r || r.tabId !== sender.tab.id || r.site !== siteOf(host) || Date.now() - r.at > 60000) return {};
    await chrome.storage.session.remove(RECENT).catch(() => {});
    return { result: r.result, id: r.id, username: r.username };
  },
  async 'smd:pw-undo'(msg, sender) {
    const host = pageHost(sender);
    return serial(async () => {
      const items = await load();
      const it = items.find((i) => i.id === msg.id);
      if (!host || !it || siteOf(it.host) !== siteOf(host)) return { error: { step: '저장 되돌리기', reason: '되돌릴 항목을 찾지 못했습니다', action: '팝업 블랙전용 → 비밀번호 목록에서 직접 지우세요.' } };
      const { [UNDO]: u } = await chrome.storage.session.get(UNDO).catch(() => ({}));
      if (!u || u.id !== it.id || Date.now() - u.at > 120000) return { error: { step: '저장 되돌리기', reason: '되돌릴 수 있는 시간(2분)이 지났습니다', action: '팝업 블랙전용 → 비밀번호 목록에서 직접 지우세요.' } };
      if (u.result === 'added') await store(items.filter((i) => i !== it));
      else await store(items.map((i) => (i === it ? { ...i, password: u.prev } : i)));
      await chrome.storage.session.remove(UNDO).catch(() => {});
      return { ok: true, result: u.result };
    });
  },
  // ── 팝업(블랙전용 탭) ──
  async 'smd:pw-list'(msg, sender) {
    if (!ext(sender)) return { error: { step: '목록 보기', reason: '확장 팝업에서만 볼 수 있습니다', action: '' } };
    return { items: (await load()).map(({ id, host, username, password, at }) => ({ id, host, username, password, at })) };
  },
  async 'smd:pw-import'(msg, sender) {
    if (!ext(sender)) return { error: { step: 'CSV 불러오기', reason: '확장 팝업에서만 할 수 있습니다', action: '' } };
    const r = readPasswordCsv(msg.text);
    if (r.error) return r;
    return serial(async () => {
      const m = mergeItems(await load(), r.items, newId);
      await store(m.items);
      return { added: m.added, updated: m.updated, same: m.same, skipped: r.skipped, total: m.items.length };
    });
  },
  async 'smd:pw-delete'(msg, sender) {
    if (!ext(sender)) return { error: { step: '지우기', reason: '확장 팝업에서만 할 수 있습니다', action: '' } };
    return serial(async () => {
      const items = await load();
      const next = items.filter((i) => i.id !== msg.id);
      if (next.length === items.length) return { error: { step: '지우기', reason: '그 항목을 찾지 못했습니다(이미 지워짐)', action: '목록을 다시 여세요.' } };
      await store(next);
      return { ok: true, total: next.length };
    });
  },
};

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  const h = handlers[msg?.type];
  if (!h) return;
  h(msg, sender).then(send, (e) => send(fail(e, msg.type)));
  return true;
});
