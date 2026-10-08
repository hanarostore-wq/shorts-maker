// 영상 화면 크기 조절(모든 사이트): 영상 플레이어(영상 + 그 위에 겹친 사이트 재생 단추 묶음)를 설정한 % 로 줄인다.
//  - 팝업 '이 사이트'에서 사이트마다 켜고 끄기(videoSmall) + 크기(videoScale %), '저장 설정'에서 모든 사이트 기본값
//  - 전체 화면은 원래 크기. 유튜브 보기 화면은 플레이어 칸(#player), 극장 모드는 그대로
(() => {
  'use strict';
  if (globalThis.__SMD_VSIZE || window.top !== window || !globalThis.__SMD_SITES) return;
  globalThis.__SMD_VSIZE = true;
  const site = globalThis.__SMD_SITE_ID || globalThis.__SMD_SITES.pick(location.hostname).id;
  const effOf = (s, id) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[id] || {}) });
  const MARK = 'data-smd-zoom';
  let on = false;
  let pct = 70;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  const style = document.createElement('style');
  style.id = 'smd-video-size';
  style.textContent = `[${MARK}]{zoom:var(--smd-video-zoom,1)!important}[${MARK}]:fullscreen,:fullscreen [${MARK}],:fullscreen[${MARK}]{zoom:1!important}`;
  (document.head || document.documentElement).appendChild(style);

  function apply(s) {
    const e = effOf(s, site);
    on = e.videoSmall === true;
    pct = Math.min(95, Math.max(30, Number(e.videoScale) || 70));
    document.documentElement.style.setProperty('--smd-video-zoom', String(pct / 100));
    if (!on) for (const el of document.querySelectorAll(`[${MARK}]`)) el.removeAttribute(MARK);
    else scan();
    dispatchEvent(new Event('resize')); // 사이트가 플레이어 크기를 다시 계산하게
  }
  chrome.storage.local.get('settings').then((r) => apply(r.settings), () => {});
  chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.settings && apply(c.settings.newValue));

  // 영상과 크기가 거의 같은 가장 바깥 묶음 = 사이트 플레이어(재생 단추·자막 등이 함께 줄어든다)
  function playerBox(v) {
    if (site === 'youtube') {
      if (v.closest('#full-bleed-container')) return null; // 극장 모드는 그대로
      const p = v.closest('#primary-inner > #player');
      if (p) return p;
    }
    const vr = v.getBoundingClientRect();
    let box = v;
    for (let p = v.parentElement, i = 0; p && p !== document.body && i < 8; p = p.parentElement, i++) {
      const r = p.getBoundingClientRect();
      if (r.width > vr.width * 1.08 + 4 || r.height > vr.height * 1.2 + 4) break;
      box = p;
    }
    return box;
  }
  function scan() {
    if (!on || !alive() || document.fullscreenElement) return;
    for (const v of document.querySelectorAll('video')) {
      if (v.closest(`[${MARK}]`)) continue; // 이미 줄였음(겹쳐 줄이지 않게)
      const r = v.getBoundingClientRect();
      if (r.width < 240 || r.height < 160) continue;
      const box = playerBox(v);
      if (!box || box.querySelector(`[${MARK}]`)) continue;
      box.setAttribute(MARK, '');
    }
  }
  setInterval(scan, 1000);
})();
