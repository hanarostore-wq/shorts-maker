// 블랙전용(개인용 기능) — 마우스 오른쪽 버튼을 누른 채 끌면 제스처로 동작한다. 유료판에서는 black/ 째 빠진다.
//  - 끄는 동안 자취(선)와 동작 이름을 보여 주고, 버튼을 떼는 순간 바로 실행한다(기다리는 시간 없음)
//  - 8px 안쪽은 그냥 오른쪽 클릭(메뉴가 열림). Shift·Ctrl·Alt 를 누른 채면 제스처 없이 원래대로
//  - 스크롤은 이 페이지에서 바로, 뒤로·탭 닫기 같은 탭 동작은 서비스워커(black-sw.js)에 맡긴다
//  - 켜고 끄기·제스처별 동작은 팝업 '블랙전용' 탭 (기본 켬)
(() => {
  'use strict';
  const core = globalThis.__SMD_GESTURE_CORE;
  if (!core || globalThis.__SMD_BLACK_GESTURE) return;
  globalThis.__SMD_BLACK_GESTURE = true;
  // 확장 업데이트 뒤에는 연결이 끊긴 예전 스크립트와 새 스크립트가 함께 있다 → 새 스크립트만 동작
  const ME = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    document.documentElement.setAttribute('data-smd-black-g', ME);
  } catch {}
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const newest = () => document.documentElement.getAttribute('data-smd-black-g') === ME;

  let on = true;
  let map = core.sanitizeMap(null);
  const load = (s) => {
    on = s?.blackGesture !== false;
    map = core.sanitizeMap(s?.blackGestureMap);
  };
  chrome.storage.local.get('settings').then((r) => load(r.settings), () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) load(c.settings.newValue);
  });

  // 광고 같은 작은 프레임에서는 동작하지 않는다
  const tiny = () => window.top !== window && (innerWidth < 240 || innerHeight < 160);

  const tracker = core.createTracker();
  let down = false; // 오른쪽 버튼을 누르고 있음
  let shown = false; // 자취를 그리는 중
  let swallow = false; // 끌었다 놓은 뒤 따라오는 오른쪽 클릭 메뉴를 막는다(윈도우는 버튼을 뗄 때 메뉴 이벤트가 옴)
  let swallowTimer = 0;
  let startX = 0;
  let startY = 0;
  let canvas = null;
  let ctx = null;
  let label = null;
  let lastX = 0;
  let lastY = 0;
  let curX = 0;
  let curY = 0;
  let raf = 0;

  function showErr(e) {
    const box = document.createElement('div');
    box.setAttribute('data-smd-black-err', '');
    box.style.cssText = 'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:420px;padding:10px 14px;border-radius:12px;background:rgba(150,20,40,.96);color:#fff;font:600 12.5px/1.5 "Malgun Gothic",system-ui,sans-serif;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.4)';
    box.textContent = `제스처 실패(${e.what})\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action}`;
    (document.body || document.documentElement).appendChild(box);
    setTimeout(() => box.remove(), 6000);
  }

  function overlay() {
    const dpr = Math.max(1, devicePixelRatio || 1);
    canvas = document.createElement('canvas');
    canvas.setAttribute('data-smd-gesture', '');
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#9b5cff';
    label = document.createElement('div');
    label.setAttribute('data-smd-gesture', '');
    label.style.cssText = 'all:initial;position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:6px 14px;border-radius:999px;background:rgba(20,16,30,.94);border:1px solid #9b5cff;color:#fff;font:700 14px/1.4 "Malgun Gothic",system-ui,sans-serif;white-space:nowrap;display:none';
    const root = document.documentElement;
    root.appendChild(canvas);
    root.appendChild(label);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    lastX = startX;
    lastY = startY;
  }

  function paint() {
    raf = 0;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    lastX = curX;
    lastY = curY;
    ctx.lineTo(curX, curY);
    ctx.stroke();
  }

  function updateLabel() {
    if (!label) return;
    const d = tracker.dirs;
    if (!d) {
      label.style.display = 'none';
      return;
    }
    const act = core.resolve(d, map);
    label.textContent = `${core.arrows(d)}  ${act === 'none' ? '동작 없음' : core.ACTIONS[act]}`;
    label.style.opacity = act === 'none' ? '.6' : '1';
    label.style.display = 'block';
  }

  function clearOverlay() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    canvas?.remove();
    label?.remove();
    canvas = ctx = label = null;
    shown = false;
  }

  function cancel() {
    down = false;
    clearOverlay();
  }

  // 이 페이지에서 바로 하는 스크롤: 누르기 시작한 자리 아래의 스크롤되는 칸(없으면 페이지 전체)
  function scrollTarget(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function send(action) {
    chrome.runtime.sendMessage({ type: 'smd:black-gesture', action }).then(
      (r) => r?.error && showErr({ what: core.ACTIONS[action], ...r.error }),
      (err) => showErr({ what: core.ACTIONS[action], step: '제스처 요청', reason: `확장프로그램 백그라운드에 요청하지 못했습니다 (${err?.message || err})`, action: '이 페이지를 새로고침(F5)한 뒤 다시 해 보세요.' }),
    );
  }

  function run(action, x, y) {
    if (action === 'top' || action === 'bottom') {
      const el = scrollTarget(x, y);
      const page = el === document.scrollingElement || el === document.documentElement;
      // 안쪽 프레임이 스크롤되지 않으면 맨 위 페이지를 스크롤하도록 요청
      if (page && window.top !== window && el.scrollHeight <= el.clientHeight + 1) return send(action);
      el.scrollTo({ top: action === 'top' ? 0 : el.scrollHeight, behavior: 'instant' });
      return;
    }
    send(action);
  }

  addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 2 || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !on || globalThis.__SMD_OFF || tiny()) return; // __SMD_OFF: 이 사이트 제외
      if (!alive() && !newest()) return;
      down = true;
      swallow = false;
      startX = e.clientX;
      startY = e.clientY;
      tracker.start(e.clientX, e.clientY);
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'mousemove',
    (e) => {
      if (!down) return;
      if (!(e.buttons & 2)) return cancel(); // 창 밖에서 버튼을 뗀 경우
      curX = e.clientX;
      curY = e.clientY;
      const changed = tracker.move(curX, curY);
      if (!shown) {
        if (tracker.far < core.DEAD_ZONE) return; // 떨림 정도는 무시
        shown = true;
        overlay();
      }
      if (changed) updateLabel();
      if (!raf) raf = requestAnimationFrame(paint);
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 2 || !down) return;
      down = false;
      const dragged = shown || tracker.far >= core.DEAD_ZONE;
      const dirs = tracker.dirs;
      clearOverlay();
      if (!dragged) return; // 가만히 눌렀다 뗌 → 원래 오른쪽 클릭
      swallow = true;
      clearTimeout(swallowTimer);
      swallowTimer = setTimeout(() => (swallow = false), 500);
      const action = core.resolve(dirs, map);
      if (action === 'none') return;
      if (!alive()) {
        if (newest()) showErr({ what: core.ACTIONS[action], step: '확장프로그램 연결 확인', reason: '확장프로그램이 업데이트(또는 다시 시작)되어 이 페이지와 연결이 끊겼습니다', action: '이 페이지를 새로고침(F5)한 뒤 다시 해 보세요.' });
        return;
      }
      run(action, startX, startY);
    },
    { capture: true, passive: true },
  );

  // 끌고 난 뒤에는 오른쪽 클릭 메뉴가 뜨지 않게(윈도우: 버튼을 뗄 때 메뉴 이벤트가 따라옴)
  addEventListener(
    'contextmenu',
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  addEventListener('blur', cancel);
  addEventListener(
    'keydown',
    (e) => {
      if (down && e.key === 'Escape') cancel();
    },
    true,
  );
})();
