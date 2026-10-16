// 블랙전용(개인용 기능) — 픽팍(mypikpak.com): 폴더에 들어갔다가 뒤로가기(·앞으로가기)로 돌아오면 목록이 맨 위로 가 버리는 것을, 떠나기 전 스크롤 위치로 되돌린다. 페이지 쪽(MAIN world). 유료판에서는 black/ 째 빠진다.
//  - 폴더(주소)마다 스크롤 위치를 기억(이 탭 메모리). 폴더로 '들어갈' 때는 건드리지 않고(맨 위에서 시작), 뒤로·앞으로(popstate)일 때만 복원
//  - 목록은 스크롤하며 이어서 불러오는 방식이라, 위치까지 내용이 채워질 때까지 기다리며(최대 2.5초) 맞춘다. 그동안 목록을 숨겨 내려가는 모습이 보이지 않게 하고, 끝나거나 시간이 다 되거나 사용자가 조작하면 반드시 다시 보이게 한다
//  - 켜고 끄기: 팝업 블랙전용 탭의 '폴더 뒤로가기 스크롤 복원' 스위치(<html data-smd-pikpak-scroll="0|1">, 기본 켬) · 픽팍 전체 스위치 · '이 사이트 제외'(<html data-smd-off>)
(() => {
  'use strict';
  if (globalThis.__smdPikpakScroll) return;
  Object.defineProperty(globalThis, '__smdPikpakScroll', { value: true, enumerable: false });
  const root = () => document.documentElement;
  const enabled = () => !root()?.hasAttribute('data-smd-off') && root()?.dataset.smdPikpak !== '0' && root()?.dataset.smdPikpakScroll !== '0';
  const SCROLLER = '.file-explorer .el-scrollbar__wrap';
  const MAX_WAIT = 2500;
  const STABLE = 600;
  const keyOf = () => location.pathname + location.search;

  const pos = new Map();
  let lastNavAt = 0;
  let userSince = false; // 이동한 뒤 사용자가 직접 스크롤했는가(그때부터 위치를 기록)
  let restoreToken = 0;

  const scroller = () => document.querySelector(SCROLLER);
  const pageTop = () => document.scrollingElement;

  // 위치 기록: 이동 직후 사이트가 목록을 맨 위로 되감을 때 생기는 스크롤은 기록하지 않는다(사용자 조작이 있었거나 이동 후 충분히 지났을 때만)
  document.addEventListener(
    'scroll',
    (e) => {
      if (!enabled()) return;
      const el = scroller();
      const t = e.target === document ? pageTop() : e.target;
      if (t !== el && t !== pageTop()) return;
      if (!userSince && Date.now() - lastNavAt < 1500) return;
      pos.set(keyOf(), t.scrollTop);
    },
    true,
  );
  const markUser = () => {
    userSince = true;
  };
  for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) document.addEventListener(ev, markUser, { capture: true, passive: true });

  // 이동 감지: 폴더로 들어가기(pushState/replaceState)는 '새 이동'(기록 초기화), 뒤로·앞으로(popstate)는 복원
  const onNav = () => {
    lastNavAt = Date.now();
    userSince = false;
  };
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () {
      const before = keyOf();
      const r = orig.apply(this, arguments);
      if (keyOf() !== before) onNav();
      return r;
    };
  }
  window.addEventListener('popstate', () => {
    onNav();
    if (!enabled()) return;
    const want = pos.get(keyOf());
    if (want > 0) restore(want);
  });

  function restore(want) {
    const token = ++restoreToken;
    const started = Date.now();
    let hidden = null;
    let userStop = false;
    let stableSince = 0; // 위치가 맞은 채 이 시간만큼 유지돼야 끝낸다(이동 직후엔 이전 목록이 아직 남아 있다가 사이트가 새로 그리며 맨 위로 되감을 수 있음)
    const stop = () => {
      userStop = true;
    };
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) document.addEventListener(ev, stop, { capture: true, passive: true, once: true });
    const show = () => {
      if (hidden) hidden.style.visibility = '';
      hidden = null;
    };
    const step = () => {
      if (token !== restoreToken) return show(); // 다른 이동이 시작됨
      const el = scroller();
      const sc = el || pageTop();
      if (!sc) {
        if (Date.now() - started < MAX_WAIT) return setTimeout(step, 60);
        return show();
      }
      if (el && el !== hidden) {
        show(); // 사이트가 목록 요소를 새로 만들었으면 새 요소를 숨긴다
        hidden = el;
        el.style.visibility = 'hidden';
      }
      if (userStop) return show();
      const max = sc.scrollHeight - sc.clientHeight;
      sc.scrollTop = Math.min(want, Math.max(0, max));
      const reached = Math.abs(sc.scrollTop - want) < 2;
      if (!reached) stableSince = 0;
      else if (!stableSince) stableSince = Date.now();
      if ((reached && Date.now() - stableSince >= STABLE) || Date.now() - started >= MAX_WAIT) {
        pos.set(keyOf(), sc.scrollTop);
        return show();
      }
      setTimeout(step, 60);
    };
    step();
    setTimeout(() => token === restoreToken && show(), MAX_WAIT + 300); // 어떤 경우에도 숨긴 채로 남지 않게
  }
})();
