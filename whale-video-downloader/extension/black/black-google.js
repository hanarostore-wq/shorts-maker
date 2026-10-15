// 블랙전용(개인용 기능) — 구글 검색 결과를 누르면 무조건 새 탭으로 열기 (팝업 '블랙전용'에서 켜고 끄기, 기본 켬)
//   유료판에서는 tools/make-paid.mjs 가 이 파일과 manifest 묶음을 뺀다.
//  - 검색 결과 칸(#search·#rso·#botstuff 등) 안의 바깥 사이트 링크만. 구글 메뉴(이미지·뉴스 탭, 다음 쪽, 검색 도구)는 그대로
//  - 누르는 순간 링크에 target=_blank 를 붙여 브라우저가 새 탭으로 연다(구글의 /url?q= 주소도 그대로 동작)
(() => {
  'use strict';
  if (globalThis.__SMD_BLACK_GOOGLE || window.top !== window) return;
  globalThis.__SMD_BLACK_GOOGLE = true;
  let on = true;
  chrome.storage.local.get('settings').then((r) => (on = r.settings?.blackGoogleNewTab !== false), () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) on = c.settings.newValue?.blackGoogleNewTab !== false;
  });
  const RESULTS = '#search, #rso, #botstuff, #center_col, #rhs, [data-async-context^="query:"]';
  const isGoogle = (h) => /(^|\.)google\.[a-z.]+$/i.test(h);
  function target(a) {
    if (!a?.href || !a.closest(RESULTS)) return false;
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(u.protocol)) return false;
    // 구글 안쪽 주소는 건너뜀(다음 쪽·검색 도구·이미지 탭 등). 단 /url?q= 은 바깥 사이트로 가는 결과 링크
    if (isGoogle(u.hostname)) return u.pathname === '/url' && /^https?:/.test(u.searchParams.get('q') || u.searchParams.get('url') || '');
    return true;
  }
  const mark = (ev) => {
    if (!on || globalThis.__SMD_OFF || ev.button > 1) return; // __SMD_OFF: 이 사이트 제외
    const a = ev.target?.closest?.('a[href]');
    if (!target(a)) return;
    a.target = '_blank';
    a.rel = `${a.rel || ''} noopener`.trim();
  };
  // 마우스 누를 때와 클릭 때 모두(구글이 누를 때 주소를 바꾸는 경우 포함), 키보드 Enter 도
  addEventListener('mousedown', mark, true);
  addEventListener('click', mark, true);
  addEventListener('keydown', (ev) => ev.key === 'Enter' && mark(ev), true);
})();
