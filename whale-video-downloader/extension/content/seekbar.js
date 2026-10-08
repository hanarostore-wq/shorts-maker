// 재생바(모든 사이트): 재생 위치를 옮기는 바가 없는 영상(인스타 등) 아래쪽에 재생바와 시간을 띄운다.
//  - 브라우저 기본 재생 막대(controls)가 있는 영상은 건너뛴다. 자체 재생바가 있는 사이트(유튜브·X 등)는 처음에 꺼 둠
//  - 바를 누르거나 끌면 그 위치로 이동. 마우스를 올리면 바가 두꺼워진다.
//  - 사이트 화면 밖(페이지 맨 위)에 띄워 사이트의 투명 막·클릭 처리에 가려지지 않게 한다.
//  - 팝업 '이 사이트'에서 켜고 끄기(seekBar, 기본 켬)
(() => {
  'use strict';
  if (globalThis.__SMD_SEEKBAR || window.top !== window) return;
  const site = globalThis.__SMD_SITE_ID || globalThis.__SMD_SITES?.pick?.(location.hostname)?.id || 'generic';
  globalThis.__SMD_SEEKBAR = true;

  const effOf = (s, id) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[id] || {}) });
  let on = false; // 설정을 읽은 뒤에 켠다
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  // 자체 재생바가 있는 사이트는 이 사이트에서 직접 켰을 때만(사이트 재생 단추를 가리지 않게)
  const NATIVE_BAR = new Set(['youtube', 'x', 'bluesky', 'tiktok', 'douyin', 'facebook', 'bilibili', 'weibo', 'vimeo', 'dailymotion', 'naver']);
  const want = (s) => (NATIVE_BAR.has(site) ? ((s || {}).siteSettings || {})[site]?.seekBar === true : effOf(s, site).seekBar !== false);
  chrome.storage.local.get('settings').then((r) => {
    on = want(r.settings);
    kick();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      on = want(c.settings.newValue);
      kick();
    }
  });

  const CSS = `
    :host{all:initial}
    .w{position:fixed;left:0;top:0;height:22px;display:flex;align-items:center;gap:8px;padding:0 10px;box-sizing:border-box;pointer-events:auto;cursor:pointer;
      font:600 11px/1 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.8)}
    .w[hidden]{display:none}
    .bar{position:relative;flex:1;height:4px;border-radius:999px;background:rgba(255,255,255,.35);transition:height .12s}
    .w:hover .bar,.w.drag .bar{height:7px}
    .buf{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:rgba(255,255,255,.45)}
    .cur{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,#7c4dff,#ff4f8b)}
    .dot{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5);opacity:0;transition:opacity .12s}
    .w:hover .dot,.w.drag .dot{opacity:1}
    .t{white-space:nowrap;min-width:74px;text-align:right}
  `;
  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
  };

  const bars = new Map(); // video -> { host, w, bar, cur, buf, dot, t }
  function make(v) {
    const host = document.createElement('smd-seek');
    host.setAttribute('style', 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none');
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${CSS}</style><div class="w" hidden title="재생 위치 이동"><div class="bar"><div class="buf"></div><div class="cur"></div><div class="dot"></div></div><div class="t">0:00 / 0:00</div></div>`;
    const e = { host, v, w: sh.querySelector('.w'), bar: sh.querySelector('.bar'), cur: sh.querySelector('.cur'), buf: sh.querySelector('.buf'), dot: sh.querySelector('.dot'), t: sh.querySelector('.t') };
    const seekTo = (x) => {
      const r = e.bar.getBoundingClientRect();
      const d = v.duration;
      if (!Number.isFinite(d) || d <= 0 || r.width <= 0) return;
      v.currentTime = Math.min(d - 0.05, Math.max(0, ((x - r.left) / r.width) * d));
      paint(e);
    };
    // 사이트로 클릭이 전달되지 않게(영상 멈춤·게시물 열기 방지)
    for (const t of ['click', 'mousedown', 'mouseup', 'pointerup', 'dblclick', 'touchstart', 'touchend']) e.w.addEventListener(t, (ev) => ev.stopPropagation());
    e.w.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      e.w.setPointerCapture(ev.pointerId);
      e.w.classList.add('drag');
      seekTo(ev.clientX);
      const move = (m) => seekTo(m.clientX);
      const up = () => {
        e.w.classList.remove('drag');
        e.w.removeEventListener('pointermove', move);
        e.w.removeEventListener('pointerup', up);
        e.w.removeEventListener('pointercancel', up);
      };
      e.w.addEventListener('pointermove', move);
      e.w.addEventListener('pointerup', up);
      e.w.addEventListener('pointercancel', up);
    });
    document.documentElement.appendChild(host);
    bars.set(v, e);
    return e;
  }
  function paint(e) {
    const v = e.v;
    const d = v.duration;
    const p = Number.isFinite(d) && d > 0 ? Math.min(1, v.currentTime / d) : 0;
    e.cur.style.width = `${p * 100}%`;
    e.dot.style.left = `${p * 100}%`;
    let b = 0;
    try {
      for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5) b = Math.max(b, v.buffered.end(i));
    } catch {}
    e.buf.style.width = `${Number.isFinite(d) && d > 0 ? Math.min(1, b / d) * 100 : 0}%`;
    e.t.textContent = `${fmt(v.currentTime)} / ${fmt(d)}`;
  }
  // 꺼져 있으면 아무것도 하지 않고(이미 띄운 바만 숨김), 켜져 있어도 보이는 바가 있을 때만 매 프레임 움직인다(페이지를 느리게 하지 않게)
  let running = false;
  function hideAll() {
    for (const e of bars.values()) e.w.hidden = true;
  }
  function tick() {
    const P = globalThis.__SMD_PERF;
    return P ? P.time('재생바', tickNow) : tickNow();
  }
  // 영상이 실제로 보이는 부분: 스크롤 상자(overflow)로 잘린 부분을 뺀 영역. 인스타 릴스처럼 위·아래 영상이
  //   스크롤 상자 밖에 숨어 있어도 화면 좌표로는 겹쳐 보여서 재생바가 여러 개 뜨던 문제를 막는다
  function shownRect(v) {
    const r = v.getBoundingClientRect();
    let L = Math.max(0, r.left);
    let T = Math.max(0, r.top);
    let R = Math.min(innerWidth, r.right);
    let B = Math.min(innerHeight, r.bottom);
    for (let p = v.parentElement; p && p !== document.body && p !== document.documentElement && R > L && B > T; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.overflowX === 'visible' && st.overflowY === 'visible' && st.clipPath === 'none') continue;
      const pr = p.getBoundingClientRect();
      L = Math.max(L, pr.left);
      T = Math.max(T, pr.top);
      R = Math.min(R, pr.right);
      B = Math.min(B, pr.bottom);
    }
    const area = Math.max(1, r.width * r.height);
    return { r, L, T, R, B, ratio: R > L && B > T ? ((R - L) * (B - T)) / area : 0 };
  }
  // 다른 영상·사진에 가려졌는지(보이는 영역 가운데에 맨 위로 그려진 것이 이 영상 묶음인지)
  function onTop(v, s) {
    const hit = document.elementFromPoint((s.L + s.R) / 2, (s.T + s.B) / 2);
    if (!hit) return false;
    if (hit === v || /^SMD-/.test(hit.tagName)) return true;
    if (hit.tagName === 'VIDEO') return false; // 다른 영상이 위에 있음
    for (let p = hit, i = 0; p && i < 8; p = p.parentElement, i++) if (p.contains(v)) return true;
    return false;
  }
  let chosen = new Set();
  let chosenAt = 0;
  function choose() {
    const cands = [];
    for (const [v, e] of bars) {
      if (!v.isConnected || v.controls || v.closest('smd-anchor') || !(Number.isFinite(v.duration) && v.duration > 0)) continue;
      const s = shownRect(v);
      // 화면에 60% 넘게 보이고, 보이는 부분이 충분히 크고, 다른 것에 가려지지 않은 영상만
      if (s.ratio < 0.6 || s.R - s.L < 200 || s.B - s.T < 150) continue;
      if (getComputedStyle(v).visibility === 'hidden' || !onTop(v, s)) continue;
      cands.push({ v, s });
    }
    // 같은 자리에 겹친 영상(흐린 배경용 복사본 등)은 하나만: 재생 중·큰 것 우선
    cands.sort((a, b) => (b.v.paused ? 0 : 1) - (a.v.paused ? 0 : 1) || (b.s.R - b.s.L) * (b.s.B - b.s.T) - (a.s.R - a.s.L) * (a.s.B - a.s.T));
    const keep = [];
    for (const c of cands) {
      const dup = keep.some((k) => {
        const w = Math.min(k.s.R, c.s.R) - Math.max(k.s.L, c.s.L);
        const h = Math.min(k.s.B, c.s.B) - Math.max(k.s.T, c.s.T);
        return w > 0 && h > 0 && w * h > 0.5 * Math.min((k.s.R - k.s.L) * (k.s.B - k.s.T), (c.s.R - c.s.L) * (c.s.B - c.s.T));
      });
      if (!dup) keep.push(c);
    }
    chosen = new Set(keep.map((c) => c.v));
    chosenAt = performance.now();
  }
  function tickNow() {
    running = false;
    if (!alive()) return;
    if (!on || document.hidden) return hideAll();
    for (const v of document.querySelectorAll('video')) if (!bars.has(v)) make(v);
    for (const [v, e] of bars) {
      if (v.isConnected) continue;
      e.host.remove();
      bars.delete(v);
    }
    if (performance.now() - chosenAt > 250) choose();
    let visible = 0;
    for (const [v, e] of bars) {
      if (!chosen.has(v)) {
        e.w.hidden = true;
        continue;
      }
      const s = shownRect(v);
      if (s.ratio < 0.6) {
        e.w.hidden = true;
        continue;
      }
      e.w.hidden = false;
      visible++;
      // 보이는 부분의 맨 아래에 붙인다
      e.w.style.transform = `translate(${Math.round(s.L)}px,${Math.round(s.B - 4 - 22)}px)`;
      e.w.style.width = `${Math.round(s.R - s.L)}px`;
      paint(e);
    }
    if (visible) {
      running = true;
      requestAnimationFrame(tick);
    }
  }
  const kick = () => !running && (running = true) && requestAnimationFrame(tick);
  setInterval(kick, 500); // 새 영상·스크롤로 보이게 된 영상 찾기
  addEventListener('scroll', kick, { passive: true, capture: true });
  kick();
})();
