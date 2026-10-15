// 블랙전용(개인용 기능) — 마우스 제스처 공용 계산(콘텐츠 스크립트·팝업·단위 시험에서 씀). 유료판에서는 black/ 째 빠진다.
//  - 오른쪽 버튼을 누른 채 끌면 방향(L·R·U·D)을 차례로 읽어 '← ↑' 같은 제스처를 만든다
//  - 동작 이름은 여기서만 정하고, 실제 실행은 black-gesture.js(스크롤) · black-sw.js(탭 동작)가 한다
(() => {
  'use strict';
  const ACTIONS = {
    none: '동작 없음',
    back: '뒤로',
    forward: '앞으로',
    top: '맨 위로 스크롤',
    bottom: '맨 아래로 스크롤',
    close: '탭 닫기',
    reload: '새로고침',
    newtab: '새 탭',
    prevtab: '이전 탭',
    nexttab: '다음 탭',
  };
  // 스크린샷의 기본 제스처(← 뒤로, ↑ 맨 위, ↓ 탭 닫기)에 → 앞으로와 꺾는 제스처 네 개를 더함
  const DEFAULT_MAP = { L: 'back', R: 'forward', U: 'top', D: 'close', UL: 'prevtab', UR: 'nexttab', DL: 'bottom', DR: 'reload' };
  const ARROW = { L: '←', R: '→', U: '↑', D: '↓' };
  const MIN_SEG = 24; // 한 방향으로 인정하는 최소 이동(px) — 작을수록 반응이 빠르고, 클수록 떨림에 둔함
  const DEAD_ZONE = 8; // 이만큼 안 움직이면 그냥 오른쪽 클릭(메뉴 열림)

  const arrows = (dirs) => [...dirs].map((d) => ARROW[d] || '').join('');

  // 저장된 값에서 알 수 없는 제스처·동작은 버리고, 빠진 것은 기본값으로 채운다
  function sanitizeMap(raw) {
    const out = { ...DEFAULT_MAP };
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) if (k in DEFAULT_MAP && typeof v === 'string' && v in ACTIONS) out[k] = v;
    }
    return out;
  }

  const resolve = (dirs, map) => (map && map[dirs] && map[dirs] in ACTIONS ? map[dirs] : 'none');

  // 마우스 위치를 하나씩 받아 방향 열을 만든다. 일을 거의 안 해서(점 하나당 몇 번 계산) 끌면서도 가볍다.
  function createTracker({ minSeg = MIN_SEG, maxStrokes = 2 } = {}) {
    let sx = 0;
    let sy = 0;
    let ax = 0;
    let ay = 0;
    let dirs = '';
    let far = 0;
    return {
      start(x, y) {
        sx = ax = x;
        sy = ay = y;
        dirs = '';
        far = 0;
      },
      // 방향 열이 바뀌면 true
      move(x, y) {
        far = Math.max(far, Math.abs(x - sx), Math.abs(y - sy));
        const dx = x - ax;
        const dy = y - ay;
        if (Math.hypot(dx, dy) < minSeg) return false;
        const d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : dy < 0 ? 'U' : 'D';
        ax = x;
        ay = y;
        if (dirs.endsWith(d) || dirs.length >= maxStrokes) return false;
        dirs += d;
        return true;
      },
      get dirs() {
        return dirs;
      },
      get far() {
        return far;
      },
    };
  }

  globalThis.__SMD_GESTURE_CORE = { ACTIONS, DEFAULT_MAP, ARROW, MIN_SEG, DEAD_ZONE, arrows, sanitizeMap, resolve, createTracker };
})();
