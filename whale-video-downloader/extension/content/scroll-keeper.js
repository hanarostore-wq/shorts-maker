// 뒤로·앞으로 가기 때 보던 위치 유지 (모든 사이트, 맨 위 창에서만)
//  - 사용자가 직접 스크롤한 위치를 주소별로 기억한다(사이트가 스스로 맨 위로 올린 것은 기억하지 않음).
//  - 뒤로·앞으로 가기(popstate, 또는 페이지 다시 불러오기)로 돌아오면 그 위치로 되돌린다.
//    피드가 아직 다 안 불러와졌으면 아래로 내려 더 불러오게 하면서 최대 8초 동안 맞춘다.
//    그 사이 사용자가 스크롤·클릭하면 즉시 멈춘다.
(() => {
  if (window.top !== window || window.__smdScrollKeeper) return;
  window.__smdScrollKeeper = true;

  let on = true;
  try {
    chrome.storage.local.get('settings').then((r) => (on = r.settings?.keepScroll !== false), () => {});
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.settings) on = c.settings.newValue?.keepScroll !== false;
    });
  } catch {}

  const KEY = '__smd_scroll_v1';
  const load = () => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  };
  const store = (m) => {
    try {
      const keys = Object.keys(m);
      if (keys.length > 80) for (const k of keys.sort((a, b) => m[a].t - m[b].t).slice(0, keys.length - 80)) delete m[k];
      sessionStorage.setItem(KEY, JSON.stringify(m));
    } catch {}
  };
  const urlKey = () => location.href.replace(/#.*$/, '');

  // 화면 맨 위에 걸친 게시물 링크(위치 기준점) — 피드가 다시 그려져 높이가 바뀌어도 같은 게시물로 돌아가게
  const ANCHOR_SEL = 'a[href*="/status/"], a[href*="/post/"], a[href*="/watch"], a[href*="/shorts/"], a[href*="/p/"], a[href*="/reel/"], a[href*="/pin/"], a[href*="/video/"]';
  function anchor() {
    const y = Math.min(innerHeight * 0.25, 160);
    for (const x of [innerWidth / 2, innerWidth * 0.4, innerWidth * 0.6]) {
      let el = document.elementFromPoint(x, y);
      const box = el?.closest?.('article, [data-testid^="feedItem"], [data-testid="cellInnerDiv"], ytd-rich-item-renderer, ytd-video-renderer, li, [role="listitem"]');
      const a = box?.querySelector(ANCHOR_SEL);
      if (a) return { href: a.getAttribute('href'), top: Math.round(box.getBoundingClientRect().top) };
    }
    return null;
  }

  // ── 기억하기: 사용자 조작 직후의 스크롤만 ──
  // 스크롤을 일으키는 조작: 휠·터치 이동·키보드, 그리고 '누른 채로'(스크롤바 끌기). 단순 클릭 뒤 사이트가 맨 위로 올리는 것은 제외.
  let lastInput = 0;
  let pointerHeld = false;
  let restoring = null;
  const markInput = () => {
    lastInput = Date.now();
    if (restoring) restoring.stop('사용자 조작');
  };
  for (const t of ['wheel', 'touchmove', 'keydown']) addEventListener(t, markInput, { capture: true, passive: true });
  addEventListener('pointerdown', () => {
    pointerHeld = true;
    if (restoring) restoring.stop('사용자 조작');
  }, { capture: true, passive: true });
  addEventListener('pointerup', () => (pointerHeld = false), { capture: true, passive: true });
  addEventListener('pointercancel', () => (pointerHeld = false), { capture: true, passive: true });
  let curKey = urlKey();
  let saveTimer = 0;
  function save() {
    saveTimer = 0;
    if (!on || restoring) return;
    const m = load();
    m[curKey] = { y: Math.round(scrollY), a: anchor(), t: Date.now() };
    store(m);
  }
  addEventListener(
    'scroll',
    () => {
      if ((!pointerHeld && Date.now() - lastInput > 1500) || urlKey() !== curKey) return;
      if (!saveTimer) saveTimer = setTimeout(save, 200);
    },
    { capture: true, passive: true },
  );

  // ── 되돌리기 ──
  function restore(reason) {
    if (!on) return;
    const rec = load()[urlKey()];
    if (!rec || rec.y < 50) return;
    restoring?.stop('새 이동');
    const t0 = Date.now();
    let stable = 0;
    const st = {
      timer: 0,
      stop() {
        clearInterval(st.timer);
        if (restoring === st) restoring = null;
      },
    };
    restoring = st;
    const step = () => {
      if (Date.now() - t0 > 8000) return st.stop('시간 초과');
      let target = rec.y;
      if (rec.a?.href) {
        const a = document.querySelector(`a[href="${CSS.escape(rec.a.href)}"]`);
        const box = a?.closest('article, [data-testid^="feedItem"], [data-testid="cellInnerDiv"], ytd-rich-item-renderer, ytd-video-renderer, li, [role="listitem"]') || a;
        if (box) target = Math.round(scrollY + box.getBoundingClientRect().top - rec.a.top);
      }
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max < target - 5) {
        // 아직 그만큼 내용이 없음 → 끝까지 내려 더 불러오게
        scrollTo(0, max);
        stable = 0;
        return;
      }
      if (Math.abs(scrollY - target) > 3) {
        scrollTo(0, target);
        stable = 0;
      } else if (++stable >= 6) st.stop('완료');
    };
    st.timer = setInterval(step, 120);
    step();
    st.reason = reason;
  }

  addEventListener('popstate', () => {
    curKey = urlKey();
    setTimeout(() => restore('뒤로·앞으로 가기'), 0);
  });
  // 주소 바뀜 감지(사이트 내부 이동)
  setInterval(() => {
    const k = urlKey();
    if (k !== curKey) curKey = k;
  }, 300);
  // 페이지를 새로 불러온 뒤로·앞으로 가기
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (nav?.type === 'back_forward') {
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => restore('다시 불러온 뒤로가기'), { once: true });
    else restore('다시 불러온 뒤로가기');
  }
  addEventListener('pageshow', (e) => e.persisted && restore('저장된 페이지 복원'));
})();
