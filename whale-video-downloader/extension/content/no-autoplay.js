// 자동재생 끄기 · 팟플레이어로 재생 (페이지 쪽 MAIN world, 모든 사이트 · 사이트마다 켜고 끄기)
//  - 사이트가 스스로 영상을 트는 것(스크롤 자동재생)을 막는다. 사용자가 직접 누르거나 키를 눌러 튼 영상만 재생된다.
//  - 한 번 직접 튼 영상은 그 뒤 사이트의 재생(버퍼링 후 이어 재생 등)도 허용한다.
//  - 막을 때는 브라우저의 자동재생 차단과 같은 오류(NotAllowedError)를 돌려줘 사이트가 재생 버튼을 보여 주게 한다.
//  - 켜고 끄기: 확장 설정이 <html data-smd-noautoplay="0|1"> 로 알려 준다(기본 켬)
//  - 팟플레이어로 재생을 켜면(data-smd-potplayer="1") 직접 누른 재생도 브라우저 대신 팟플레이어로 넘긴다
(() => {
  if (window.__smdNoAutoplay) return;
  window.__smdNoAutoplay = true;
  const MP = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (!MP || typeof MP.play !== 'function') return;
  const origPlay = MP.play;
  // 확장 설정을 읽기 전에는 X·블루스카이만 켠 것으로 본다(사이트별 기본값). 다른 사이트는 설정이 켜졌을 때만.
  const early = /(^|\.)(x|twitter)\.com$|(^|\.)bsky\.app$/.test(location.hostname);
  const enabled = () => {
    const v = document.documentElement?.dataset.smdNoautoplay;
    return v === '1' || (v === undefined && early);
  };
  let lastGesture = 0;
  const onGesture = (ev) => {
    if (!ev.isTrusted) return;
    // 확장 버튼(다운로드·팔로우 등)을 누른 것은 재생 의도로 보지 않는다
    if (ev.composedPath().some((n) => n && n.tagName && /^SMD-/.test(n.tagName))) return;
    lastGesture = Date.now();
  };
  for (const t of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend']) addEventListener(t, onGesture, true);
  const allowed = new WeakSet();
  // 팟플레이어로 재생(설정 <html data-smd-potplayer="1">): 사용자가 직접 튼 영상은 브라우저 대신 팟플레이어로 넘긴다
  const potOn = () => document.documentElement?.dataset.smdPotplayer === '1';
  let potSeq = 0;
  let lastPot = 0;
  MP.play = function () {
    if (potOn() && this instanceof HTMLVideoElement && Date.now() - lastGesture < 1500) {
      if (Date.now() - lastPot > 1500) {
        lastPot = Date.now();
        if (!this.dataset.smdPot) this.dataset.smdPot = `p${++potSeq}`;
        document.dispatchEvent(new CustomEvent('__smd_potplay', { detail: this.dataset.smdPot }));
      }
      return Promise.reject(new DOMException('팟플레이어로 재생합니다(웨일 영상 다운로더 설정)', 'NotAllowedError'));
    }
    if (!enabled() || allowed.has(this) || Date.now() - lastGesture < 1500 || !(this instanceof HTMLVideoElement)) {
      if (this instanceof HTMLVideoElement && Date.now() - lastGesture < 1500) allowed.add(this);
      return origPlay.apply(this, arguments);
    }
    return Promise.reject(new DOMException('자동재생을 막았습니다(웨일 영상 다운로더 설정)', 'NotAllowedError'));
  };
  try {
    Object.defineProperty(MP.play, 'toString', { value: () => origPlay.toString() });
  } catch {}
  // autoplay 속성으로 시작하는 영상도 멈춘다
  document.addEventListener('play', (ev) => {
    const v = ev.target;
    if (v instanceof HTMLVideoElement && potOn()) return v.pause();
    if (enabled() && v instanceof HTMLVideoElement && !allowed.has(v) && Date.now() - lastGesture >= 1500) v.pause();
  }, true);
  // 설정이 나중에 켜지면(페이지 열린 뒤) 사이트가 이미 저절로 튼 영상도 멈춘다
  try {
    new MutationObserver(() => {
      if (!enabled() && !potOn()) return;
      for (const v of document.querySelectorAll('video')) if (!v.paused && !allowed.has(v) && Date.now() - lastGesture >= 1500) v.pause();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-smd-noautoplay', 'data-smd-potplayer'] });
  } catch {}
})();
