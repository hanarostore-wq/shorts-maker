// 떠 있는 좋아요·팔로우 버튼 (모든 사이트, 화면 오른쪽 아래)
//  - 지금 화면 가운데에 가장 크게 보이는 영상·사진(= 보고 있는 게시물)을 기준으로
//    좋아요: 그 게시물의 사이트 좋아요 단추를 대신 누르고, 눌린 상태로 바뀌었는지 확인한다(안 바뀌면 단계·원인·조치 표시)
//    팔로우: 다운로드 자동 팔로우와 같은 방법(X·블루스카이 전용 처리, 인스타 요청, 화면 팔로우 단추)으로 작성자를 팔로우
//  - 팝업 '이 사이트'에서 사이트마다 켜고 끄기 (ytLikeFloat = 좋아요, followFloat = 팔로우)
(() => {
  'use strict';
  if (globalThis.__SMD_FLOAT || window.top !== window || !globalThis.__SMD_SITES) return;
  globalThis.__SMD_FLOAT = true;
  const site = globalThis.__SMD_SITE_ID || globalThis.__SMD_SITES.pick(location.hostname).id;
  const effOf = (s, id) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[id] || {}) });
  let likeOn = true;
  let followOn = true;
  let siteOff = false;
  const apply = (s) => {
    const e = effOf(s, site);
    likeOn = e.ytLikeFloat !== false;
    followOn = e.followFloat !== false;
    siteOff = (e.disabledSites || []).includes(site) || (site === 'generic' && e.genericButtons === false);
  };
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  chrome.storage.local.get('settings').then((r) => apply(r.settings), () => {});
  chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.settings && apply(c.settings.newValue));

  // ── 지금 보고 있는 영상·사진 ──
  const ours = (el) => !!el.closest('smd-anchor, smd-float, smd-followall, smd-toast, smd-seek, smd-ytstats');
  function currentMedia() {
    let best = null;
    let bestScore = 0;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    for (const el of document.querySelectorAll('video, img')) {
      if (ours(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 120) continue;
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      // 보이는 넓이 × 화면 가운데와 가까울수록 · 영상 우선
      const d = Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy) / Math.hypot(cx, cy);
      const score = w * h * (1.2 - Math.min(1, d)) * (el.tagName === 'VIDEO' ? 1.5 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  // ── 좋아요 단추 찾기 ──
  const LIKE_SEL = {
    youtube: ['ytd-reel-video-renderer[is-active] like-button-view-model button', 'ytd-reel-video-renderer[is-active] #like-button button', 'ytd-shorts like-button-view-model button', 'ytd-watch-metadata like-button-view-model button', '#top-level-buttons-computed like-button-view-model button', 'ytd-segmented-like-dislike-button-renderer #segmented-like-button button', '#segmented-like-button button'],
    x: ['[data-testid="like"]', '[data-testid="unlike"]'],
    bluesky: ['[data-testid="likeBtn"]'],
    tiktok: ['[data-e2e="like-icon"]', '[data-e2e="browse-like-icon"]', '[data-e2e="video-player-digg"]'],
    douyin: ['[data-e2e="video-player-digg"]', '[data-e2e="feed-like"]'],
    xiaohongshu: ['.engage-bar .like-wrapper', '.interactions .like-wrapper', '.like-wrapper'],
    bilibili: ['.video-like', '.video-toolbar-left .like'],
    weibo: ['button[title*="赞"]', '.woo-like-main'],
    kuaishou: ['.like-icon', '[class*="like-item"]'],
    pinterest: ['[data-test-id="react-button"] button', 'button[aria-label*="react" i]'],
    facebook: ['[aria-label="좋아요"][role="button"]', '[aria-label="Like"][role="button"]', '[aria-label="좋아요 취소"][role="button"]', '[aria-label="Remove Like"][role="button"]'],
  };
  // 사이트 공용: 이름(aria-label·title·data-testid·data-e2e)이 좋아요인 단추·아이콘
  const GENERIC_SEL = 'button[aria-label], [role="button"][aria-label], button[title], [role="button"][title], svg[aria-label], [data-testid*="like" i], [data-e2e*="like" i]';
  const LIKE_RE = /^(like|likes?btn|like-icon|browse-like-icon|좋아요|赞|點讚|点赞|いいね|me gusta|j['’]aime|gefällt mir|curtir|mi piace|beğen)/i;
  const UNLIKE_RE = /^(unlike|remove like|좋아요 취소|取消(点)?赞|已赞|いいねを取り消す|ya no me gusta|je n['’]aime plus|gefällt mir nicht mehr)/i;
  const NOT_LIKE = /dislike|싫어요|踩|좋아요 표시한 사람|liked by|likes list|좋아요한 사람/i;
  const COMMENT_RE = /comment|reply|replies|댓글|답글|评论|評論|コメント/i;
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-testid') || el.getAttribute('data-e2e') || '').trim();
  const asButton = (el) => el.closest('button, [role="button"], a[role="link"][aria-label]') || el;
  const inComment = (el) => {
    for (let p = el, i = 0; p && i < 8; p = p.parentElement, i++) {
      const tag = `${p.id || ''} ${typeof p.className === 'string' ? p.className : ''} ${p.getAttribute?.('data-e2e') || ''}`;
      if (COMMENT_RE.test(tag)) return true;
    }
    return false;
  };
  const shown = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  function likeCands(root) {
    const out = new Set();
    for (const sel of LIKE_SEL[site] || []) for (const e of root.querySelectorAll(sel)) out.add(asButton(e));
    for (const e of root.querySelectorAll(GENERIC_SEL)) {
      const n = nameOf(e);
      if (!n || NOT_LIKE.test(n) || !(LIKE_RE.test(n) || UNLIKE_RE.test(n))) continue;
      out.add(asButton(e));
    }
    return [...out].filter((b) => shown(b) && !ours(b) && !inComment(b));
  }
  // 게시물 안 좋아요(가장 가까운 묶음부터) → 없으면 화면 전체에서 사진·영상과 가장 가까운 것(유튜브 보기·틱톡 상세처럼 떨어져 있는 경우)
  // 찾은 좋아요 단추를 잠깐 기억(같은 게시물이면 2.5초 동안 다시 찾지 않음 — 페이지를 느리게 하지 않게)
  let likeCache = { media: null, btn: null, t: 0 };
  function likeButtonCached(media) {
    const now = performance.now();
    if (likeCache.media === media && now - likeCache.t < 2500 && (!likeCache.btn || likeCache.btn.isConnected)) return likeCache.btn;
    const btn = likeButtonFor(media);
    likeCache = { media, btn, t: now };
    return btn;
  }
  function likeButtonFor(media) {
    // 유튜브: 좋아요 자리가 정해져 있어 바로 찾는다(넓은 범위를 뒤지지 않음)
    if (site === 'youtube') {
      for (const sel of LIKE_SEL.youtube) {
        const b = [...document.querySelectorAll(sel)].find(shown);
        if (b) return b;
      }
      return null;
    }
    const mr = media.getBoundingClientRect();
    const dist = (b) => {
      const r = b.getBoundingClientRect();
      return Math.hypot(Math.max(0, r.left - mr.right, mr.left - r.right), Math.max(0, r.top - mr.bottom, mr.top - r.bottom));
    };
    const choose = (list) => {
      if (!list.length) return null;
      // 댓글 하트처럼 작은 아이콘보다 게시물 좋아요(큰 것)를 고른다
      const area = (b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height;
      const max = Math.max(...list.map(area));
      return list.filter((b) => area(b) >= max * 0.5).sort((a, b) => dist(a) - dist(b))[0];
    };
    for (let p = media.parentElement, i = 0; p && p !== document.documentElement && i < 25; p = p.parentElement, i++) {
      if (p.getBoundingClientRect().height > Math.max(innerHeight * 2.5, mr.height * 4)) break;
      const c = likeCands(p);
      if (c.length) return choose(c);
    }
    return choose(likeCands(document).filter((b) => dist(b) < innerHeight * 0.8));
  }
  // 눌린 상태: true = 좋아요 누름, false = 안 누름, null = 알 수 없음
  function liked(b) {
    if (!b?.isConnected) return null;
    const ap = b.getAttribute('aria-pressed');
    if (ap === 'true' || ap === 'false') return ap === 'true';
    for (const e of [b, ...b.querySelectorAll('[aria-label], [data-testid], [title]')]) {
      const n = nameOf(e);
      if (!n) continue;
      if (UNLIKE_RE.test(n)) return true;
      if (LIKE_RE.test(n)) return false;
    }
    for (const e of [b, ...b.querySelectorAll('*')].slice(0, 30)) {
      const c = typeof e.className === 'string' ? e.className : e.className?.baseVal || '';
      if (/(^|[\s_-])(liked|is-liked|active|selected|on)($|[\s_-])/i.test(c)) return true;
    }
    return null;
  }

  // ── 팔로우가 되는 게시물인가 ──
  const FOLLOW_TEXT = /^(\+\s*)?(팔로우|팔로우하기|follow|follow back|구독|구독하기|subscribe|关注|關注|加关注|フォロー|seguir|suivre|abonnieren)$/i;
  let folCache = { media: null, v: false, t: 0 };
  function followable(media) {
    if (site !== 'generic') return true;
    if (folCache.media === media && performance.now() - folCache.t < 2500) return folCache.v;
    const v = followableNow(media);
    folCache = { media, v, t: performance.now() };
    return v;
  }
  function followableNow(media) {
    for (let p = media.parentElement, i = 0; p && i < 15; p = p.parentElement, i++) {
      if (p.getBoundingClientRect().height > innerHeight * 2.5) break;
      if ([...p.querySelectorAll('button, [role="button"]')].some((b) => FOLLOW_TEXT.test((b.innerText || '').trim()))) return true;
    }
    return false;
  }

  // ── 화면 ──
  let host = null;
  let ui = null;
  let target = null; // { media, like }
  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement('smd-float');
    host.setAttribute('style', 'all:initial;position:fixed;right:18px;bottom:110px;z-index:2147483646;display:none');
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      .w{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:700 12px/1.35 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif}
      button{all:unset;cursor:pointer;width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,30,.82);box-shadow:0 6px 18px rgba(0,0,0,.4);transition:transform .12s,background .15s}
      button:hover{transform:scale(1.07)}
      button[hidden]{display:none}
      .like.on{background:linear-gradient(135deg,#ff3d6e,#ff7a3d)}
      .follow{background:rgba(10,90,220,.88)}
      svg{width:25px;height:25px}
      .msg{max-width:280px;padding:7px 11px;border-radius:10px;background:rgba(20,20,30,.94);color:#fff;white-space:pre-line;box-shadow:0 4px 14px rgba(0,0,0,.35)}
      .msg.err{background:rgba(150,20,40,.95)}
      .msg:empty{display:none}
    </style><div class="w"><div class="msg"></div>
      <button type="button" class="follow" title="이 게시물 작성자 팔로우"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zM6 10V7H4v3H1v2h3v3h2v-3h3v-2H6z"/></svg></button>
      <button type="button" class="like" title="좋아요"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.4l-1.5-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.5 11.6L12 21.4z"/></svg></button>
    </div>`;
    ui = { like: sh.querySelector('.like'), follow: sh.querySelector('.follow'), msg: sh.querySelector('.msg') };
    // 사이트로 클릭이 전달되지 않게(영상 멈춤·게시물 열기 방지)
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick', 'touchstart', 'touchend']) host.addEventListener(t, (ev) => ev.stopPropagation());
    ui.like.addEventListener('click', onLike);
    ui.follow.addEventListener('click', onFollow);
    document.documentElement.appendChild(host);
    globalThis.__SMD_DRAG?.(host, 'float'); // 끌어서 옮기기(사이트마다 위치 기억)
  }
  let msgTimer = 0;
  function say(text, err = false, ms = 8000) {
    ui.msg.textContent = text;
    ui.msg.classList.toggle('err', err);
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => ui && (ui.msg.textContent = ''), ms);
  }
  const DEAD = '단계: 확장프로그램 연결 확인\n원인: 확장프로그램이 업데이트(또는 다시 시작)되어 이 페이지와 연결이 끊겼습니다\n조치: 페이지를 새로고침(F5)한 뒤 다시 누르세요.';

  function onLike() {
    if (!alive()) return say(`좋아요 실패\n${DEAD}`, true);
    const ytPage = site === 'youtube' && (/^\/shorts\//.test(location.pathname) || location.pathname === '/watch');
    const media = (target?.media?.isConnected ? target.media : currentMedia()) || (ytPage ? document.body : null);
    if (!media) return say('좋아요 실패\n단계: 게시물 찾기\n원인: 화면에 보고 있는 영상·사진이 없습니다\n조치: 좋아요할 게시물이 화면 가운데에 오게 스크롤한 뒤 다시 누르세요.', true);
    const b = likeButtonFor(media);
    if (!b) return say('좋아요 실패\n단계: 좋아요 단추 찾기\n원인: 이 게시물 근처에서 사이트의 좋아요 단추를 찾지 못했습니다\n조치: 게시물을 눌러 연 화면에서 다시 누르거나, 사이트의 좋아요를 직접 누르세요.', true);
    const before = liked(b);
    b.click();
    setTimeout(() => {
      const nb = b.isConnected ? b : likeButtonFor(media);
      const after = liked(nb);
      if (before !== null && after === before) {
        say('좋아요 실패\n단계: 좋아요 누르기\n원인: 눌렀지만 좋아요 상태가 바뀌지 않았습니다(로그인이 필요하거나 사이트가 막음)\n조치: 사이트에 로그인했는지 확인하고, 게시물의 좋아요를 직접 눌러 보세요.', true);
      } else if (after === null) {
        say('좋아요 단추를 눌렀습니다\n(이 사이트는 눌린 상태를 확인할 수 없어 화면에서 직접 확인해 주세요)', false, 4000);
      } else {
        say(after ? '좋아요 했습니다' : '좋아요를 취소했습니다', false, 2500);
      }
      tick();
    }, 900);
  }
  function onFollow() {
    if (!alive()) return say(`팔로우 실패\n${DEAD}`, true);
    const media = target?.media?.isConnected ? target.media : currentMedia();
    if (!media) return say('팔로우 실패\n단계: 게시물 찾기\n원인: 화면에 보고 있는 영상·사진이 없습니다\n조치: 팔로우할 사람의 게시물이 화면 가운데에 오게 스크롤한 뒤 다시 누르세요.', true);
    if (typeof globalThis.__SMD_FOLLOW_NOW !== 'function') return say('팔로우 실패\n단계: 팔로우 기능 준비\n원인: 이 페이지에서 다운로드 기능(core)이 아직 준비되지 않았습니다\n조치: 페이지를 새로고침(F5)한 뒤 다시 누르세요.', true);
    say('팔로우하는 중… (결과는 화면 아래에 표시)', false, 3000);
    globalThis.__SMD_FOLLOW_NOW(media);
  }

  function tick() {
    if (document.hidden) return;
    if (!alive()) {
      host?.remove();
      return;
    }
    const want = !siteOff && (likeOn || followOn);
    const media = want ? currentMedia() : null;
    // 유튜브 보기·쇼츠 화면은 좋아요 단추를 늦게 그려도 버튼을 띄워 둔다(누르면 원인 안내)
    const ytPage = site === 'youtube' && (/^\/shorts\//.test(location.pathname) || location.pathname === '/watch');
    const like = likeOn && want ? (media ? likeButtonCached(media) : ytPage ? likeButtonCached(document.body) : null) : null;
    const canFollow = !!media && followOn && followable(media);
    const showLike = likeOn && !siteOff && (!!like || ytPage);
    if (!showLike && !canFollow) {
      if (host) host.style.display = 'none';
      target = null;
      return;
    }
    ensure();
    target = { media, like };
    // 전체 화면에서도 보이게(전체 화면 요소 안으로 옮김)
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' && fs !== document.documentElement ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    host.style.display = 'block';
    ui.like.hidden = !showLike;
    ui.follow.hidden = !canFollow;
    const on = liked(like) === true;
    ui.like.classList.toggle('on', on);
    ui.like.title = on ? '좋아요 누름 · 누르면 취소' : '좋아요';
  }
  setInterval(tick, 1000);
  // 스크롤 중에는 멈췄을 때 한 번만
  let scrollT = 0;
  addEventListener('scroll', () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(tick, 200);
  }, { passive: true, capture: true });
})();
