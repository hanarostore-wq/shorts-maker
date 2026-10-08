// 화면 밖 영상 정지: 재생 중인 영상이 스크롤로 화면에서 완전히 벗어나면 멈춘다(모든 사이트, 켜고 끄기 가능).
//  - 화면에 보였던 영상만 대상(처음부터 숨어 있는 음악·광고용 영상은 건드리지 않음)
//  - 화면 속 화면(PIP)·전체 화면 영상은 멈추지 않는다. 다시 화면에 들어와도 저절로 재생하지 않는다.
(() => {
  if (window.__smdOffscreenPause) return;
  window.__smdOffscreenPause = true;

  let on = true;
  const sid = () => globalThis.__SMD_SITES?.pick(location.hostname)?.id || 'generic';
  const effOf = (s, site) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) }); // 사이트별로 바꾼 값이 우선
  const read = (s) => (on = effOf(s, sid()).pauseOffscreen !== false);
  try {
    chrome.storage.local.get('settings').then((r) => read(r.settings), () => {});
    chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.settings && read(c.settings.newValue));
  } catch {}

  const seen = new WeakSet(); // 화면에 한 번이라도 보인 영상
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) {
        seen.add(v);
        continue;
      }
      if (!on || !seen.has(v) || v.paused || v.ended || !v.isConnected) continue;
      if (document.pictureInPictureElement === v || document.fullscreenElement?.contains(v)) continue;
      try {
        v.pause();
      } catch {}
    }
  });
  const watch = (v) => {
    if (v.__smdWatched) return;
    v.__smdWatched = true;
    io.observe(v);
  };
  const scan = (root) => root.querySelectorAll?.('video').forEach(watch);
  // 새로 생기는 영상(무한 스크롤 피드)도 지켜본다. 재생 시작 때도 한 번 더 확인.
  document.addEventListener('play', (ev) => ev.target instanceof HTMLVideoElement && watch(ev.target), true);
  // 새 영상 찾기: 화면이 바뀔 때마다 바뀐 부분을 하나하나 뒤지지 않고, 0.5초에 한 번 영상 목록만 확인(유튜브 재생목록처럼 수백 개가 한꺼번에 바뀔 때 느려지지 않게)
  const vids = document.getElementsByTagName('video');
  let pend = 0;
  new MutationObserver(() => {
    if (pend) return;
    pend = setTimeout(() => {
      pend = 0;
      for (const v of vids) watch(v);
    }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
