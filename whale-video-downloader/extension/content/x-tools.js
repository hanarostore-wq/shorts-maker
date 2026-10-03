// X(트위터) 전용 도구 (ISOLATED world)
//  1) 홈·탐색 피드의 게시물 작성자 옆에 팔로우 / 팔로잉 상태 버튼 (눌러서 팔로우·언팔로우)
//  2) 영상이 재생되면 소리 자동 켜기
(() => {
  'use strict';
  if (globalThis.__SMD_XTOOLS || !/(^|\.)(x|twitter)\.com$/.test(location.hostname) || window.top !== window) return;
  globalThis.__SMD_XTOOLS = true;
  const SITES = globalThis.__SMD_SITES;
  if (!SITES || !chrome?.runtime?.id) return;

  let settings = { xFollowButtons: true, xAutoSound: true, xWideLayout: true, xKeepControls: true, xHighQuality: true, xThickBar: true };
  let wideStyle = null; // applyWide() 가 아래보다 먼저 불리므로 여기서 선언
  chrome.storage.local.get('settings').then((r) => {
    settings = { ...settings, ...(r.settings || {}) };
    applyWide();
    syncHq();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      settings = { ...settings, ...(c.settings.newValue || {}) };
      if (settings.xFollowButtons === false) document.querySelectorAll('smd-follow').forEach((e) => e.remove());
      applyWide();
      syncHq();
    }
  });

  // ───────────── 0) 넓은 화면: 오른쪽 사이드바 숨기고 가운데 피드를 크게 ─────────────
  const WIDE_CSS = `
    [data-testid="sidebarColumn"]{display:none !important}
    main[role="main"] > div{width:100% !important;max-width:none !important}
    main[role="main"] > div > div{max-width:none !important;width:100% !important;justify-content:flex-start !important}
    [data-testid="primaryColumn"]{max-width:1100px !important;width:100% !important;flex:1 1 auto !important}
    [data-testid="primaryColumn"] > div{max-width:none !important}
  `;
  function applyWide() {
    const on = settings.xWideLayout !== false;
    if (on && !wideStyle) {
      wideStyle = document.createElement('style');
      wideStyle.id = 'smd-x-wide';
      wideStyle.textContent = WIDE_CSS;
      (document.head || document.documentElement).appendChild(wideStyle);
    } else if (!on && wideStyle) {
      wideStyle.remove();
      wideStyle = null;
    }
  }

  // ── MAIN world 질의(작성자 React 데이터, 인증 헤더) ──
  let seq = 0;
  const waiting = new Map();
  document.addEventListener('__smd_res', (ev) => {
    try {
      const res = JSON.parse(ev.detail);
      const w = waiting.get(res.id);
      if (w) {
        waiting.delete(res.id);
        w(res.data || {});
      }
    } catch {}
  });
  const ask = (req, timeout = 1500) =>
    new Promise((resolve) => {
      const id = `x${Date.now()}-${++seq}`;
      waiting.set(id, resolve);
      document.dispatchEvent(new CustomEvent('__smd_req', { detail: JSON.stringify({ ...req, id }) }));
      setTimeout(() => waiting.delete(id) && resolve({}), timeout);
    });

  // X 웹이 쓰는 공개 Bearer (페이지가 실제로 쓴 값을 받으면 그것을 우선 사용)
  const WEB_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  let pageAuth = '';
  const cookie = (name) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || '';

  // ───────────── 1) 팔로우 버튼 ─────────────
  const CSS = `
    :host{all:initial;display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;color:inherit}
    button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 10px;border-radius:999px;
      font:700 12px/1 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
    button.follow{color:#fff;background:linear-gradient(135deg,#5b5cff,#9b4dff 55%,#ff4f8b)}
    button.follow.unknown{opacity:.85}
    button.following{color:inherit;border:1px solid rgba(128,128,140,.55);height:20px}
    button.following:hover{color:#f4212e;border-color:rgba(244,33,46,.6);background:rgba(244,33,46,.08)}
    button.busy{opacity:.6;pointer-events:none}
    .err{margin-left:6px;font:600 11px/1.3 "Malgun Gothic",system-ui,sans-serif;color:#f4212e;max-width:260px}
  `;
  const buttons = new Map(); // article -> {host, btn, sn}

  const myHandle = () => (document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || '').replace(/^\//, '').toLowerCase();

  function render(entry) {
    const u = SITES.xUsers.get(entry.sn.toLowerCase());
    const f = u?.following;
    const b = entry.btn;
    b.classList.remove('follow', 'following', 'unknown');
    if (f === true) {
      b.classList.add('following');
      b.textContent = '팔로잉';
      b.title = `@${entry.sn} 님을 팔로우 중입니다 · 누르면 팔로우 취소`;
    } else {
      b.classList.add('follow');
      if (f === undefined || f === null) b.classList.add('unknown');
      b.textContent = '팔로우';
      b.title = f === false ? `@${entry.sn} 님을 팔로우하지 않았습니다 · 누르면 팔로우` : '팔로우 상태를 아직 확인하지 못했습니다 · 누르면 팔로우';
    }
  }
  const renderAll = (sn) => {
    for (const e of buttons.values()) if (!sn || e.sn.toLowerCase() === sn.toLowerCase()) render(e);
  };

  function showErr(entry, text) {
    entry.err?.remove();
    const s = document.createElement('span');
    s.className = 'err';
    s.textContent = text;
    entry.btn.after(s);
    entry.err = s;
    setTimeout(() => s.remove(), 9000);
  }

  async function toggle(entry) {
    const key = entry.sn.toLowerCase();
    let u = SITES.xUsers.get(key) || { screenName: entry.sn };
    const unfollow = u.following === true;
    if (unfollow && !window.confirm(`@${entry.sn} 님 팔로우를 취소할까요?`)) return;
    const ct0 = cookie('ct0');
    if (!ct0) return showErr(entry, '팔로우 실패(로그인 확인): X 로그인 쿠키가 없습니다. X에 로그인한 뒤 새로고침하세요.');
    if (!pageAuth) pageAuth = (await ask({ kind: 'reactuser', token: '', screenName: '' }, 800)).auth || '';
    entry.btn.classList.add('busy');
    const body = new URLSearchParams({ include_profile_interstitial_type: '1', skip_status: 'true' });
    if (u.id) body.set('user_id', u.id);
    else body.set('screen_name', entry.sn);
    try {
      const res = await fetch(`/i/api/1.1/friendships/${unfollow ? 'destroy' : 'create'}.json`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          authorization: pageAuth || WEB_BEARER,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          'x-twitter-client-language': 'ko',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) {
        const why = res.status === 401 || res.status === 403 ? 'X 로그인 상태가 만료됐거나 X 가 요청을 막았습니다. 새로고침한 뒤 다시 누르세요.' : res.status === 429 ? '짧은 시간에 너무 많이 눌렀습니다. 잠시 후 다시 시도하세요.' : '잠시 후 다시 시도하세요.';
        return showErr(entry, `${unfollow ? '언팔로우' : '팔로우'} 실패(HTTP ${res.status}): ${why}`);
      }
      const j = await res.json().catch(() => ({}));
      SITES.xUsers.set(key, { id: String(j.id_str || u.id || ''), screenName: entry.sn, following: !unfollow, t: Date.now() });
      renderAll(entry.sn);
    } catch (err) {
      showErr(entry, `${unfollow ? '언팔로우' : '팔로우'} 실패(네트워크): ${err?.message || err}. 인터넷 연결을 확인하세요.`);
    } finally {
      entry.btn.classList.remove('busy');
    }
  }

  let markSeq = 0;
  async function resolveUnknown(entry, article) {
    if (entry.asked) return;
    entry.asked = true;
    if (!article.dataset.smdQ) article.dataset.smdQ = `xf${++markSeq}`;
    const r = await ask({ kind: 'reactuser', token: article.dataset.smdQ, screenName: entry.sn });
    if (r.auth) pageAuth = r.auth;
    if (r.user && r.user.following !== null) {
      const key = entry.sn.toLowerCase();
      const prev = SITES.xUsers.get(key);
      if (prev?.following === undefined || prev?.following === null || !prev) {
        SITES.xUsers.set(key, { id: r.user.id, screenName: r.user.screenName, following: r.user.following, t: Date.now() });
        renderAll(entry.sn);
      }
    }
  }

  function scanFollow() {
    if (settings.xFollowButtons === false) return;
    const me = myHandle();
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const nameBox = article.querySelector('[data-testid="User-Name"]');
      if (!nameBox) continue;
      const link = [...nameBox.querySelectorAll('a[href^="/"]')].find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(a.getAttribute('href')));
      const sn = link?.getAttribute('href').slice(1);
      if (!sn || sn.toLowerCase() === me) continue;
      const cur = buttons.get(article);
      if (cur && cur.sn === sn && cur.host.isConnected) continue;
      cur?.host.remove();
      const host = document.createElement('smd-follow');
      const sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>${CSS}</style><button type="button"></button>`;
      const entry = { host, btn: sh.querySelector('button'), sn };
      for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
        entry.btn.addEventListener(t, (ev) => {
          ev.stopPropagation();
          if (t === 'click') {
            ev.preventDefault();
            toggle(entry);
          }
        });
      }
      entry.btn.addEventListener('mouseenter', () => entry.btn.classList.contains('following') && (entry.btn.textContent = '언팔로우'));
      entry.btn.addEventListener('mouseleave', () => entry.btn.classList.contains('following') && (entry.btn.textContent = '팔로잉'));
      host.addEventListener('click', (ev) => ev.stopPropagation());
      (nameBox.firstElementChild || nameBox).appendChild(host);
      buttons.set(article, entry);
      render(entry);
      const u = SITES.xUsers.get(sn.toLowerCase());
      if (u?.following === undefined || u?.following === null) setTimeout(() => resolveUnknown(entry, article), 300);
    }
    for (const [a, e] of buttons) if (!a.isConnected) buttons.delete(a);
  }

  // ───────────── 2) 영상 소리 자동 켜기 ─────────────
  let pendingUnmute = null;
  function unmute(v) {
    if (settings.xAutoSound === false || !v.muted) return;
    // X 플레이어의 음소거 버튼이 있으면 그것을 눌러 X 화면 상태도 맞춘다
    const player = v.closest('[data-testid="videoPlayer"]') || v.parentElement;
    const btn = player?.querySelector('[aria-label*="Unmute" i], [aria-label*="음소거 해제"], [data-testid="unmuteButton"]');
    if (btn) btn.click();
    else v.muted = false;
    if (v.volume === 0) v.volume = 1;
    // 사용자가 페이지를 한 번도 누르지 않았으면 브라우저가 소리 재생을 막고 영상을 멈춘다 → 음소거로 계속 재생, 첫 클릭 때 소리 켜기
    setTimeout(() => {
      if (v.paused && !v.ended) {
        v.muted = true;
        v.play().catch(() => {});
        pendingUnmute = v;
      }
    }, 150);
  }
  document.addEventListener('playing', (ev) => ev.target instanceof HTMLVideoElement && unmute(ev.target), true);
  const onGesture = () => {
    if (pendingUnmute && pendingUnmute.isConnected && !pendingUnmute.paused) {
      const v = pendingUnmute;
      pendingUnmute = null;
      unmute(v);
    }
  };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);

  // ───────────── 3) 재생바 항상 표시 + 진행 막대 두껍게 + 고화질 설정 전달 ─────────────
  function syncHq() {
    // hook.js(페이지 쪽)는 페이지가 열릴 때 이 값을 읽는다
    try { localStorage.setItem('smd_xhq', settings.xHighQuality === false ? '0' : '1'); } catch {}
  }
  function keepControls() {
    if (settings.xKeepControls === false) return;
    for (const v of document.querySelectorAll('[data-testid="videoPlayer"] video')) {
      const r = v.getBoundingClientRect();
      if (r.width < 100 || r.bottom < 0 || r.top > innerHeight) continue;
      // X 는 마우스가 일정 시간 안 움직이면 재생바를 숨긴다 → 플레이어 위에서 마우스가 움직인 것처럼 알려 준다
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const target = v.closest('[data-testid="videoPlayer"]') || v;
      for (const type of ['pointermove', 'mousemove']) {
        target.dispatchEvent(new (type === 'pointermove' && window.PointerEvent ? PointerEvent : MouseEvent)(type, { bubbles: true, clientX: x, clientY: y, view: window }));
      }
    }
  }
  function thickBar() {
    if (settings.xThickBar === false) return;
    for (const slider of document.querySelectorAll('[data-testid="videoPlayer"] [role="slider"]')) {
      for (const el of slider.querySelectorAll('div')) {
        if (el.dataset.smdBar) continue;
        const cs = getComputedStyle(el);
        const h = parseFloat(cs.height);
        const w = parseFloat(cs.width);
        if (h > 0 && h <= 4 && w > 20) {
          // 진행 막대(전체·재생한 부분·버퍼)
          el.dataset.smdBar = 'track';
          el.style.setProperty('height', '8px', 'important');
          el.style.setProperty('border-radius', '4px', 'important');
        } else if (h >= 8 && h <= 16 && Math.abs(w - h) <= 2 && /50%|999|9999/.test(cs.borderRadius + el.style.borderRadius) ) {
          // 동그란 손잡이
          el.dataset.smdBar = 'thumb';
          el.style.setProperty('width', '18px', 'important');
          el.style.setProperty('height', '18px', 'important');
        }
      }
    }
  }

  // ── 반복 확인 ──
  syncHq();
  applyWide();
  scanFollow();
  let pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      scanFollow();
    }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    keepControls();
    thickBar();
  }, 1200);
  setInterval(() => {
    if (wideStyle && !wideStyle.isConnected) (document.head || document.documentElement).appendChild(wideStyle);
    scanFollow();
    for (const e of buttons.values()) {
      const u = SITES.xUsers.get(e.sn.toLowerCase());
      const want = u?.following === true ? 'following' : 'follow';
      if (!e.btn.classList.contains(want) && !e.btn.classList.contains('busy')) render(e);
    }
  }, 1500);
})();
