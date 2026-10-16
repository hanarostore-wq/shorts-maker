import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/black/black-pikpak-core.js';

const core = globalThis.__SMD_PIKPAK_CORE;
const media = (o) => ({ is_visible: true, is_origin: false, link: { url: 'https://cdn.example/x?sig=a%2Bb&e=1' }, ...o });
const detail = (medias) => ({ id: 'F1', medias });

test('원본 고르기: medias[0] 이 아니라 is_origin === true 인 항목(순서·이름과 무관)', () => {
  const r = core.pickOriginal(detail([
    media({ media_name: '1080P', link: { url: 'https://cdn.example/1080' } }),
    media({ media_name: '원본처럼 보이는 이름', link: { url: 'https://cdn.example/decoy' } }),
    media({ media_name: 'Original', is_origin: true, link: { url: 'https://cdn.example/orig?token=A%2FB&x=1' } }),
    media({ media_name: '720P', link: { url: 'https://cdn.example/720' } }),
  ]));
  assert.equal(r.media.media_name, 'Original');
  assert.equal(r.url, 'https://cdn.example/orig?token=A%2FB&x=1'); // 쿼리 원형 그대로(이중 인코딩 없음)
});

test('원본이 첫 항목이어도, 뒤에 있어도 같은 결과', () => {
  const o = media({ is_origin: true, media_name: 'O', link: { url: 'https://cdn.example/o' } });
  const other = media({ media_name: '1080P' });
  assert.equal(core.pickOriginal(detail([o, other])).url, 'https://cdn.example/o');
  assert.equal(core.pickOriginal(detail([other, other, o])).url, 'https://cdn.example/o');
});

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return 'NO_ERROR';
};

test('원본이 없거나 둘 이상이면 짐작하지 않고 오류(단계·원인·조치 포함)', () => {
  assert.equal(code(() => core.pickOriginal(detail([media({ media_name: '1080P' }), media({ media_name: '720P' })]))), 'NO_ORIGIN');
  assert.equal(code(() => core.pickOriginal(detail([]))), 'NO_ORIGIN');
  assert.equal(code(() => core.pickOriginal({})), 'NO_ORIGIN');
  assert.equal(code(() => core.pickOriginal(null)), 'NO_ORIGIN');
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: true }), media({ is_origin: true })]))), 'AMBIGUOUS_ORIGIN');
  try {
    core.pickOriginal(detail([]));
  } catch (e) {
    assert.ok(e.step && e.reason && e.action);
  }
});

test('is_origin 이 참(true)이 아닌 값("true"·1)은 원본으로 보지 않음', () => {
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: 'true' }), media({ is_origin: 1 })]))), 'NO_ORIGIN');
});

test('원본이 있어도 숨김·권한 필요·주소 없음이면 오류', () => {
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: true, is_visible: false })]))), 'ORIGIN_HIDDEN');
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: true, need_more_quota: true })]))), 'ORIGIN_NEEDS_QUOTA');
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: true, link: undefined })]))), 'ORIGIN_NO_LINK');
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: true, link: { url: '' } })]))), 'ORIGIN_NO_LINK');
  // is_visible 가 없는 항목(undefined)은 사이트도 보이는 것으로 취급
  assert.equal(code(() => core.pickOriginal(detail([media({ is_origin: true, is_visible: undefined })]))), 'NO_ERROR');
});

test('영상 주소 검사: https 만, 아이디·비밀번호·다른 스킴·깨진 주소는 거부', () => {
  assert.equal(core.validateMediaUrl('https://a.example/p?x=1&y=%2B'), 'https://a.example/p?x=1&y=%2B');
  for (const u of ['http://a.example/x', 'ftp://a.example/x', 'https://u:p@a.example/x', 'javascript:alert(1)', 'potplayer:///clipboard', 'not a url', '', undefined]) assert.equal(code(() => core.validateMediaUrl(u)), 'URL_REJECTED');
});

