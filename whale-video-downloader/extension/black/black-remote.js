// 블랙전용(개인용 기능) — 크롬 원격 데스크톱 화면에서 모든 키(시스템 키 포함)를 원격 컴퓨터로 보낸다. 페이지 쪽(MAIN world). 유료판에서는 black/ 째 빠진다.
//  - 브라우저의 키보드 잠금(navigator.keyboard.lock(), 키 목록 없이 = 모든 키)을 쓴다. 화면을 한 번 누르면(사용자 조작) 잠그고,
//    이 화면이 포커스를 잃거나(다른 탭·창을 누름) 가려지면 바로 푼다 → 다른 탭을 누르면 풀림
//  - 한계(브라우저 규칙): 크롬은 키보드 잠금을 '전체 화면'일 때만 실제로 적용한다. 전체 화면(F11 또는 원격 데스크톱의 전체 화면 단추)에서는 Alt+Tab·Windows 키·Esc 등 시스템 키까지 원격으로 가고,
//    일반 창에서는 Ctrl+W·Ctrl+T·Ctrl+N 같은 브라우저 예약 키는 어떤 확장도 막을 수 없다
//  - 켜고 끄기: 팝업 블랙전용 탭의 '원격 데스크톱 키 전달' 스위치(<html data-smd-remote-keys="0|1">, 기본 켬) · '이 사이트 제외'(<html data-smd-off>)
(() => {
  'use strict';
  if (globalThis.__smdRemoteKeys || window.top !== window) return;
  Object.defineProperty(globalThis, '__smdRemoteKeys', { value: true, enumerable: false });
  const root = () => document.documentElement;
  const enabled = () => !root()?.hasAttribute('data-smd-off') && root()?.dataset.smdRemoteKeys !== '0';
  let locked = false;

  async function lock() {
    if (locked || !enabled() || !navigator.keyboard?.lock) return;
    try {
      await navigator.keyboard.lock(); // 키 목록 없이 = 모든 키
      locked = true;
    } catch {
      // 잠글 수 없는 환경(전체 화면이 아님·권한 정책 등): 조용히 넘어간다 — 키는 원격 화면이 평소처럼 받는다
    }
  }
  function unlock() {
    if (!locked) return;
    locked = false;
    try {
      navigator.keyboard?.unlock?.();
    } catch {}
  }

  // 화면을 누르면(사용자 조작) 잠금, 포커스를 잃거나 가려지면 해제(다른 탭을 누르면 풀림), 꺼져 있으면 즉시 해제
  addEventListener('pointerdown', lock, true);
  addEventListener('focus', () => document.hasFocus() && lock(), true);
  addEventListener('blur', unlock);
  document.addEventListener('visibilitychange', () => (document.hidden ? unlock() : null));
  addEventListener('pagehide', unlock);
  new MutationObserver(() => {
    if (!enabled()) unlock();
  }).observe(root() || document, { attributes: true, attributeFilter: ['data-smd-remote-keys', 'data-smd-off'] });
})();
