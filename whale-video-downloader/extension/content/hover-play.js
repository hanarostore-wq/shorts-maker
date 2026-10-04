// 마우스를 올리면 재생 (모든 사이트, 켜고 끄기)
//  - 영상에 마우스를 올리면 소리와 함께 재생한다.
//  - 마우스가 영상 밖으로 나가도 계속 재생하고, 다른 영상에 마우스를 올리면 그때 이전 영상을 멈춘다.
//  - 브라우저는 페이지를 한 번도 누르기 전에는 소리 있는 재생을 막는다 → 그때는 음소거로 재생하고 첫 클릭·키 입력 때 소리를 켠다.
//  - X 는 스스로 자동 재생하는 영상이 많아, 지금 고른 영상이 아닌 자동 재생은 멈춘다(직접 눌러 재생한 영상은 그대로).
(() => {
  if (window.__smdHoverPlay) return;
  window.__smdHoverPlay = true;

  let on = true;
  const read = (st) => (st ? st.hoverPlay !== false && st.xHoverPlay !== false : true);
  try {
    chrome.storage.local.get('settings').then((r) => (on = read(r.settings)), () => {});
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.settings) on = read(c.settings.newValue);
    });
  } catch {}

  const isX = /(^|\.)(x|twitter)\.com$/.test(location.hostname);
  const MIN = 60;
  let current = null; // 지금 고른 영상(마우스를 마지막으로 올린 영상)
  let pendingSound = null;
  const ourPlay = new WeakSet();
  const userPlayed = new WeakSet();
  let lastPointer = 0;

  const UNMUTE_SEL = '[aria-label*="Unmute" i], [aria-label*="음소거 해제"], [data-testid="unmuteButton"], .ytp-mute-button[data-title-no-tooltip*="Unmute" i]';
  function soundOn(v) {
    if (!v.muted) return;
    // 사이트 플레이어의 음소거 해제 버튼이 있으면 눌러서 사이트 화면 상태도 맞춘다
    let p = v.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) {
      const b = p.querySelector(UNMUTE_SEL);
      if (b) {
        b.click();
        break;
      }
    }
    if (v.muted) v.muted = false;
    if (v.volume === 0) v.volume = 1;
  }

  async function play(v) {
    ourPlay.add(v);
    const canSound = navigator.userActivation ? navigator.userActivation.hasBeenActive : false;
    if (canSound) soundOn(v);
    else v.muted = true; // 막힐 걸 알면서 소리로 틀지 않는다(재생됐다 멈췄다 반복 방지)
    try {
      await v.play();
    } catch {
      v.muted = true;
      ourPlay.add(v);
      await v.play().catch(() => {});
    }
    if (v.muted) pendingSound = v;
  }

  function videoAt(x, y) {
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN || r.height < MIN) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  function choose(v) {
    if (v === current) return;
    const prev = current;
    current = v;
    // 다른 영상에 마우스를 올렸을 때 이전 영상과, 그 밖에 재생 중인 영상을 멈춘다
    for (const o of document.querySelectorAll('video')) {
      if (o === v || o.paused) continue;
      if (o === prev || o.getBoundingClientRect().width >= MIN) o.pause();
    }
    if (v.paused && !v.ended) {
      // 아직 불러오지 않은 영상(자동 재생 꺼진 사이트)은 사이트 재생 버튼을 누른다
      if (!v.currentSrc && v.readyState === 0) {
        const btn = (v.closest('[data-testid="videoPlayer"]') || v.parentElement)?.querySelector('[data-testid="playButton"], [aria-label="재생"], [aria-label="Play"]');
        if (btn) {
          ourPlay.add(v);
          btn.click();
        }
      } else play(v);
    } else if (!v.paused && v.muted && (navigator.userActivation?.hasBeenActive)) soundOn(v);
  }

  document.addEventListener(
    'pointermove',
    (ev) => {
      if (!on || ev.pointerType === 'touch') return;
      const v = videoAt(ev.clientX, ev.clientY);
      if (v) choose(v);
    },
    { capture: true, passive: true },
  );
  const onGesture = () => {
    lastPointer = Date.now();
    const v = pendingSound;
    pendingSound = null;
    if (on && v && v.isConnected && !v.paused && v === current) soundOn(v);
  };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  document.addEventListener(
    'play',
    (ev) => {
      const v = ev.target;
      if (!(v instanceof HTMLVideoElement)) return;
      if (ourPlay.has(v)) ourPlay.delete(v);
      else if (Date.now() - lastPointer < 800) {
        // 직접 눌러 재생 → 그 영상을 지금 영상으로
        userPlayed.add(v);
        current = v;
      }
    },
    true,
  );

  // X: 지금 고른 영상이 아닌 X 자동 재생은 멈춘다
  if (isX) {
    setInterval(() => {
      if (!on || document.hidden) return;
      for (const v of document.querySelectorAll('video')) {
        if (!v.paused && v !== current && !userPlayed.has(v) && v.getBoundingClientRect().width >= MIN) v.pause();
      }
    }, 600);
  }
})();
