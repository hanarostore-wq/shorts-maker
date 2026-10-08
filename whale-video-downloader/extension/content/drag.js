// 떠 있는 버튼(좋아요·팔로우·목록 전부 팔로우) 끌어서 옮기기 — 사이트마다 위치를 기억한다
//  - 5px 넘게 끌면 이동(놓을 때 단추가 눌리지 않음), 그보다 적으면 보통 누르기
//  - 위치는 화면 오른쪽·아래 기준 거리로 저장(창 크기가 바뀌어도 화면 안에 들어오게 맞춤)
//  - 팝업 '이 사이트'의 '떠 있는 버튼 위치 처음으로'로 되돌리기
(() => {
  'use strict';
  if (globalThis.__SMD_DRAG) return;
  const site = () => globalThis.__SMD_SITE_ID || globalThis.__SMD_SITES?.pick?.(location.hostname)?.id || 'generic';
  let saved = {}; // { [site]: { [name]: { r, b } } }
  const hosts = new Map(); // name -> { host, def: { right, bottom } }
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const clamp = (host, r, b) => {
    const rect = host.getBoundingClientRect();
    const w = rect.width || 60;
    const h = rect.height || 60;
    return { r: Math.round(Math.min(Math.max(0, r), Math.max(0, innerWidth - w))), b: Math.round(Math.min(Math.max(0, b), Math.max(0, innerHeight - h))) };
  };
  function place(name) {
    const e = hosts.get(name);
    if (!e?.host.isConnected) return;
    const p = saved[site()]?.[name];
    if (!p) {
      e.host.style.right = e.def.right;
      e.host.style.bottom = e.def.bottom;
      return;
    }
    const c = clamp(e.host, p.r, p.b);
    e.host.style.right = `${c.r}px`;
    e.host.style.bottom = `${c.b}px`;
  }
  const placeAll = () => hosts.forEach((_, n) => place(n));
  chrome.storage.local.get('floatPos').then((r) => {
    saved = r.floatPos || {};
    placeAll();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.floatPos) {
      saved = c.floatPos.newValue || {};
      placeAll();
    }
  });
  addEventListener('resize', placeAll);

  globalThis.__SMD_DRAG = (host, name) => {
    if (host.__smdDrag) return;
    host.__smdDrag = true;
    hosts.set(name, { host, def: { right: host.style.right, bottom: host.style.bottom } });
    host.style.touchAction = 'none';
    host.title = host.title || '끌어서 위치를 옮길 수 있습니다';
    let start = null;
    let moved = false;
    let suppress = false;
    host.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.button !== 0) return;
        const r = host.getBoundingClientRect();
        start = { x: ev.clientX, y: ev.clientY, r: innerWidth - r.right, b: innerHeight - r.bottom };
        moved = false;
      },
      true,
    );
    // 사이트가 단추 이벤트를 막아도 받을 수 있게 window 캡처 단계에서 듣는다
    addEventListener(
      'pointermove',
      (ev) => {
        if (!start) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        host.style.cursor = 'grabbing';
        const c = clamp(host, start.r - dx, start.b - dy);
        host.style.right = `${c.r}px`;
        host.style.bottom = `${c.b}px`;
        ev.preventDefault();
      },
      true,
    );
    addEventListener(
      'pointerup',
      () => {
        if (!start) return;
        start = null;
        host.style.cursor = '';
        if (!moved) return;
        suppress = true; // 끌기를 끝낸 뒤 바로 오는 클릭은 단추로 보내지 않는다
        setTimeout(() => (suppress = false), 300);
        const p = { r: parseInt(host.style.right, 10) || 0, b: parseInt(host.style.bottom, 10) || 0 };
        const id = site();
        saved = { ...saved, [id]: { ...(saved[id] || {}), [name]: p } };
        if (!alive()) return;
        chrome.storage.local.get('floatPos').then(
          (r) => {
            const all = r.floatPos || {};
            all[id] = { ...(all[id] || {}), [name]: p };
            return chrome.storage.local.set({ floatPos: all });
          },
          () => {},
        );
      },
      true,
    );
    host.addEventListener(
      'click',
      (ev) => {
        if (!suppress) return;
        suppress = false;
        ev.stopPropagation();
        ev.preventDefault();
      },
      true,
    );
    place(name);
  };
})();
