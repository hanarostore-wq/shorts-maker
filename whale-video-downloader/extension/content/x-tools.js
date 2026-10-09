// X(트위터) 전용 도구 (ISOLATED world)
//  1) 홈·탐색 피드의 게시물 작성자 옆에 팔로우 / 팔로잉 상태 버튼 (눌러서 팔로우·언팔로우)
//  2) (마우스 올리면 재생은 hover-play.js)
(() => {
  'use strict';
  if (globalThis.__SMD_XTOOLS || !/(^|\.)(x|twitter)\.com$/.test(location.hostname) || window.top !== window) return;
  globalThis.__SMD_XTOOLS = true;
  const SITES = globalThis.__SMD_SITES;
  if (!SITES || !chrome?.runtime?.id) return;

  let settings = { xFollowButtons: true };
  const effOf = (s, site) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) }); // 사이트별로 바꾼 값이 우선
  chrome.storage.local.get('settings').then((r) => {
    settings = effOf({ ...settings, ...(r.settings || {}) }, 'x');
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      settings = effOf({ ...settings, ...(c.settings.newValue || {}) }, 'x');
      if (settings.xFollowButtons === false) document.querySelectorAll('smd-follow').forEach((e) => e.remove());
    }
  });

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
    :host{all:initial;display:inline-flex;align-items:center;flex-shrink:0;margin:0 6px;vertical-align:middle;color:inherit}
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

  // 실패를 버튼 옆에 보이고, 결과로 돌려준다(자동 팔로우 알림에 씀)
  function fail(entry, text) {
    showErr(entry, text);
    const m = /^(.*?)\((.*?)\)?:\s*(.*?)(?:\s*→\s*(.*))?$/.exec(text) || [];
    return { error: { step: m[1] ? `${m[1]}${m[2] ? ` (${m[2]})` : ''}` : '팔로우', reason: m[3] || text, action: m[4] || '' } };
  }
  function showErr(entry, text) {
    entry.err?.remove();
    const s = document.createElement('span');
    s.className = 'err';
    s.textContent = text;
    entry.btn.after(s);
    entry.err = s;
    setTimeout(() => s.remove(), 9000);
  }

  // X 의 게시물 ⋯ 메뉴에 있는 '팔로우 / 언팔로우' 항목을 대신 누른다.
  // X 는 팔로우 요청에 페이지 코드만 만들 수 있는 보안 값(x-client-transaction-id)을 요구해,
  // 확장이 직접 보낸 요청은 '성공' 응답을 받아도 실제로는 팔로우되지 않을 수 있다 → X 화면 기능을 그대로 쓴다.
  const waitFor = (fn, ms = 2500) =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const v = fn();
        if (v || Date.now() - t0 > ms) return resolve(v || null);
        setTimeout(tick, 50);
      };
      tick();
    });
  const closeMenu = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  async function followViaMenu(article, sn, follow) {
    const caret = article?.isConnected && article.querySelector('[data-testid="caret"]');
    if (!caret) return 'nomenu';
    caret.click();
    let menu = await waitFor(() => document.querySelector('[role="menu"]'));
    if (!menu && caret.isConnected) {
      // 다른 창(다운로드 안내 등)에 가려 메뉴가 안 열렸으면 한 번 더
      closeMenu();
      await new Promise((r) => setTimeout(r, 300));
      caret.click();
      menu = await waitFor(() => document.querySelector('[role="menu"]'));
    }
    if (!menu) return 'nomenu';
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const has = (el) => (el.textContent || '').toLowerCase().includes(`@${sn.toLowerCase()}`);
    const unf = items.find((el) => has(el) && /언팔로우|unfollow/i.test(el.textContent));
    const fol = items.find((el) => has(el) && /팔로우|follow/i.test(el.textContent) && !/언팔로우|unfollow/i.test(el.textContent));
    if (follow ? unf : fol) {
      // 이미 원하는 상태
      closeMenu();
      return 'already';
    }
    const target = follow ? fol : unf;
    if (!target) {
      closeMenu();
      return 'nomenu';
    }
    target.click();
    if (!follow) {
      const ok = await waitFor(() => document.querySelector('[data-testid="confirmationSheetConfirm"]'), 1500);
      if (ok) ok.click();
    }
    return 'done';
  }

  async function toggle(entry, onlyFollow = false) {
    const key = entry.sn.toLowerCase();
    let u = SITES.xUsers.get(key) || { screenName: entry.sn };
    if (onlyFollow && u.following === true) return { already: true }; // 자동 팔로우: 이미 팔로우 중이면 그대로
    const unfollow = u.following === true;
    // 언팔로우도 확인 창 없이 바로(사용자 요청)
    // 1) X 화면의 ⋯ 메뉴로(실제로 팔로우됨)
    entry.btn.classList.add('busy');
    let via = 'nomenu';
    try {
      via = await followViaMenu(entry.article, entry.sn, !unfollow);
    } catch {}
    entry.btn.classList.remove('busy');
    if (via === 'done' || via === 'already') {
      SITES.xUsers.set(key, { ...(SITES.xUsers.get(key) || {}), screenName: entry.sn, following: !unfollow, t: Date.now(), manualAt: Date.now() });
      renderAll(entry.sn);
      return via === 'already' ? { already: true } : { ok: true };
    }
    // 2) 메뉴가 없으면(사진·영상 보기 등) 직접 요청
    const ct0 = cookie('ct0');
    if (!ct0) return fail(entry, '팔로우 실패(로그인 확인): X 로그인 쿠키가 없습니다. X에 로그인한 뒤 새로고침하세요.');
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
        return fail(entry, `${unfollow ? '언팔로우' : '팔로우'} 실패(HTTP ${res.status}): ${why}`);
      }
      const j = await res.json().catch(() => ({}));
      // 응답이 200 이어도 본문에 오류가 들어 있으면 실패(실제로 팔로우되지 않음)
      if (Array.isArray(j.errors) && j.errors.length) {
        return fail(entry, `${unfollow ? '언팔로우' : '팔로우'} 실패(X 응답): ${j.errors.map((e) => e.message || e.code).join(', ')} → X 화면의 ⋯ 메뉴에서 직접 팔로우하거나 새로고침 후 다시 누르세요.`);
      }
      if (!j.id_str && !j.screen_name) {
        return fail(entry, `${unfollow ? '언팔로우' : '팔로우'} 확인 실패: X 가 결과를 돌려주지 않았습니다 → 프로필에서 실제로 팔로우됐는지 확인하세요.`);
      }
      SITES.xUsers.set(key, { id: String(j.id_str || u.id || ''), screenName: entry.sn, following: !unfollow, t: Date.now(), manualAt: Date.now() });
      renderAll(entry.sn);
      return { ok: true };
    } catch (err) {
      return fail(entry, `${unfollow ? '언팔로우' : '팔로우'} 실패(네트워크): ${err?.message || err} → 인터넷 연결을 확인하세요.`);
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
      const entry = { host, btn: sh.querySelector('button'), sn, article };
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
      // 이름 칸은 길면 잘려서(overflow:hidden) 버튼이 가려진다 → 오른쪽 끝 ⋯ 버튼 바로 왼쪽에 넣는다
      const caret = article.querySelector('[data-testid="caret"]');
      if (caret?.parentElement) caret.parentElement.insertBefore(host, caret);
      else nameBox.after(host);
      buttons.set(article, entry);
      render(entry);
      const u = SITES.xUsers.get(sn.toLowerCase());
      if (u?.following === undefined || u?.following === null) setTimeout(() => resolveUnknown(entry, article), 300);
    }
    for (const [a, e] of buttons) if (!a.isConnected) buttons.delete(a);
  }

  // 다운로드 버튼을 누른 게시물의 작성자 자동 팔로우
  const handleOf = (article) => {
    const nameBox = article?.querySelector('[data-testid="User-Name"]');
    const link = nameBox && [...nameBox.querySelectorAll('a[href^="/"]')].find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(a.getAttribute('href')));
    return link?.getAttribute('href').slice(1) || '';
  };
  document.addEventListener('smd:auto-follow', (ev) => {
    const d = ev.detail;
    if (!d?.el) return;
    d.handled = true;
    let article = d.el.closest('article[data-testid="tweet"]');
    // 사진·영상 확대 보기: 같은 게시물 글에서 작성자를 찾는다
    if (!article) {
      const id = /\/status\/(\d+)/.exec(location.pathname)?.[1];
      if (id) article = [...document.querySelectorAll('article[data-testid="tweet"]')].find((a) => a.querySelector(`a[href*="/status/${id}"]`)) || null;
    }
    let sn = handleOf(article) || /^\/([A-Za-z0-9_]{1,15})\/status\//.exec(location.pathname)?.[1] || '';
    if (!sn) return d.report?.({ error: { step: '작성자 찾기', reason: '누른 사진·영상의 게시물 작성자를 찾지 못했습니다', action: '게시물을 눌러 연 화면에서 다시 다운로드하거나 작성자 프로필에서 직접 팔로우하세요.' } });
    if (sn.toLowerCase() === myHandle()) return;
    const entry = (article && buttons.get(article)) || { sn, btn: document.createElement('button'), article };
    (async () => {
      // 팔로우 상태를 모르면 먼저 화면 데이터로 확인하고, 이미 팔로우 중이면 아무것도 하지 않는다
      const known = SITES.xUsers.get(sn.toLowerCase());
      if ((known?.following === undefined || known?.following === null) && article) {
        if (!article.dataset.smdQ) article.dataset.smdQ = `xf${++markSeq}`;
        const r = await ask({ kind: 'reactuser', token: article.dataset.smdQ, screenName: sn }, 1200);
        if (r.auth) pageAuth = r.auth;
        if (r.user && r.user.following !== null && r.user.following !== undefined) SITES.xUsers.set(sn.toLowerCase(), { id: r.user.id, screenName: r.user.screenName || sn, following: r.user.following, t: Date.now() });
      }
      const r = await toggle(entry, true).catch((err) => ({ error: { step: '팔로우', reason: err?.message || String(err) } }));
      d.report?.({ ...(r || { ok: true }), who: `@${sn}` });
    })();
  });

  // 2) 마우스 올리면 재생·소리 켜기는 모든 사이트 공용 hover-play.js 가 맡는다

  // ── 반복 확인 ──
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
    scanFollow();
    for (const e of buttons.values()) {
      const u = SITES.xUsers.get(e.sn.toLowerCase());
      const want = u?.following === true ? 'following' : 'follow';
      if (!e.btn.classList.contains(want) && !e.btn.classList.contains('busy')) render(e);
    }
  }, 1500);
})();
