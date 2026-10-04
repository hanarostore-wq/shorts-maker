// 영상 정지 막기 (페이지 쪽 MAIN world, 모든 사이트)
//  - 지금 보고 있는 영상은 사이트·브라우저가 멈추려 해도(다운로드·창 전환·다른 곳 클릭 등) 멈추지 않게 한다.
//  - 멈춰도 되는 경우: 사용자가 그 영상 위를 직접 누르거나 재생 키(스페이스·K·미디어 키)를 눌러 멈춤,
//    다른 영상을 소리와 함께 재생, 영상이 끝남, 사이트가 영상을 화면에서 치움(숨김·삭제)
//  - 사이트가 pause() 를 거치지 않고 멈춘 경우(브라우저 절전·다른 창의 pause 등)도 바로 다시 재생한다.
//  - 켜고 끄기: 확장 설정이 <html data-smd-playlock="0|1"> 로 알려 준다(기본 켬)
(() => {
  if (window.__smdPlayLock) return;
  window.__smdPlayLock = true;
  const MP = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (!MP || typeof MP.pause !== 'function') return;
  const origPause = MP.pause;
  const origPlay = MP.play;
  const enabled = () => document.documentElement?.dataset.smdPlaylock !== '0';
  const OURS = /^SMD-/;
  const PLAY_KEYS = new Set([' ', 'Spacebar', 'k', 'K', 'ㅏ', 'MediaPlayPause', 'MediaPause', 'MediaStop', 'Enter']);

  let current = null; // 잠근 영상(지금 보고 있는 영상)
  let press = { at: 0, x: -1, y: -1, key: '', ours: false };
  addEventListener('pointerdown', (ev) => {
    press = { at: Date.now(), x: ev.clientX, y: ev.clientY, key: '', ours: ev.composedPath().some((n) => n && n.tagName && OURS.test(n.tagName)) };
  }, true);
  addEventListener('keydown', (ev) => {
    const t = ev.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    press = { at: Date.now(), x: -1, y: -1, key: typing ? '' : ev.key, ours: false };
  }, true);

  const rectOf = (v) => v.getBoundingClientRect();
  const visible = (v) => {
    if (!v.isConnected) return false;
    const r = rectOf(v);
    return r.width >= 2 && r.height >= 2 && getComputedStyle(v).visibility !== 'hidden';
  };
  // 사용자가 방금(1.2초 안) 이 영상을 직접 멈추려 했나: 영상 위를 눌렀거나 재생 키를 눌렀음(확장 버튼 제외)
  const userWants = (v) => {
    if (Date.now() - press.at > 1200 || press.ours) return false;
    if (press.key) return PLAY_KEYS.has(press.key);
    const r = rectOf(v);
    return press.x >= r.left && press.x <= r.right && press.y >= r.top && press.y <= r.bottom;
  };
  const anyRecentPress = () => Date.now() - press.at < 1200 && !press.ours;

  let letThrough = null; // 허락해서 멈추는 영상(pause 이벤트에서 구분)
  const realPause = (v) => {
    letThrough = v;
    try {
      return origPause.call(v);
    } finally {
      setTimeout(() => letThrough === v && (letThrough = null), 0);
    }
  };

  const lock = (v) => {
    const prev = current;
    current = v;
    // 다른 영상을 소리와 함께 틀었으면 이전 영상은 멈춘다(소리 겹침 방지). 음소거 영상끼리는 잠금만 넘긴다.
    if (prev && prev !== v && !prev.paused && !prev.muted && !v.muted) realPause(prev);
  };
  const bigEnough = (v) => {
    const r = rectOf(v);
    return r.width >= 120 && r.height >= 80;
  };

  document.addEventListener('playing', (ev) => {
    const v = ev.target;
    if (!(v instanceof HTMLVideoElement) || v === current || !bigEnough(v)) return;
    // 소리 내며 보고 있는 영상이 있으면 음소거 자동 재생(피드 미리보기)에 잠금을 뺏기지 않는다
    if (current && !current.paused && !current.muted && v.muted && !anyRecentPress()) return;
    lock(v);
  }, true);
  // 이미 재생 중인 영상의 소리를 켜면(X·블루스카이 피드) 그 영상을 잠근다
  document.addEventListener('volumechange', (ev) => {
    const v = ev.target;
    if (v instanceof HTMLVideoElement && v !== current && !v.muted && !v.paused && bigEnough(v)) lock(v);
  }, true);
  document.addEventListener('ended', (ev) => ev.target === current && (current = null), true);
  // pause() 를 거치지 않은 정지(브라우저 절전, 다른 창의 pause 함수 등)는 바로 다시 재생
  document.addEventListener('pause', (ev) => {
    const v = ev.target;
    if (v !== current || letThrough === v || !enabled()) return;
    if (v.ended || !visible(v) || userWants(v)) {
      current = null;
      return;
    }
    setTimeout(() => {
      if (current === v && v.paused && !v.ended && visible(v)) origPlay.call(v)?.catch?.(() => {});
    }, 0);
  }, true);

  MP.pause = function () {
    if (enabled() && this === current && !this.paused && !this.ended && visible(this) && !userWants(this)) {
      // 사이트·브라우저가 멈추려 함 → 무시하고 계속 재생
      return undefined;
    }
    if (this === current) current = null;
    return realPause(this);
  };
  try {
    Object.defineProperty(MP.pause, 'toString', { value: () => origPause.toString() });
  } catch {}
})();