test('범위: 주소로 막지 않음(사이트 전체), 주소가 없으면 안 함', () => {
  for (const p of ['/drive/all', '/drive/recent', '/drive/share/abc', '/drive/trash', '/anything']) assert.equal(core.pathAllowed(p), true);
  for (const p of ['', undefined, null]) assert.equal(core.pathAllowed(p), false);
});

// ── 카드 ↔ 파일 연결 ──
const fakeEl = (children = []) => {
  const el = { children, parentElement: null, contains: (n) => n === el || children.some((c) => c.contains(n)) };
  children.forEach((c) => (c.parentElement = el));
  return el;
};
test('카드 찾기: 앱 객체에서 내려가며 누른 ▶ 를 품은 가장 안쪽 카드의 file 을 고름(다른 카드와 안 섞임)', () => {
  const open1 = () => 'o1';
  const open2 = () => 'o2';
  const btn1 = fakeEl();
  const btn2 = fakeEl();
  const card1 = fakeEl([btn1]);
  const card2 = fakeEl([btn2]);
  const list = fakeEl([card1, card2]);
  const inst1 = { props: { file: { id: 'F1' }, openFile: open1 }, subTree: { el: card1, children: [] } };
  const inst2 = { props: { file: { id: 'F2' }, openFile: open2 }, subTree: { el: card2, children: [] } };
  const listInst = { props: {}, subTree: { el: list, children: [{ component: inst1 }, { component: inst2 }] } };
  const root = { vnode: { component: listInst } };
  const doc = { querySelector: () => ({ __vue_app__: { _instance: root } }), querySelectorAll: () => [], body: {}, documentElement: {} };
  const a = core.findFileComponent(btn1, doc);
  const b = core.findFileComponent(btn2, doc);
  assert.equal(a.file.id, 'F1');
  assert.equal(b.file.id, 'F2');
  assert.equal(b.openFile(), 'o2');
});

test('카드 찾기: 요소의 __vueParentComponent 가 있으면 그것을 먼저(개발용 정보가 켜진 빌드)', () => {
  const btn = fakeEl();
  const card = fakeEl([btn]);
  btn.__vueParentComponent = { props: {}, parent: { props: { file: { id: 'FX' }, openFile: () => 1 } } };
  void card;
  assert.equal(core.findFileComponent(btn, { querySelector: () => null, querySelectorAll: () => [] }).file.id, 'FX');
});

test('카드 찾기: 못 찾으면 오류 코드 FILE_COMPONENT_UNAVAILABLE(막지 않고 원래 동작으로 두는 신호)', () => {
  const btn = fakeEl();
  assert.equal(code(() => core.findFileComponent(btn, { querySelector: () => null, querySelectorAll: () => [] })), 'FILE_COMPONENT_UNAVAILABLE');
  // file 은 있는데 openFile 이 없거나 id 가 문자열이 아니면 거부
  const card = fakeEl([btn]);
  const inst = { props: { file: { id: 7 }, openFile: () => 1 }, subTree: { el: card, children: [] } };
  const doc = { querySelector: () => ({ __vue_app__: { _instance: { vnode: { component: inst } } } }), querySelectorAll: () => [] };
  assert.equal(code(() => core.findFileComponent(btn, doc)), 'FILE_COMPONENT_UNAVAILABLE');
});

