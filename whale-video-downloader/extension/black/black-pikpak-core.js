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

  // 픽팍 사이트 전체(공유 링크 /s/ 는 별도 방식). 화면별로 막지 않고, 안 되는 화면(휴지통·압축 내부 등)은 실패 안내로 알린다
  const pathAllowed = (pathname) => typeof pathname === 'string' && pathname.startsWith('/'); // 범위를 주소로 제한하지 않는다: 어느 화면이든 시도하고, 카드 연결·파일 조회가 안 되면 단계·원인 안내 + [기본 플레이어로 재생]

  // 공유 링크 화면(/s/<공유ID>/...): 앱 구조가 다르다(Nuxt/Vite). 공유 ID 는 /s/ 다음 첫 조각
  const sharePathId = (pathname) => (String(pathname || '').match(/^\/s\/([^/]+)(?:\/|$)/) || [])[1] || '';

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
  function findFileComponent(button, doc = globalThis.document, { share = false } = {}) {
    // 내 드라이브 카드: props.file + props.openFile(함수). 공유 카드(ShareFileItem): props.file + viewType 만 있고 열기는 emit('openFile', file) 로 한다
    const ok = (inst) => {
      const p = inst?.props;
      if (!p || !p.file || typeof p.file.id !== 'string' || !p.file.id) return null;
      if (!share) return typeof p.openFile === 'function' ? { file: p.file, openFile: p.openFile } : null;
      if ('viewType' in p && typeof inst.emit === 'function') return { file: p.file, openFile: () => inst.emit('openFile', p.file) };
      return null;
    };
    const hasEl = (inst) => {
      const el = inst?.subTree?.el;
      return !!el && typeof el.contains === 'function' && el.contains(button);
    };
    // 1) 요소에 붙은 부모 컴포넌트(개발용 정보가 켜져 있는 빌드)
    for (let el = button; el; el = el.parentElement) {
      for (let vm = el.__vueParentComponent; vm; vm = vm.parent) {
        const p = ok(vm);
        if (p) return p;
      }
    }
    // 2) 앱 객체에서 내려가기: 누른 요소의 조상·#app·body 자식 등에서 __vue_app__ 을 모은다(앱을 붙인 요소 id 가 달라도 찾도록)
    const apps = [];
    const roots = [];
    const addApp = (el) => {
      if (el?._vnode) roots.push(el);
      const ap = el?.__vue_app__;
      if (ap && !apps.includes(ap)) apps.push(ap);
    };
    for (let el = button; el; el = el.parentElement) addApp(el);
    for (const el of [doc?.querySelector?.('#app'), doc?.body, doc?.documentElement]) addApp(el);
    for (const el of doc?.querySelectorAll?.('[data-v-app]') || []) addApp(el);
    for (const el of doc?.body?.children || []) addApp(el);
    let best = null;
    let visited = 0;
    const seen = new Set();
    // owner = 지금까지 내려온 길에서 가장 안쪽의 '파일 카드' 컴포넌트. 누른 요소 자체(vn.el === button)를 만나면 그 owner 가 답(조각 루트여도 정확)
    const walk = (vn, depth, owner) => {
      if (!vn || typeof vn !== 'object' || depth > 400 || visited > 200000 || seen.has(vn)) return;
      seen.add(vn);
      visited++;
      if (vn.el === button && owner) best = owner;
      const inst = vn.component;
      let own = owner;
      if (inst) {
        const p = ok(inst);
        if (p) {
          own = p;
          if (hasEl(inst)) best = own; // 더 안쪽에서 또 찾으면 덮어쓴다
        }
        walk(inst.subTree, depth + 1, own);
      }
      if (vn.suspense?.activeBranch) walk(vn.suspense.activeBranch, depth + 1, own);
      const ch = vn.children;
      if (Array.isArray(ch)) for (const c of ch) walk(c, depth + 1, own);
      else if (ch && typeof ch === 'object') walk(ch, depth + 1, own);
    };
    // 운영 빌드에는 app._instance 가 없다(실제 사이트에서 확인) → 앱을 붙인 요소의 _vnode(루트 가상 노드)에서 내려간다
    for (const app of apps) walk(app._instance?.vnode || app._container?._vnode || app._instance?.subTree, 0, null);
    for (const el of roots) walk(el._vnode, 0, null);
    if (best) return best;
    const err = E('FILE_COMPONENT_UNAVAILABLE', '카드 파일 찾기', `누른 카드에 해당하는 파일을 사이트 화면 구조에서 찾지 못했습니다(사이트가 바뀌었을 수 있음) [앱 ${apps.length}개, 검사 ${visited}칸]`, '기본 동작으로 넘겼습니다. 이 안내를 개발자에게 알려 주세요.');
    err.diag = { apps: apps.length, visited };
    throw err;
  }

  // ── 공유 링크 화면 ──
  // 파일 조회 함수: 공유 앱은 Vite ESM 이라 webpack 이 없다. 이미 불러온 같은 출처 .js 모듈들(같은 주소는 브라우저가 한 번만 실행)을 import 해서
  //  원문에 '/share/file_info' 와 'x-global-file-token' 이 있는 내보내기 함수를 쓴다(파일 이름·내보내기 이름은 배포마다 바뀜: 실제 사이트에서 확인)
  let shareFnCache = null;
  async function findShareFileInfo(win = globalThis) {
    if (shareFnCache) return shareFnCache;
    let urls = [];
    try {
      urls = [...new Set(win.performance.getEntriesByType('resource').map((e) => e.name))].filter((u) => {
        try {
          const x = new URL(u);
          return x.origin === win.location.origin && /\.m?js$/.test(x.pathname);
        } catch {
          return false;
        }
      });
    } catch {}
    for (const u of urls) {
      let mod;
      try {
        mod = await import(/* webpackIgnore: true */ u);
      } catch {
        continue;
      }
      for (const k of Object.keys(mod || {})) {
        const f = mod[k];
        if (typeof f !== 'function') continue;
        let src = '';
        try {
          src = SRC.call(f);
        } catch {
          continue;
        }
        if (src.includes('/share/file_info') && src.includes('x-global-file-token')) return (shareFnCache = f);
      }
    }
    throw E('API_INCOMPATIBLE', '사이트 코드 연결', '픽팍 공유 화면의 파일 조회 기능을 찾지 못했습니다(사이트가 바뀌었을 수 있음)', '[기본 플레이어로 재생]을 누르세요.');
  }
  // 공유 접근 토큰: 사이트가 제공하는 $getPasscodeToken() (값은 메모리에서만 쓰고 어디에도 남기지 않는다)
  function shareContext(doc = globalThis.document, pathname = globalThis.location?.pathname) {
    const shareId = sharePathId(pathname);
    if (!shareId) throw E('SHARE_ID_MISSING', '공유 정보 확인', '주소에서 공유 번호를 찾지 못했습니다', '공유 링크 첫 화면에서 다시 눌러 보세요.');
    let token = '';
    try {
      const root = doc.querySelector('#__pikcloud') || doc.querySelector('#__nuxt') || doc.querySelector('#app');
      const gp = (root?.__vue_app__ || [...(doc.body?.children || [])].map((el) => el.__vue_app__).find(Boolean))?.config?.globalProperties;
      const t = gp?.$getPasscodeToken?.();
      token = String(t?.value ?? '');
    } catch {}
    if (!token) throw E('SHARE_TOKEN_MISSING', '공유 접근 확인', '공유 접근 토큰을 사이트에서 받지 못했습니다(접근 코드 입력이 필요하거나 아직 불러오는 중일 수 있음)', '공유 화면이 완전히 열린 뒤 다시 누르세요.');
    return { shareId, token };
  }
  // 공유 파일 상세 응답 → 원본. 응답은 사이트의 ref 형태(error.value / data.value)
  function pickShareOriginal(res, fileId) {
    if (res?.error?.value) throw E('DETAIL_REQUEST_FAILED', '공유 파일 정보 조회', '픽팍이 공유 파일 정보를 주지 않았습니다(만료·삭제·접근 코드·네트워크 문제일 수 있음)', '공유 화면을 새로고침하고 접근 코드를 확인한 뒤 다시 누르세요.');
    const d = res?.data?.value;
    if (!d) throw E('DETAIL_UNAVAILABLE', '공유 파일 정보 조회', '공유 파일 정보가 비어 있습니다', '다시 눌러 보세요.');
    if (d.share_status !== 'OK') throw E('SHARE_NOT_OK', '공유 상태 확인', `공유 링크 상태가 정상이 아닙니다(${String(d.share_status).slice(0, 40)})`, '링크 만료·삭제·접근 코드를 확인하세요.');
    const fi = d.file_info;
    if (!fi || fi.id !== fileId) throw E('DETAIL_UNAVAILABLE', '공유 파일 정보 조회', '받은 파일 정보가 누른 파일과 맞지 않습니다', '다시 눌러 보세요.');
    return pickOriginal(fi);
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
  function findExport(req, id, marks, { prefer = '', deny = [] } = {}) {
    const fits = (fn) => typeof fn === 'function' && marks.every((m) => SRC.call(fn).includes(m)) && !deny.some((m) => SRC.call(fn).includes(m));
    const tryMod = (mid) => {
      try {
        const ex = req(mid);
        if (prefer && fits(ex?.[prefer])) return ex[prefer];
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
  // bb 는 async 래퍼라서 함수 원문에 'potplayer:///clipboard' 글자가 없다(실제 사이트에서 확인: 글자는 같은 모듈의 목록 함수 p 에만 있음).
  //  그래서 원문 표지로는 못 찾고, 모듈(factory) 원문에 표지가 있는 모듈의 내보내기 중 이름이 bb 인 함수를 쓴다. 목록 함수(label: 을 품음)는 거른다
  function findBB(req) {
    const good = (fn) => typeof fn === 'function' && !SRC.call(fn).includes('label:');
    const fromMod = (mid) => {
      try {
        const ex = req(mid);
        if (good(ex?.bb)) return ex.bb;
      } catch {}
      return null;
    };
    const direct = fromMod(75152);
    if (direct) return direct;
    const factories = req.m || {};
    for (const mid of Object.keys(factories)) {
      if (String(mid) === '75152') continue;
      let src = '';
      try {
        src = SRC.call(factories[mid]);
      } catch {
        continue;
      }
      if (!src.includes('potplayer:///clipboard') || !/\bbb:\s*function/.test(src)) continue;
      const f = fromMod(mid);
      if (f) return f;
    }
    return null;
  }

  globalThis.__SMD_PIKPAK_CORE = Object.freeze({ PikpakError, pathAllowed, sharePathId, findShareFileInfo, shareContext, pickShareOriginal, validateMediaUrl, pickOriginal, findFileComponent, captureRequire, findUV, findBB });
  try {
    Object.defineProperty(globalThis, '__SMD_PIKPAK_CORE', { enumerable: false });
  } catch {}
})();
