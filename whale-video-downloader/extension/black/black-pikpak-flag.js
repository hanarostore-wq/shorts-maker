// 블랙전용(개인용 기능) — 픽팍 팟플레이어 재생(black-pikpak.js, 페이지 쪽)에 켜고 끄기를 알려 준다. 유료판에서는 black/ 째 빠진다.
//  페이지 쪽 스크립트는 확장 저장소를 못 읽어서, 설정(blackPikpak, 기본 켬)을 <html data-smd-pikpak="0|1"> 로 넘긴다.
(() => {
  'use strict';
  const set = (s) => {
    try {
      document.documentElement.dataset.smdPikpak = s?.blackPikpak === false ? '0' : '1';
    } catch {}
  };
  chrome.storage.local.get('settings').then((r) => set(r.settings), () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) set(c.settings.newValue);
  });
})();
