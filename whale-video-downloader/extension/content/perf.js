// 페이지를 느리게 하지 않기 위한 공용 도구 + 성능 진단(모든 사이트, 맨 위 창)
//  1) 화면에 보이는 사진·영상 목록: 브라우저의 IntersectionObserver 가 알려 준 것만 모아 둔다
//     → 사진 수백 장(유튜브 재생목록·홈)의 위치를 매번 직접 재지 않는다
//  2) 사이트가 화면을 바꾸는 중(유튜브 영상 이동: yt-navigate-start ~ finish+0.7초)에는 확장 작업을 쉰다
//  3) 성능 진단: 확장 기능별로 쓴 시간과 페이지의 긴 멈춤(50ms 넘는 작업)을 최근 60초 기준으로 모아
//     팝업 '이 사이트' → '성능 진단'에 보여 준다
(() => {
  'use strict';
  if (globalThis.__SMD_PERF) return;

  // ── 1) 화면에 보이는 사진·영상 ──
  const visible = new Set();
  const watched = new WeakSet();
  let io = null;
  try {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
    });
  } catch {}
  const imgs = document.images; // 살아 있는 목록(새 사진도 자동 포함)
  const vids = document.getElementsByTagName('video');
  function observeNew() {
    if (!io) return;
    for (const el of imgs) if (!watched.has(el)) (watched.add(el), io.observe(el));
    for (const el of vids) if (!watched.has(el)) (watched.add(el), io.observe(el));
    for (const el of visible) if (!el.isConnected) visible.delete(el);
  }
  observeNew();
  setInterval(observeNew, 500);

  // ── 2) 사이트 화면 이동 중 ──
  let navUntil = 0;
  let navOn = false;
  addEventListener('yt-navigate-start', () => {
    navOn = true;
    navUntil = performance.now() + 5000; // finish 가 안 와도 5초 뒤에는 다시 일함
  });
  addEventListener('yt-navigate-finish', () => {
    navOn = false;
    navUntil = performance.now() + 700;
  });
  const navigating = () => performance.now() < navUntil; // navOn 동안은 navUntil 이 5초 뒤로 잡혀 있음

  // ── 3) 성능 진단 ──
  const WINDOW = 60000;
  const samples = []; // [time, name, ms]
  const add = (name, ms) => {
    const t = performance.now();
    samples.push([t, name, ms]);
    while (samples.length && t - samples[0][0] > WINDOW) samples.shift();
  };
  const time = (name, fn) => {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      add(name, performance.now() - t0);
    }
  };
  const longTasks = []; // [time, ms]
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push([e.startTime, e.duration]);
      const t = performance.now();
      while (longTasks.length && t - longTasks[0][0] > WINDOW) longTasks.shift();
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  function report() {
    const t = performance.now();
    const by = {};
    for (const [st, name, ms] of samples) {
      if (t - st > WINDOW) continue;
      const b = (by[name] ||= { ms: 0, n: 0, max: 0 });
      b.ms += ms;
      b.n++;
      b.max = Math.max(b.max, ms);
    }
    const lt = longTasks.filter(([st]) => t - st <= WINDOW);
    return {
      seconds: Math.round(Math.min(WINDOW, t) / 1000),
      parts: Object.entries(by).map(([name, b]) => ({ name, ms: Math.round(b.ms), n: b.n, max: Math.round(b.max) })).sort((a, b) => b.ms - a.ms),
      longTasks: { n: lt.length, ms: Math.round(lt.reduce((a, [, d]) => a + d, 0)), max: Math.round(lt.reduce((a, [, d]) => Math.max(a, d), 0)) },
      images: imgs.length,
      videos: vids.length,
      visible: visible.size,
    };
  }
  if (window.top === window) {
    try {
      chrome.runtime.onMessage.addListener((msg, _s, send) => {
        if (msg?.type === 'smd:perf') send(report());
      });
    } catch {}
  }

  globalThis.__SMD_PERF = { add, time, report, navigating, visible };
})();