// ── 사이트 모듈 찾기 ──
test('모듈 찾기: 알려진 번호의 내보내기를 모양(원문 표지 글자)으로 확인, 번호가 바뀌어도 원문으로 찾음', () => {
  function UV(id, o) { return `${'/files/'}${id}${o.unzip_password}`; }
  // 실제 bb 는 async 래퍼라 함수 원문에 'potplayer:///clipboard' 글자가 없다
  const inner = async (u) => { void u; return 'potplayer:///clipboard'; };
  const bb = function (e) { return inner.apply(this, arguments); };
  const mods = { 18839: { UV }, 75152: { bb, Hy: {} } };
  const req = Object.assign((id) => mods[id], { m: { 18839: () => 0, 75152: () => 0 } });
  assert.equal(core.findUV(req), UV);
  assert.equal(core.findBB(req), bb);
  // 번호가 바뀐 경우: 다른 번호의 모듈 원문에 표지 글자가 있으면 그것을 씀
  const moved = { 999: { zz: UV }, 888: { bb } };
  const req2 = Object.assign((id) => { if (!moved[id]) throw new Error('no module'); return moved[id]; }, { m: { 999: function f() { return '/files/ unzip_password'; }, 888: function g() { return { bb: function () {}, x: 'potplayer:///clipboard' }; } } });
  assert.equal(core.findUV(req2), UV);
  assert.equal(core.findBB(req2), bb);
  // 아무데도 없으면 null (호출한 쪽이 '사이트 코드 연결' 오류로 닫음)
  assert.equal(core.findUV(Object.assign(() => ({}), { m: {} })), null);
});

test('webpack 실행 환경: 가짜 chunk 를 밀어 넣어 require 를 받고, 없거나 안 받으면 오류', () => {
  const rt = () => 1;
  const chunks = [];
  chunks.push = (c) => c[2](rt); // 사이트의 webpack 은 push 를 가로채 실행 환경을 넘겨 준다
  const win = { webpackChunkpikpak_web: chunks };
  assert.equal(core.captureRequire(win), rt);
  assert.equal(code(() => core.captureRequire({})), 'RUNTIME_UNAVAILABLE');
  assert.equal(code(() => core.captureRequire({ webpackChunkpikpak_web: [] })), 'RUNTIME_INCOMPATIBLE');
});

test('카드 찾기: 카드 루트가 조각(el 이 ▶ 를 못 품음)이어도 vnode.el === 누른 요소 로 정확히 고름, 앱이 #app 이 아닌 곳에 붙어도 찾음', () => {
  const btn = fakeEl();
  const frag = { contains: () => false };
  const inst = { props: { file: { id: 'FG' }, openFile: () => 1 }, subTree: { el: frag, children: [{ el: btn, children: null }] } };
  const host = fakeEl();
  host.__vue_app__ = { _instance: { vnode: { component: inst } } };
  const doc = { querySelector: () => null, querySelectorAll: () => [], body: { children: [host] } };
  assert.equal(core.findFileComponent(btn, doc).file.id, 'FG');
});

test('카드 찾기: 운영 빌드처럼 app._instance 가 없어도 앱 요소의 _container._vnode 에서 내려가 찾음(실제 픽팍에서 확인된 구조)', () => {
  const btn = fakeEl();
  const card = fakeEl([btn]);
  const inst = { props: { file: { id: 'PR' }, openFile: () => 1 }, subTree: { el: card, children: [] } };
  const host = fakeEl();
  const vnode = { component: { props: {}, subTree: { el: host, children: [{ component: inst }] } } };
  host.__vue_app__ = { _container: { _vnode: vnode } };
  const doc = { querySelector: () => host, querySelectorAll: () => [], body: {} };
  assert.equal(core.findFileComponent(btn, doc).file.id, 'PR');
});

test('모듈 찾기: 목록 함수(p, 같은 글자·label: 을 품음)가 bb 보다 앞에 있어도 bb 를 고름(실제 픽팍에서 나온 오류), bb 가 없으면 null', () => {
  const p = function p() { return { win2: [{ label: 'PotPlayer', value: 'potplayer:///clipboard' }] }; };
  const inner = async () => 'potplayer:///clipboard';
  const bb = function (e) { return inner.apply(this, arguments); };
  const req = Object.assign((id) => (id === 75152 ? { L5: p, bb } : {}), { m: {} });
  assert.equal(core.findBB(req), bb);
  const noBb = Object.assign((id) => (id === 75152 ? { L5: p } : {}), { m: {} });
  assert.equal(core.findBB(noBb), null);
});

