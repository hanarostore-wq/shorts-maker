// 블랙전용(개인용 기능) — 픽팍(mypikpak.com) 재생 버튼 → 팟플레이어: 판단 계산(페이지 쪽 MAIN world 와 단위 시험에서 씀). 유료판에서는 black/ 째 빠진다.
//  근거(2026-10-16 공개 번들 4997.1a2f2e75.js · 8247.4ce0cb66.js 를 직접 읽음):
//   - 카드 ▶ = a.play-icon (onClick → props.openFile(props.file)), 사이트의 '외부 플레이어로 열기'는 d.medias 에서 고른 항목의
//     link.url 을 모듈 75152.bb(url) 에 넘겨 클립보드에 쓰고, 돌려받은 'potplayer:///clipboard' 를 a(target=_blank).click() 으로 연다
//   - 원본 화질 = 응답 medias[] 중 is_origin === true 인 항목(사이트도 같은 값으로 'origin' 을 판단: 모듈 19412). medias[0] 이 아님
//   - 파일 상세 = 모듈 18839.UV(id,{usage:'PLAY'}) (본인 드라이브 파일, 로그인 쿠키 사용)
(() => {
  'use strict';
  if (globalThis.__SMD_PIKPAK_CORE) return;

  class PikpakError extends Error {
    constructor(code, step, reason, action) {
      super(reason);
      this.code = code;
      this.step = step;
      this.reason = reason;
      this.action = action;
    }
  }
  const E = (code, step, reason, action) => new PikpakError(code, step, reason, action);

  // 본인 드라이브 '모든 파일'(폴더 안 포함)만 — 공유·휴지통·압축 내부·기록은 다른 방식이라 범위 밖
  const pathAllowed = (pathname) => /^\/drive\/all(?:\/|$)/.test(String(pathname || ''));

  // 영상 주소: https 만, 아이디·비밀번호 없는 것만. 검사 뒤에도 원형 그대로(href 문자열) 돌려준다(이중 인코딩 없음)
  function validateMediaUrl(raw) {
    let u;
    try {
      u = new URL(String(raw || ''));
    } catch {
      throw E('URL_REJECTED', '영상 주소 확인', '영상 주소 형식이 올바르지 않습니다', '다시 시도하거나 [기본 플레이어로 재생]을 누르세요.');
    }
    if (u.protocol !== 'https:' || u.username || u.password) throw E('URL_REJECTED', '영상 주소 확인', '안전하지 않은 영상 주소라서 넘기지 않았습니다(https 만 허용)', '[기본 플레이어로 재생]을 누르세요.');
    return u.href;
  }

  // 원본 항목 고르기: is_origin === true 인 항목이 정확히 하나일 때만. 첫 항목·이름('원본')·화질 순서로 짐작하지 않는다.
  //  사이트가 화면에 보여 주는 항목(is_visible !== false)이고, 재생 주소(link.url)가 있고, 용량·멤버십을 더 요구하지 않을 때만 쓴다
  function pickOriginal(detail) {
    const medias = Array.isArray(detail?.medias) ? detail.medias : [];
    const origins = medias.filter((m) => m && m.is_origin === true);
    if (!origins.length) throw E('NO_ORIGIN', '원본 화질 찾기', '이 파일에는 원본 화질 항목(is_origin)이 없습니다', '[기본 플레이어로 재생]을 누르거나, 픽팍 앱의 외부 플레이어 메뉴에서 화질을 직접 고르세요.');
    if (origins.length > 1) throw E('AMBIGUOUS_ORIGIN', '원본 화질 찾기', `원본 화질 항목이 ${origins.length}개라서 어느 것이 원본인지 정할 수 없습니다`, '[기본 플레이어로 재생]을 누르세요.');
    const m = origins[0];
    if (m.is_visible === false) throw E('ORIGIN_HIDDEN', '원본 화질 찾기', '사이트가 이 파일의 원본 화질을 보여 주지 않습니다', '[기본 플레이어로 재생]을 누르세요.');
    if (m.need_more_quota) throw E('ORIGIN_NEEDS_QUOTA', '원본 화질 권한 확인', '원본 화질은 이 계정에서 추가 용량(멤버십)이 필요하다고 표시되어 있습니다', '[기본 플레이어로 재생]을 누르거나 픽팍에서 이용 권한을 확인하세요.');
    const url = m.link?.url;
    if (typeof url !== 'string' || !url) throw E('ORIGIN_NO_LINK', '원본 재생 주소 확인', '원본 화질의 재생 주소가 응답에 없습니다', '파일을 새로고침한 뒤 다시 누르거나 [기본 플레이어로 재생]을 누르세요.');
    return { media: m, url: validateMediaUrl(url) };
  }

  // 누른 ▶ 에 해당하는 카드의 파일: Vue 앱 트리를 걸어 props.file 과 props.openFile 이 있고, 그 카드의 화면 요소가 누른 자리를 품은 가장 안쪽 컴포넌트.
  //  (운영 빌드에서는 요소의 __vueParentComponent 가 없을 수 있어, 앱 객체(__vue_app__)에서 내려가며 찾는 방법을 먼저 쓴다)
  function findFileComponent(button, doc = globalThis.document) {
    const ok = (inst) => {
      const p = inst?.props;
      return p && p.file && typeof p.file.id === 'string' && p.file.id && typeof p.openFile === 'function' ? p : null;
    };
    const hasEl = (inst) => {
      const el = inst?.subTree?.el;
      return !!el && typeof el.contains === 'function' && el.contains(button);
    };
    // 1) 요소에 붙은 부모 컴포넌트(개발용 정보가 켜져 있는 빌드)
    for (let el = button; el; el = el.parentElement) {
      for (let vm = el.__vueParentComponent; vm; vm = vm.parent) {
        const p = ok(vm);
        if (p) return { file: p.file, openFile: p.openFile };
      }
    }
    // 2) 앱 객체에서 내려가기
    const apps = [];
    for (const el of [doc?.querySelector?.('#app'), doc?.body, doc?.documentElement]) if (el?.__vue_app__) apps.push(el.__vue_app__);
    for (const el of doc?.querySelectorAll?.('[data-v-app]') || []) if (el.__vue_app__) apps.push(el.__vue_app__);
    let best = null;
    let visited = 0;
    const seen = new Set();
    const walk = (vn, depth) => {
      if (!vn || typeof vn !== 'object' || depth > 400 || visited > 200000 || seen.has(vn)) return;
      seen.add(vn);
      visited++;
      const inst = vn.component;
      if (inst) {
        const p = ok(inst);
        if (p && hasEl(inst)) best = { file: p.file, openFile: p.openFile }; // 더 안쪽에서 또 찾으면 덮어쓴다
        walk(inst.subTree, depth + 1);
      }
      if (vn.suspense?.activeBranch) walk(vn.suspense.activeBranch, depth + 1);
      const ch = vn.children;
      if (Array.isArray(ch)) for (const c of ch) walk(c, depth + 1);
      else if (ch && typeof ch === 'object' && !Array.isArray(ch)) walk(ch, depth + 1);
    };
    for (const app of apps) walk(app._instance?.vnode || app._instance?.subTree, 0);
    if (best) return best;
    throw E('FILE_COMPONENT_UNAVAILABLE', '카드 파일 찾기', '누른 카드에 해당하는 파일을 사이트 화면 구조에서 찾지 못했습니다(사이트가 바뀌었을 수 있음)', '기본 동작으로 넘겼습니다. 계속 그러면 확장 업데이트를 기다려 주세요.');
  }

  // 사이트의 webpack 실행 환경 얻기(참고 방법: 가짜 chunk 를 하나 밀어 넣어 require 를 받는다). 실패하면 닫는다
  function captureRequire(win = globalThis) {
    const chunks = win.webpackChunkpikpak_web;
    if (!Array.isArray(chunks)) throw E('RUNTIME_UNAVAILABLE', '사이트 코드 연결', '픽팍 사이트의 내부 실행 환경(webpackChunkpikpak_web)을 찾지 못했습니다', '[기본 플레이어로 재생]을 누르거나 확장 업데이트를 기다려 주세요.');
    let req;
    try {
      chunks.push([[`smd_pikpak_${Date.now().toString(36)}`], {}, (rt) => {
        req = rt;
      }]);
    } catch {}
    if (typeof req !== 'function') throw E('RUNTIME_INCOMPATIBLE', '사이트 코드 연결', '픽팍 사이트의 내부 실행 환경을 받지 못했습니다(사이트가 바뀌었을 수 있음)', '[기본 플레이어로 재생]을 누르세요.');
    return req;
  }

  // 사이트 모듈 찾기: 알려진 번호(18839 = 파일 상세 UV, 75152 = 팟플레이어 bb)를 먼저 보고, 모양이 안 맞으면 모듈 원문의 표지 글자로 찾는다
  const SRC = Function.prototype.toString;
  function findExport(req, id, marks) {
    const fits = (fn) => typeof fn === 'function' && marks.every((m) => SRC.call(fn).includes(m));
    const tryMod = (mid) => {
      try {
        const ex = req(mid);
        for (const k of Object.keys(ex || {})) if (fits(ex[k])) return ex[k];
      } catch {}
      return null;
    };
    const direct = tryMod(id);
    if (direct) return direct;
    const factories = req.m || {};
    for (const mid of Object.keys(factories)) {
      if (String(mid) === String(id)) continue;
      let src = '';
      try {
        src = SRC.call(factories[mid]);
      } catch {
        continue;
      }
      if (!marks.every((m) => src.includes(m))) continue;
      const f = tryMod(mid);
      if (f) return f;
    }
    return null;
  }
  const findUV = (req) => findExport(req, 18839, ['/files/', 'unzip_password']);
  const findBB = (req) => findExport(req, 75152, ['potplayer:///clipboard']);

  globalThis.__SMD_PIKPAK_CORE = Object.freeze({ PikpakError, pathAllowed, validateMediaUrl, pickOriginal, findFileComponent, captureRequire, findUV, findBB });
  try {
    Object.defineProperty(globalThis, '__SMD_PIKPAK_CORE', { enumerable: false });
  } catch {}
})();
