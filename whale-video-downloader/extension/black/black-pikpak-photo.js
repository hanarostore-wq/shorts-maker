// 블랙전용(개인용 기능) — 픽팍(내 드라이브·공유 링크) 사진 뷰어에서 사진을 누르면 확대하지 않고 뷰어를 닫는다. 페이지 쪽(MAIN world). 유료판에서는 black/ 째 빠진다.
//  - 사이트 코드에서 확인한 구조: 사진 = .image-viewer-wrapper 안의 img.img, 아래 조절 막대 = #manager-preview-bar. 사진을 누르면 확대가 되는 쪽(사이트 처리)을 먼저 막고 닫는다
//  - 닫는 방법(앞에서부터 시도, 열려 있는지 확인하며): ① 뷰어 안의 닫기 단추 ② Esc 키 ③ 사이트가 뷰어를 열 때 쌓은 'media-preview' 이동 기록이면 뒤로가기. 그래도 안 닫히면 단계·원인·조치 안내
//  - 끌어서 옮기는 동작(5px 넘게 움직임)·조절 막대·단추·링크·수정키(Shift·Ctrl·Alt)를 누른 클릭은 건드리지 않는다
//  - 켜고 끄기: 팝업 블랙전용 탭의 '사진 누르면 뷰어 닫기' 스위치(<html data-smd-pikpak-photo="0|1">, 기본 켬) · 픽팍 전체 스위치 · '이 사이트 제외'(<html data-smd-off>)
(() => {
  'use strict';
  if (globalThis.__smdPikpakPhoto) return;
  Object.defineProperty(globalThis, '__smdPikpakPhoto', { value: true, enumerable: false });
  const root = () => document.documentElement;
  const enabled = () => !root()?.hasAttribute('data-smd-off') && root()?.dataset.smdPikpak !== '0' && root()?.dataset.smdPikpakPhoto !== '0';
  const VIEWER = '.image-viewer-wrapper';
  const SKIP = '#manager-preview-bar, button, a, [role="button"], [class*="icon-"], input, [class*="control"]';

  let down = null;
  document.addEventListener('mousedown', (e) => (down = { x: e.clientX, y: e.clientY }), true);

  let toastBox = null;
  function toast(text) {
    toastBox?.remove();
    const box = document.createElement('div');
    box.style.cssText = 'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:440px;padding:10px 14px;border-radius:12px;background:rgba(24,20,40,.96);border:1px solid #9b5cff;color:#fff;font:600 12.5px/1.5 "Malgun Gothic",system-ui,sans-serif;white-space:pre-line';
    box.textContent = text;
    root().appendChild(box);
    toastBox = box;
    setTimeout(() => box.remove(), 7000);
  }
  const open = (v) => v.isConnected && v.getBoundingClientRect().width > 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function closeViewer(v) {
    // ① 닫기 단추
    const scope = v.closest('.file-manager-container') || v.parentElement || document;
    const btn = [...scope.querySelectorAll('[class*="close" i], [aria-label*="lose" i], [aria-label*="닫기"], [title*="lose" i], [title*="닫기"]')].find((b) => b.getBoundingClientRect().width > 0 && !b.closest('[data-smd-x]'));
    if (btn) {
      (btn.closest('button, [role="button"]') || btn).click();
      await wait(350);
      if (!open(v)) return true;
    }
    // ② Esc
    const k = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', k));
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', k));
    await wait(350);
    if (!open(v)) return true;
    // ③ 사이트가 뷰어를 열며 쌓은 이동 기록이면 뒤로가기
    if (history.state === 'media-preview') {
      history.back();
      await wait(450);
      if (!open(v)) return true;
    }
    return false;
  }

  let busy = false;
  document.addEventListener(
    'click',
    async (e) => {
      if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !enabled()) return;
      const t = e.target;
      const v = t?.closest?.(VIEWER);
      if (!v || t.closest(SKIP)) return;
      if (!(t.matches?.('img, canvas') || t.closest('.layout'))) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // 끌어서 옮긴 것
      e.preventDefault();
      e.stopImmediatePropagation(); // 사이트의 '누르면 확대'를 막는다
      if (busy) return;
      busy = true;
      try {
        if (!(await closeViewer(v))) toast('사진 뷰어를 닫지 못했습니다\n단계: 사진 뷰어 닫기\n원인: 닫기 단추·Esc·뒤로가기 어느 쪽으로도 뷰어가 닫히지 않았습니다(사이트가 바뀌었을 수 있음)\n조치: 뷰어의 닫기 단추를 직접 누르세요.');
      } finally {
        busy = false;
      }
    },
    true,
  );
})();
