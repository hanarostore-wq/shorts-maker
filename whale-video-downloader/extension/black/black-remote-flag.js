// 블랙전용(개인용 기능) — 크롬 원격 데스크톱 화면의 키 전달(black-remote.js, 페이지 쪽)에 켜고 끄기를 알려 준다. 유료판에서는 black/ 째 빠진다.
//  페이지 쪽 스크립트는 확장 저장소를 못 읽어서, 설정(blackRemoteKeys, 기본 켬)을 <html data-smd-remote-keys="0|1"> 로 넘긴다.
(() => {
  'use strict';
  const set = (s) => {
    try {
      document.documentElement.dataset.smdRemoteKeys = s?.blackRemoteKeys === false ? '0' : '1';
    } catch {}
  };
  chrome.storage.local.get('settings').then((r) => set(r.settings), () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) set(c.settings.newValue);
  });
})();