// ── 공유 링크 ──
test('공유 링크: 주소 첫 조각이 공유 번호(뒤 조각을 파일 번호로 보지 않음), 내 드라이브 주소는 해당 없음', () => {
  assert.equal(core.sharePathId('/s/VOy2/AAD/AAB'), 'VOy2');
  assert.equal(core.sharePathId('/s/VOy2'), 'VOy2');
  assert.equal(core.sharePathId('/drive/all'), '');
  assert.equal(core.sharePathId('/share/x'), '');
});

test('공유 링크: 응답에서 원본 고르기 — 오류·상태·파일 불일치는 단계·원인과 함께 거부, 원본은 is_origin 만', () => {
  const m = (o) => Object.assign({ is_visible: true, is_origin: false, link: { url: 'https://c.test/x' } }, o);
  const ok = { data: { value: { share_status: 'OK', file_info: { id: 'A', medias: [m({}), m({ is_origin: true, link: { url: 'https://c.test/o?s=a%2Bb' } })] } } }, error: { value: null } };
  assert.equal(core.pickShareOriginal(ok, 'A').url, 'https://c.test/o?s=a%2Bb');
  assert.equal(code(() => core.pickShareOriginal({ error: { value: { m: 1 } } }, 'A')), 'DETAIL_REQUEST_FAILED');
  assert.equal(code(() => core.pickShareOriginal({ data: { value: null }, error: { value: null } }, 'A')), 'DETAIL_UNAVAILABLE');
  assert.equal(code(() => core.pickShareOriginal({ data: { value: { share_status: 'EXPIRED', file_info: null } }, error: { value: null } }, 'A')), 'SHARE_NOT_OK');
  assert.equal(code(() => core.pickShareOriginal(ok, 'B')), 'DETAIL_UNAVAILABLE');
  const none = { data: { value: { share_status: 'OK', file_info: { id: 'A', medias: [m({})] } } }, error: { value: null } };
  assert.equal(code(() => core.pickShareOriginal(none, 'A')), 'NO_ORIGIN');
});

test('공유 링크: 접근 토큰은 사이트의 $getPasscodeToken() 값, 없으면 SHARE_TOKEN_MISSING, 공유 번호 없으면 SHARE_ID_MISSING', () => {
  const root = { __vue_app__: { config: { globalProperties: { $getPasscodeToken: () => ({ value: 'T0K' }) } } } };
  const doc = { querySelector: (q) => (q === '#__pikcloud' ? root : null), body: { children: [] } };
  const c = core.shareContext(doc, '/s/SID/xx');
  assert.equal(c.shareId, 'SID');
  assert.equal(c.token, 'T0K');
  const none = { querySelector: () => null, body: { children: [] } };
  assert.equal(code(() => core.shareContext(none, '/s/SID')), 'SHARE_TOKEN_MISSING');
  assert.equal(code(() => core.shareContext(doc, '/drive/all')), 'SHARE_ID_MISSING');
});

test('공유 카드 찾기: props.file + viewType 이 있고 emit 이 있는 카드(openFile 함수 없음) — 열기는 emit(openFile, file)', () => {
  const btn = fakeEl();
  const card = fakeEl([btn]);
  const emitted = [];
  const inst = { props: { file: { id: 'SF' }, viewType: 'grid' }, emit: (...a) => emitted.push(a), subTree: { el: card, children: [] } };
  const host = fakeEl();
  host.__vue_app__ = { _container: { _vnode: { component: { props: {}, subTree: { el: host, children: [{ component: inst }] } } } } };
  const doc = { querySelector: () => host, querySelectorAll: () => [], body: {} };
  const f = core.findFileComponent(btn, doc, { share: true });
  assert.equal(f.file.id, 'SF');
  f.openFile();
  assert.equal(emitted[0][0], 'openFile');
  // 내 드라이브 방식(share:false)으로는 openFile 함수가 없어 못 찾음
  assert.equal(code(() => core.findFileComponent(btn, doc)), 'FILE_COMPONENT_UNAVAILABLE');
});
