// 영상 정지 막기 (페이지 쪽 MAIN world, 모든 사이트)
//  - 지금 소리 내며 보고 있는 영상은 사이트·브라우저 코드가 멈추려 해도(다운로드·창 전환 등) 멈추지 않게 한다.
//  - 멈춰도 되는 경우: 사용자가 직접 누르거나 키를 눌러 멈춤(확장 버튼을 누른 것은 제외), 다른 영상을 소리와 함께 재생, 영상이 끝남
//  - 켜고 끄기: 확장 설정이 <html data-smd-playlock="0|1"> 로 알려 준다(기본 켬)
(() => {
  if (window.__smdPlayLock) return;
  window.__smdPlayLock = true;
  const MP = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (!MP || typeof MP.pause !== 'function') return;
  const origPause = MP.pause;
  const enabled = () => document.documentElement?.dataset.smdPlaylock !== '0';
  const OURS = /^SMD-(ANCHOR|FOLLOW|BFOLLOW|TOOLBAR|YTSTATS)$/;

  let current = null; // 잠근 영상(소리 내며 재생 중인 영상)
  let lastPress = 0;
  let lastPressOurs = false;
  const onPress = (ev) => {
    lastPress = Date.now();
    lastPressOurs = ev.composedPath().some((n) => n && n.tagName && OURS.test(n.tagName));
  };
  addEventListener('pointerdown', onPress, true);
  addEventListener('keydown', onPress, true);
  // 사용자가 방금(1.2초 안) 직접 누른 것인가(확장 버튼 제외)
  const userIntent = () => Date.now() - lastPress < 1200 && !lastPressOurs;

  document.addEventListener(
    'playing',
    (ev) => {
      const v = ev.target;
      if (!(v instanceof HTMLVideoElement) || v === current) return;
      const r = v.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) return;
      // 소리 내며 재생되거나 사용자가 직접 튼 영상만 잠근다(피드 미리보기 음소거 자동 재생은 제외)
      if (v.muted && !userIntent()) return;
      const prev = current;
      current = v;
      // 다른 영상을 틀었으면 이전 영상은 멈춰도 된다(소리 겹침 방지)
      if (prev && prev !== v && !prev.paused) origPause.call(prev);
    },
    true,
  );
  document.addEventListener('ended', (ev) => ev.target === current && (current = null), true);

  MP.pause = function () {
    if (enabled() && this === current && this.isConnected && !this.ended && !this.paused && !userIntent()) {
      // 사이트·브라우저가 멈추려 함 → 무시하고 계속 재생
      return undefined;
    }
    if (this === current) current = null;
    return origPause.apply(this, arguments);
  };
  try {
    Object.defineProperty(MP.pause, 'toString', { value: () => origPause.toString() });
  } catch {}
})();
