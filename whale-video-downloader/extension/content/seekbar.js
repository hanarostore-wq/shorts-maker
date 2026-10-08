// 재생바(인스타그램): 인스타 영상에는 재생 위치를 옮기는 바가 없어서, 영상 아래쪽에 재생바와 시간을 띄운다.
//  - 바를 누르거나 끌면 그 위치로 이동. 마우스를 올리면 바가 두꺼워진다.
//  - 사이트 화면 밖(페이지 맨 위)에 띄워 사이트의 투명 막·클릭 처리에 가려지지 않게 한다.
//  - 팝업 '이 사이트'에서 켜고 끄기(seekBar, 기본 켬)
(() => {
  'use strict';
  if (globalThis.__SMD_SEEKBAR || window.top !== window) return;
  const SITES = { instagram: /(^|\.)instagram\.com$/ };
  const site = Object.keys(SITES).find((k) => SITES[k].test(location.hostname));
  if (!site) return;
  globalThis.__SMD_SEEKBAR = true;

  const effOf = (s, id) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[id] || {}) });
  let on = true;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  chrome.storage.local.get('settings').then((r) => (on = effOf(r.settings, site).seekBar !== false), () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) on = effOf(c.settings.newValue, site).seekBar !== false;
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
  function tick() {
    if (!alive()) return;
    for (const v of document.querySelectorAll('video')) if (!bars.has(v)) make(v);
    for (const [v, e] of bars) {
      if (!v.isConnected) {
        e.host.remove();
        bars.delete(v);
        continue;
      }
      const r = v.getBoundingClientRect();
      const show = on && r.width >= 200 && r.height >= 150 && r.bottom > 30 && r.top < innerHeight - 10 && Number.isFinite(v.duration) && v.duration > 0 && getComputedStyle(v).visibility !== 'hidden';
      e.w.hidden = !show;
      if (!show) continue;
      // 영상 맨 아래(화면 밖으로 잘리면 화면 안쪽 끝)에 붙인다
      const bottom = Math.min(r.bottom, innerHeight) - 4;
      e.w.style.transform = `translate(${Math.round(r.left)}px,${Math.round(bottom - 22)}px)`;
      e.w.style.width = `${Math.round(r.width)}px`;
      paint(e);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
