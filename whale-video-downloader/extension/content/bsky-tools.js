// 블루스카이 전용 도구 (ISOLATED world)
//  - 홈·탐색 피드 게시물 오른쪽 위에 팔로우 / 팔로잉 버튼 (눌러서 팔로우·언팔로우)
(() => {
  'use strict';
  if (globalThis.__SMD_BSKYTOOLS || !/(^|\.)bsky\.app$/.test(location.hostname) || window.top !== window) return;
  globalThis.__SMD_BSKYTOOLS = true;

  let followOn = true;
  const effOf = (s, site) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) }); // 사이트별로 바꾼 값이 우선
  chrome.storage.local.get('settings').then((r) => {
    followOn = effOf(r.settings, 'bluesky').bskyFollowButtons !== false;
    scanFollow();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      followOn = effOf(c.settings.newValue, 'bluesky').bskyFollowButtons !== false;
      if (!followOn) {
        document.querySelectorAll('smd-bfollow').forEach((e) => e.remove());
        items.clear();
      } else scanFollow();
    }
  });

  // ───────────── 팔로우 버튼 ─────────────
  // 로그인 정보: 블루스카이가 localStorage(BSKY_STORAGE)에 두는 현재 계정. 토큰은 요청 헤더에만 쓰고 어디에도 남기지 않는다.
  // 블루스카이 앱이 방금 보낸 요청의 로그인 토큰(앱이 스스로 새로 고친 최신 값). bsky-hook.js(페이지 쪽)가 알려 준다.
  //   localStorage 의 토큰은 만료된 채 남아 있을 수 있어, 있으면 이것을 먼저 쓴다. 토큰은 메모리에만 두고 어디에도 남기지 않는다.
  let live = null; // { jwt, pds }
  document.addEventListener('__smd_bsky_auth', (ev) => {
    try {
      const d = JSON.parse(ev.detail);
      if (/^Bearer\s+\S+/.test(d.auth || '') && /^https:\/\//.test(d.base || '')) live = { jwt: d.auth.replace(/^Bearer\s+/, ''), pds: d.base };
    } catch {}
  });
  const didOf = (jwt) => {
    try {
      return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || '';
    } catch {
      return '';
    }
  };
  function session() {
    let base = null;
    try {
      const st = JSON.parse(localStorage.getItem('BSKY_STORAGE') || '{}');
      const a = st.session?.currentAccount;
      const full = (st.session?.accounts || []).find((x) => x.did === a?.did) || a;
      if (full?.did) base = { did: full.did, handle: String(full.handle || '').toLowerCase(), jwt: full.accessJwt || '', pds: String(full.pdsUrl || full.service || 'https://bsky.social').replace(/\/+$/, '') };
    } catch {}
    if (live && (!base || didOf(live.jwt) === base.did || !didOf(live.jwt))) {
      // 앱 요청이 앱뷰(api.bsky.app)로 간 경우에는 주소는 저장된 PDS 를 쓴다
      const pds = /api\.bsky\.app|public\.api/.test(live.pds) ? base?.pds || 'https://bsky.social' : live.pds;
      return { did: base?.did || didOf(live.jwt), handle: base?.handle || '', jwt: live.jwt, pds };
    }
    return base?.jwt ? base : null;
  }
  const APPVIEW = 'did:web:api.bsky.app#bsky_appview';
  async function xrpc(s, method, nsid, { params, body, proxy } = {}) {
    const q = params ? `?${params}` : '';
    const headers = { authorization: `Bearer ${s.jwt}` };
    if (proxy) headers['atproto-proxy'] = APPVIEW;
    if (body) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${s.pds}/xrpc/${nsid}${q}`, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' });
    } catch (err) {
      throw { reason: `블루스카이 서버에 연결하지 못했습니다 (${err?.message || err})`, action: '인터넷 연결을 확인한 뒤 다시 누르세요.' };
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const expired = res.status === 401 || /Expired|InvalidToken|AuthMissing/i.test(j.error || '');
      throw {
        status: res.status,
        expired,
        reason: expired ? `로그인 정보가 만료됐습니다 (HTTP ${res.status} ${j.error || ''})` : `블루스카이가 HTTP ${res.status} ${j.error || ''} 로 응답했습니다`,
        action: expired ? '페이지를 새로고침(F5)한 뒤 다시 누르세요.' : res.status === 429 ? '너무 자주 눌렀습니다. 잠시 후 다시 시도하세요.' : '잠시 후 다시 시도하세요.',
      };
    }
    return j;
  }

  const users = new Map(); // handle -> { did, following(uri|null) }
  const items = new Map(); // element -> { host, btn, handle }
  const pending = new Set();
  let loadTimer = 0;
  const FCSS = `
    :host{all:initial;position:absolute;top:10px;right:12px;z-index:5;display:inline-flex;align-items:center;gap:6px}
    button{all:unset;cursor:pointer;display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:999px;
      font:700 12px/1 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;white-space:nowrap}
    button.follow{color:#fff;background:linear-gradient(135deg,#0a7aff,#5b5cff)}
    button.follow.unknown{opacity:.8}
    button.following{color:#9aa4b2;border:1px solid rgba(128,128,140,.55);height:20px}
    button.following:hover{color:#f4212e;border-color:rgba(244,33,46,.6);background:rgba(244,33,46,.08)}
    button.busy{opacity:.6;pointer-events:none}
    .err{max-width:260px;padding:4px 8px;border-radius:8px;background:rgba(150,20,40,.92);color:#fff;font:600 11px/1.35 "Malgun Gothic",system-ui,sans-serif}
  `;
  function render(e) {
    const u = users.get(e.handle);
    const b = e.btn;
    b.classList.remove('follow', 'following', 'unknown');
    if (u?.following) {
      b.classList.add('following');
      b.textContent = '팔로잉';
      b.title = `@${e.handle} 님을 팔로우 중입니다 · 누르면 팔로우 취소`;
    } else {
      b.classList.add('follow');
      if (!u) b.classList.add('unknown');
      b.textContent = '팔로우';
      b.title = u ? `@${e.handle} 님을 팔로우하지 않았습니다 · 누르면 팔로우` : '팔로우 상태를 확인하는 중입니다';
    }
  }
  const renderAll = (h) => {
    for (const e of items.values()) if (!h || e.handle === h) render(e);
  };
  function showErr(e, step, err) {
    e.err?.remove();
    const s = document.createElement('span');
    s.className = 'err';
    s.textContent = `${step} 실패: ${err.reason || err.message || err} → ${err.action || '페이지를 새로고침한 뒤 다시 시도하세요.'}`;
    e.btn.before(s);
    e.err = s;
    setTimeout(() => s.remove(), 9000);
  }
  async function loadStates() {
    loadTimer = 0;
    const s = session();
    if (!s || !pending.size) return;
    const list = [...pending].slice(0, 25);
    list.forEach((h) => pending.delete(h));
    try {
      const j = await xrpc(s, 'GET', 'app.bsky.actor.getProfiles', { params: list.map((h) => `actors=${encodeURIComponent(h)}`).join('&'), proxy: true });
      for (const p of j.profiles || []) users.set(String(p.handle).toLowerCase(), { did: p.did, following: p.viewer?.following || null });
      for (const h of list) if (!users.has(h)) users.set(h, { did: '', following: null });
      list.forEach(renderAll);
    } catch (err) {
      for (const e of items.values()) if (list.includes(e.handle)) showErr(e, '팔로우 상태 확인', err);
    }
    if (pending.size) loadTimer = setTimeout(loadStates, 300);
  }
  async function toggle(e, onlyFollow = false) {
    const s = session();
    if (!s) {
      const err = { reason: '블루스카이 로그인 정보를 찾지 못했습니다', action: '블루스카이에 로그인한 뒤 새로고침하세요.' };
      showErr(e, '팔로우', err);
      return { error: { step: '로그인 확인', ...err } };
    }
    let u = users.get(e.handle);
    if (onlyFollow && u?.following) return { already: true }; // 자동 팔로우: 이미 팔로우 중이면 그대로
    const unfollow = !!u?.following;
    if (unfollow && !window.confirm(`@${e.handle} 님 팔로우를 취소할까요?`)) return { canceled: true };
    e.btn.classList.add('busy');
    try {
      if (!u?.did) {
        const j = await xrpc(s, 'GET', 'app.bsky.actor.getProfiles', { params: `actors=${encodeURIComponent(e.handle)}`, proxy: true });
        const p = j.profiles?.[0];
        if (!p?.did) throw { reason: `@${e.handle} 계정 정보를 찾지 못했습니다`, action: '페이지를 새로고침한 뒤 다시 누르세요.' };
        u = { did: p.did, following: p.viewer?.following || null };
        users.set(e.handle, u);
        // 자동 팔로우: 확인해 보니 이미 팔로우 중이면 아무것도 하지 않는다
        if (onlyFollow && u.following) {
          renderAll(e.handle);
          return { already: true };
        }
      }
      if (unfollow) {
        const rkey = String(u.following).split('/').pop();
        await xrpc(s, 'POST', 'com.atproto.repo.deleteRecord', { body: { repo: s.did, collection: 'app.bsky.graph.follow', rkey } });
        users.set(e.handle, { did: u.did, following: null });
      } else {
        const j = await xrpc(s, 'POST', 'com.atproto.repo.createRecord', { body: { repo: s.did, collection: 'app.bsky.graph.follow', record: { $type: 'app.bsky.graph.follow', subject: u.did, createdAt: new Date().toISOString() } } });
        users.set(e.handle, { did: u.did, following: j.uri || 'yes' });
      }
      renderAll(e.handle);
      return { ok: true };
    } catch (err) {
      showErr(e, unfollow ? '언팔로우' : '팔로우', err);
      return { error: { step: unfollow ? '언팔로우' : '팔로우', ...err } };
    } finally {
      e.btn.classList.remove('busy');
    }
  }
  // 목록 전부 팔로우(follow-all.js)가 같은 로그인·요청 함수와 팔로우 상태를 쓴다
  globalThis.__SMD_BSKY = { session, xrpc, setFollowing: (handle, did, uri) => { users.set(String(handle).toLowerCase(), { did, following: uri }); renderAll(String(handle).toLowerCase()); } };

  // 다운로드 버튼을 누른 게시물의 작성자 자동 팔로우
  document.addEventListener('smd:auto-follow', (ev) => {
    const d = ev.detail;
    if (!d?.el) return;
    d.handled = true;
    const s = session();
    // 게시물 안 → 상세 화면 본 게시물 → 방금 누른 게시물 순(사진 크게 보기 창 대비)
    const item = d.el.closest('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]') || globalThis.__SMD_SITES?.bskyItemOf?.(d.el) || null;
    const handle = (item?.dataset.testid.replace(/^(feedItem|postThreadItem)-by-/, '') || /^\/profile\/([^/]+)\/post\//.exec(location.pathname)?.[1] || '').toLowerCase();
    if (!s) return d.report?.({ error: { step: '로그인 확인', reason: '블루스카이 로그인 정보를 찾지 못했습니다', action: '블루스카이에 로그인한 뒤 새로고침하세요.' } });
    if (!handle) return d.report?.({ error: { step: '작성자 찾기', reason: '누른 사진·영상의 게시물 작성자를 찾지 못했습니다', action: '게시물을 눌러 연 화면에서 다시 다운로드하거나 작성자 프로필에서 직접 팔로우하세요.' } });
    if (handle === s.handle || handle === s.did) return;
    const e = (item && items.get(item)) || { handle, btn: document.createElement('button') };
    (async () => {
      let r = await toggle(e, true);
      // 로그인 토큰이 막 만료된 경우: 블루스카이가 새 토큰으로 바꿀 시간을 주고 한 번 더
      if (r?.error && /만료/.test(r.error.reason || '')) {
        await new Promise((ok) => setTimeout(ok, 2500));
        r = await toggle(e, true);
      }
      d.report?.({ ...(r || { ok: true }), who: `@${handle}` });
    })();
  });

  function scanFollow() {
    if (!followOn) return;
    const s = session();
    if (!s) return; // 로그인 전에는 버튼을 띄우지 않는다
    for (const el of document.querySelectorAll('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]')) {
      const handle = el.dataset.testid.replace(/^(feedItem|postThreadItem)-by-/, '').toLowerCase();
      if (!handle || handle === s.handle || handle === s.did) continue;
      const cur = items.get(el);
      if (cur && cur.handle === handle && cur.host.isConnected) continue;
      cur?.host.remove();
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      const host = document.createElement('smd-bfollow');
      const sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>${FCSS}</style><button type="button"></button>`;
      const e = { host, btn: sh.querySelector('button'), handle };
      // 버튼 클릭이 게시물 열기로 전달되지 않게
      for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
        host.addEventListener(t, (ev) => {
          ev.stopPropagation();
          if (t === 'click') {
            ev.preventDefault();
            if (ev.composedPath()[0] === e.btn) toggle(e);
          }
        });
      }
      e.btn.addEventListener('mouseenter', () => e.btn.classList.contains('following') && (e.btn.textContent = '언팔로우'));
      e.btn.addEventListener('mouseleave', () => e.btn.classList.contains('following') && (e.btn.textContent = '팔로잉'));
      el.appendChild(host);
      items.set(el, e);
      render(e);
      if (!users.has(handle)) {
        pending.add(handle);
        if (!loadTimer) loadTimer = setTimeout(loadStates, 200);
      }
    }
    for (const [el] of items) if (!el.isConnected) items.delete(el);
  }
  new MutationObserver(() => {
    clearTimeout(scanFollow.t);
    scanFollow.t = setTimeout(scanFollow, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // (영상 소리 자동 켜기는 사용자 요청으로 삭제)
})();
