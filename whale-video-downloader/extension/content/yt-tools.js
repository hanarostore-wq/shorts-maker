// 유튜브 쇼츠: 재생 중인 쇼츠 오른쪽 위에 조회수·구독자 수를 띄운다.
// 유튜브 보기·쇼츠 화면: 오른쪽 아래에 떠 있는 좋아요 버튼(유튜브의 좋아요 단추를 대신 누름).
//   유튜브 페이지와 같은 출처로 /youtubei/v1/next 를 불러 화면에 쓰인 글자(예: 조회수 12만회, 구독자 3.4만명)를 그대로 보여 준다.
(() => {
  if (window.top !== window || window.__smdYtTools) return;
  window.__smdYtTools = true;

  let on = true;
  let likeOn = true;
  const effOf = (s, site) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) }); // 사이트별로 바꾼 값이 우선
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  chrome.storage.local.get('settings').then((r) => {
    on = effOf(r.settings, 'youtube').ytShortsStats !== false;
    likeOn = effOf(r.settings, 'youtube').ytLikeFloat !== false;
    tick();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      on = effOf(c.settings.newValue, 'youtube').ytShortsStats !== false;
      likeOn = effOf(c.settings.newValue, 'youtube').ytLikeFloat !== false;
      tick();
    }
  });

  // ── 통계 읽기 ──
  const cache = new Map(); // videoId -> Promise<{views, subs} | {error}>
  const textOf = (t) => (!t ? '' : typeof t === 'string' ? t : t.simpleText || t.content || (t.runs || []).map((r) => r.text).join('') || '');
  function findKey(o, key, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 40) return undefined;
    if (key in o) return o[key];
    for (const v of Object.values(o)) {
      const r = findKey(v, key, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  function pickStats(j) {
    const vr = findKey(j, 'videoViewCountRenderer');
    const views = textOf(vr?.viewCount) || textOf(vr?.shortViewCount) || textOf(findKey(j, 'viewCountText')) || '';
    const subs = textOf(findKey(j, 'subscriberCountText')) || '';
    return { views, subs };
  }
  async function loadStats(id) {
    let res;
    try {
      res = await fetch('/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: id, context: { client: { clientName: 'WEB', clientVersion: '2.20250925.01.00', hl: 'ko', gl: 'KR' } } }),
      });
    } catch (err) {
      return { error: `유튜브 서버에 연결하지 못했습니다 (${err?.message || err})`, action: '인터넷 연결 확인 후 새로고침' };
    }
    if (!res.ok) return { error: `유튜브가 HTTP ${res.status} 로 응답했습니다`, action: '페이지 새로고침' };
    let j;
    try {
      j = await res.json();
    } catch {
      return { error: '유튜브 응답을 읽지 못했습니다(형식이 바뀜)', action: '확장프로그램 업데이트 확인' };
    }
    const s = pickStats(j);
    if (!s.views && !s.subs) return { error: '응답에 조회수·구독자 정보가 없습니다', action: '잠시 후 새로고침' };
    return s;
  }
  const stats = (id) => {
    if (!cache.has(id)) {
      const p = loadStats(id);
      cache.set(id, p);
      // 실패는 30초 뒤 다시 시도할 수 있게
      p.then((r) => r.error && setTimeout(() => cache.get(id) === p && cache.delete(id), 30000));
    }
    return cache.get(id);
  };

  // ── 화면 ──
  let host = null;
  let box = null;
  let shownId = '';
  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement('smd-ytstats');
    host.setAttribute('style', 'all:initial;position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:none');
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      .b{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font:700 13px/1.25 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;color:#fff}
      .r{padding:4px 9px;border-radius:999px;background:rgba(10,10,18,.62);backdrop-filter:blur(6px);white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.35)}
      .e{max-width:220px;white-space:normal;text-align:right;background:rgba(150,20,40,.75);font-weight:600;font-size:11.5px}
    </style><div class="b"></div>`;
    box = sh.querySelector('.b');
    document.documentElement.appendChild(host);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function activePlayer() {
    const cands = [
      document.querySelector('ytd-reel-video-renderer[is-active] #player-container'),
      document.querySelector('ytd-reel-video-renderer[is-active] video'),
      document.querySelector('#shorts-player'),
      ...document.querySelectorAll('ytd-shorts video, #shorts-container video'),
    ].filter(Boolean);
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width > 80 && r.height > 80 && r.bottom > 0 && r.top < innerHeight) return r;
    }
    return null;
  }

  async function tick() {
    if (!alive()) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
    if (!on || !m) {
      if (host) host.style.display = 'none';
      shownId = '';
      return;
    }
    const r = activePlayer();
    ensure();
    if (!r) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'block';
    // 쇼츠 오른쪽 위의 유튜브 버튼(음량·더보기)과 겹치지 않게 그 아래에 놓는다
    host.style.left = `${Math.round(r.right - 12)}px`;
    host.style.top = `${Math.round(r.top + Math.min(72, r.height * 0.1))}px`;
    host.style.transform = 'translateX(-100%)';
    const id = m[1];
    if (shownId === id) return;
    shownId = id;
    box.innerHTML = '<div class="r">조회수 불러오는 중…</div>';
    const s = await stats(id);
    if (shownId !== id) return;
    box.innerHTML = s.error
      ? `<div class="r e">조회수·구독자 불러오기 실패: ${esc(s.error)} → ${esc(s.action)}</div>`
      : `${s.views ? `<div class="r" data-k="views">👁 ${esc(s.views)}</div>` : ''}${s.subs ? `<div class="r" data-k="subs">👤 ${esc(s.subs)}</div>` : ''}`;
    if (s.error) setTimeout(() => shownId === id && (shownId = ''), 30000);
  }

  // ── 좋아요 플로팅 버튼 ──
  const LIKE_SEL = {
    shorts: ['ytd-reel-video-renderer[is-active] like-button-view-model button', 'ytd-reel-video-renderer[is-active] #like-button button', 'ytd-shorts like-button-view-model button', '#shorts-player ~ * like-button-view-model button'],
    watch: ['ytd-watch-metadata like-button-view-model button', '#top-level-buttons-computed like-button-view-model button', 'ytd-segmented-like-dislike-button-renderer #segmented-like-button button', '#segmented-like-button button', 'ytd-menu-renderer like-button-view-model button'],
  };
  const visibleBtn = (b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  function ytLikeButton() {
    const kind = /^\/shorts\//.test(location.pathname) ? 'shorts' : location.pathname === '/watch' ? 'watch' : '';
    if (!kind) return null;
    for (const sel of LIKE_SEL[kind]) {
      const list = [...document.querySelectorAll(sel)];
      const b = list.find(visibleBtn) || list[0];
      if (b) return b;
    }
    return null;
  }
  let likeHost = null;
  let likeUi = null;
  function ensureLike() {
    if (likeHost?.isConnected) return;
    likeHost = document.createElement('smd-ytlike');
    likeHost.setAttribute('style', 'all:initial;position:fixed;right:22px;bottom:96px;z-index:2147483646;display:none');
    const sh = likeHost.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      .w{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font:700 12px/1.3 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif}
      button{all:unset;cursor:pointer;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,30,.82);box-shadow:0 6px 18px rgba(0,0,0,.4);transition:transform .12s,background .15s}
      button:hover{transform:scale(1.06)}
      button.on{background:linear-gradient(135deg,#ff3d6e,#ff7a3d)}
      svg{width:26px;height:26px}
      .msg{max-width:260px;padding:6px 10px;border-radius:10px;background:rgba(150,20,40,.95);color:#fff;white-space:pre-line}
      .msg:empty{display:none}
    </style><div class="w"><div class="msg"></div><button type="button" title="좋아요"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21h3V9H2v12zm19.4-9.6c.4-.5.6-1.1.6-1.7 0-1.5-1.2-2.7-2.7-2.7h-5l.8-3.8v-.3c0-.5-.2-.9-.5-1.3L13.4.5 7.6 6.3c-.4.4-.6.9-.6 1.4V19c0 1.1.9 2 2 2h8.5c.8 0 1.5-.5 1.8-1.2l2.8-6.5c.1-.3.2-.6.2-.9v-1z"/></svg></button></div>`;
    likeUi = { btn: sh.querySelector('button'), msg: sh.querySelector('.msg') };
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick']) likeHost.addEventListener(t, (ev) => ev.stopPropagation());
    likeUi.btn.addEventListener('click', () => {
      const b = ytLikeButton();
      if (!b) {
        likeUi.msg.textContent = '좋아요 실패\n단계: 좋아요 단추 찾기\n원인: 이 화면에서 유튜브 좋아요 단추를 찾지 못했습니다\n조치: 영상이 다 뜬 뒤 다시 누르거나 새로고침(F5)하세요.';
        setTimeout(() => likeUi && (likeUi.msg.textContent = ''), 8000);
        return;
      }
      const before = b.getAttribute('aria-pressed');
      b.click();
      setTimeout(() => {
        const after = b.isConnected ? b.getAttribute('aria-pressed') : null;
        if (before !== null && after === before) {
          likeUi.msg.textContent = '좋아요 실패\n단계: 좋아요 누르기\n원인: 눌렀지만 좋아요 상태가 바뀌지 않았습니다(로그인이 필요할 수 있음)\n조치: 유튜브에 로그인했는지 확인하고, 영상 아래 좋아요를 직접 눌러 보세요.';
          setTimeout(() => likeUi && (likeUi.msg.textContent = ''), 8000);
        }
        likeTick();
      }, 700);
    });
    document.documentElement.appendChild(likeHost);
  }
  function likeTick() {
    const page = /^\/shorts\//.test(location.pathname) || location.pathname === '/watch';
    if (!likeOn || !page) {
      if (likeHost) likeHost.style.display = 'none';
      return;
    }
    ensureLike();
    likeHost.style.display = 'block';
    const b = ytLikeButton();
    const pressed = b?.getAttribute('aria-pressed') === 'true';
    likeUi.btn.classList.toggle('on', pressed);
    likeUi.btn.title = pressed ? '좋아요 누름 · 누르면 취소' : '좋아요';
  }
  setInterval(() => alive() && likeTick(), 700);

  setInterval(tick, 400);
  addEventListener('yt-navigate-finish', tick);
  addEventListener('resize', tick);
  addEventListener('scroll', tick, { passive: true, capture: true });
})();
