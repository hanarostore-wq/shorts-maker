// 영상 공간을 눌러도 재생이 멈추지 않게 (모든 사이트, 켜고 끄기)
//  - 재생 중인 영상 위(영상 자체 또는 그 위를 덮은 투명 막)를 누르면 사이트의 '누르면 정지' 동작을 막는다.
//  - 버튼·링크·재생바 같은 조작 요소와 다운로더 버튼은 그대로 동작한다. 멈춘 영상은 눌러서 재생할 수 있다.
//  - 사이트가 누르는 순간 바로 멈추는 방식이면(클릭 전에 처리) 곧바로 다시 재생한다.
(() => {
  if (window.__smdClickGuard) return;
  window.__smdClickGuard = true;

  let on = true;
  try {
    chrome.storage.local.get('settings').then((r) => (on = r.settings?.noClickPause !== false), () => {});
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.settings) on = c.settings.newValue?.noClickPause !== false;
    });
  } catch {}

  // 조작 요소: 버튼·링크·재생바, 그리고 사이트의 재생/일시정지 단추(X 의 재생 단추는 role 이 없는 div 다)
  const CONTROL = 'button, a[href], input, select, textarea, label, [role="button"], [role="slider"], [role="link"], [role="menuitem"], [role="checkbox"], [contenteditable="true"], smd-anchor, smd-follow, smd-bfollow, smd-toolbar, smd-ytstats, [data-testid="playButton"], [data-testid*="play" i], [aria-label*="재생"], [aria-label*="일시정지"], [aria-label*="Play" i], [aria-label*="Pause" i], [class*="play-button" i], [class*="playButton" i], [class*="play-btn" i]';
  // 사이트가 '멈춤' 상태로 보고 재생 단추를 띄워 둔 플레이어(영상 요소는 미리보기로 돌고 있어도)는 건드리지 않는다
  const sitePaused = (v) => {
    const pl = v.closest('[data-testid="videoPlayer"]') || v.parentElement?.parentElement || v.parentElement;
    const b = pl?.querySelector('[data-testid="playButton"], [aria-label="재생"], [aria-label="Play"], [aria-label="Play video" i]');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).opacity !== '0';
  };
  // 누른 위치에 있는 재생 중 영상
  function videoAt(x, y) {
    for (const v of document.querySelectorAll('video')) {
      if (v.paused || v.ended) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 80 || r.height < 60) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }
  const isControl = (ev) => ev.composedPath().some((n) => n instanceof Element && n !== document.documentElement && n.matches?.(CONTROL));
  // 영상 기본 컨트롤 막대(아래쪽 약 48px)는 그대로 둔다
  const onNativeBar = (v, y) => v.controls && y > v.getBoundingClientRect().bottom - 48;

  let guard = null; // { v, until }
  const onPress = (ev) => {
    // 누를 때마다 새로 판단한다(이전 영상을 누른 기록이 다른 영상 클릭을 막지 않게)
    if (ev.type === 'pointerdown' || !guard || guard.t !== ev.timeStamp) guard = null;
    if (!on || ev.button !== 0) return;
    const v = videoAt(ev.clientX, ev.clientY);
    if (!v || isControl(ev) || onNativeBar(v, ev.clientY) || sitePaused(v)) return;
    guard = { v, until: Date.now() + 700, t: ev.timeStamp };
  };
  addEventListener('pointerdown', onPress, true);
  addEventListener('mousedown', onPress, true);
  addEventListener(
    'click',
    (ev) => {
      if (!on || !guard || Date.now() > guard.until) return;
      if (isControl(ev)) return;
      // 누른 영상 위에서 떼었을 때만(재생 중일 때만) 막는다
      const r = guard.v.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      // 사이트의 '누르면 정지' 처리를 막는다
      ev.stopImmediatePropagation();
      ev.preventDefault();
    },
    true,
  );
  // 안전장치: 그래도 멈췄으면 다시 재생
  document.addEventListener(
    'pause',
    (ev) => {
      const v = ev.target;
      if (!on || !guard || guard.v !== v || Date.now() > guard.until || v.ended) return;
      v.play().catch(() => {});
    },
    true,
  );
})();
