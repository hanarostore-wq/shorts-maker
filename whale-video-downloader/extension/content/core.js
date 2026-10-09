// 화면의 모든 <video> 하단에 다운로드 버튼을 띄우고, 클릭 시 서비스워커에 다운로드를 요청한다.
(() => {
  'use strict';
  if (globalThis.__SMD_CORE) return;
  globalThis.__SMD_CORE = true;
  const SITES = globalThis.__SMD_SITES;
  if (!SITES || !chrome?.runtime?.id) return;
  const { pick, U } = SITES;
  const adapter = pick(location.hostname);

  const DEFAULTS = { showButtons: true, imageButtons: true, buttonPosition: 'mid-right', placements: {}, imagePlacements: {}, disabledSites: [], genericButtons: true };
  let settings = { ...DEFAULTS };
  const effOf = (s, site) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) }); // 사이트별로 바꾼 값이 우선
  const enabled = () =>
    settings.showButtons !== false &&
    !(settings.disabledSites || []).includes(adapter.id) &&
    (adapter.id !== 'generic' || settings.genericButtons !== false);

  // 자동재생 끄기·팟플레이어(no-autoplay.js, 페이지 쪽)에 이 사이트 설정 전달
  const syncAutoplay = () => {
    if (window.top !== window && adapter.id === 'generic') return;
    document.documentElement.dataset.smdNoautoplay = settings.noAutoplay === true ? '1' : '0';
    document.documentElement.dataset.smdPotplayer = settings.potPlayer === true ? '1' : '0';
  };
  // 재생 버튼을 누른 영상 → 원본 주소를 찾아 팟플레이어로(결과·실패는 화면 아래 알림)
  document.addEventListener('__smd_potplay', async (ev) => {
    // 표시 값은 no-autoplay.js 가 붙인 'p숫자' 뿐(이 파일의 CSS 는 버튼 스타일 글자라 CSS.escape 를 쓰지 않는다)
    const tok = String(ev.detail || '');
    if (!/^p\d+$/.test(tok)) return;
    const v = document.querySelector(`video[data-smd-pot="${tok}"]`);
    if (!v || !alive()) return;
    const note = (r) => globalThis.__SMD_FOLLOW_TOAST?.(r);
    const toast = (text, err) => note(err ? { error: err } : { custom: text });
    toast('팟플레이어로 여는 중…');
    let req;
    try {
      req = await adapter.resolve(v, ctx);
    } catch (err) {
      return toast('', { step: '영상 정보 찾기', reason: err.reason || err.message || String(err), action: err.action || '페이지를 새로고침한 뒤 다시 누르세요.' });
    }
    Object.assign(req, { site: adapter.id, siteName: adapter.name, pageUrl: location.href, kind: 'video', duration: Number.isFinite(v.duration) ? v.duration : 0 });
    const r = await chrome.runtime.sendMessage({ type: 'smd:play-external', request: req }).catch((err) => ({ error: { step: '확장프로그램 연결', reason: String(err?.message || err), action: '페이지를 새로고침(F5)한 뒤 다시 누르세요.' } }));
    if (r?.error) return toast('', r.error);
    if (r?.downloading) return toast('이 사이트는 재생 주소를 바로 넘길 수 없어(로그인 쿠키 필요) 원본을 먼저 받는 중입니다…\n다 받으면 팟플레이어(기본 재생 프로그램)로 엽니다.');
    toast('팟플레이어로 보냈습니다. 웨일이 "외부 프로그램 열기"를 물으면 허용하세요.');
  });
  chrome.storage.local.get('settings').then((r) => {
    settings = effOf({ ...DEFAULTS, ...(r.settings || {}) }, adapter.id);
    syncAutoplay();
  }, () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = effOf({ ...DEFAULTS, ...(changes.settings.newValue || {}) }, adapter.id);
      syncAutoplay();
      }
  });

  // ───────────── MAIN world 브리지 ─────────────
  const ingest = (url, text) => {
    try {
      if (adapter.ingestText) adapter.ingestText(text, url);
      if (adapter.ingest) for (const json of U.parseLoose(text)) adapter.ingest(json, url);
    } catch (err) {
      console.debug('[영상 다운로더] 응답 분석 실패', err);
    }
  };
  document.addEventListener('__smd_cap', (ev) => {
    try {
      const { u, t } = JSON.parse(ev.detail);
      ingest(u, t);
    } catch {}
  });

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
      const id = `${Date.now()}-${++seq}`;
      waiting.set(id, resolve);
      document.dispatchEvent(new CustomEvent('__smd_req', { detail: JSON.stringify({ ...req, id }) }));
      setTimeout(() => {
        if (waiting.delete(id)) resolve({});
      }, timeout);
    });
  let markSeq = 0;
  const ctx = {
    ask,
    globals: (names) => ask({ kind: 'globals', names }),
    mark(video) {
      if (!video.dataset.smdQ) video.dataset.smdQ = `q${++markSeq}${Math.random().toString(36).slice(2, 7)}`;
      return video.dataset.smdQ;
    },
  };
  document.dispatchEvent(new CustomEvent('__smd_ready'));

  const runInit = () => {
    try { adapter.init?.(); } catch (err) { console.debug('[영상 다운로더] 초기 데이터 분석 실패', err); }
  };
  runInit();
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(runInit, 600);
    }
  }, 700);

  // ───────────── 오버레이 UI ─────────────
  const ICON_DL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m6.5 10 5.5 5.5 5.5-5.5"/><path d="M5 20h14"/></svg>';
  const ICON_OK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const ICON_ERR =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 7v6"/><path d="M12 17h.01"/></svg>';

  const CSS = `
  :host{all:initial}
  .layer{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .btn{position:absolute;left:0;top:0;pointer-events:auto;display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 15px 0 7px;border:0;border-radius:999px;color:#fff;font:700 13px/1 inherit;letter-spacing:-.01em;white-space:nowrap;cursor:pointer;opacity:0;visibility:hidden;
    background:linear-gradient(135deg,#5b5cff 0%,#9b4dff 52%,#ff4f8b 100%);
    box-shadow:0 10px 26px -8px rgba(84,47,219,.75),0 2px 6px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.38);
    transition:opacity .2s ease,filter .15s ease,box-shadow .15s ease,background .25s ease;will-change:transform;user-select:none;-webkit-user-select:none}
  .btn.show{opacity:.95;visibility:visible}
  .btn:hover{opacity:1;filter:brightness(1.08) saturate(1.08);box-shadow:0 12px 30px -8px rgba(84,47,219,.9),0 2px 8px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.45)}
  .btn:active{filter:brightness(.94)}
  .btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
  .ico{flex:none;width:23px;height:23px;border-radius:50%;background:rgba(255,255,255,.22);display:grid;place-items:center}
  .ico svg{width:14px;height:14px}
  .txt{display:inline-block}
  .btn.compact{width:38px;height:38px;padding:0;justify-content:center}
  .btn.compact .txt{display:none}
  .btn.compact .ico{background:transparent;width:24px;height:24px}
  .btn.compact.busy .ico{width:26px;height:26px}
  .btn.compact.busy .ico::after{inset:4px}
  .btn.compact .ico svg{width:18px;height:18px}
  .btn.busy{background:rgba(17,17,30,.88);box-shadow:0 10px 26px -8px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  .btn.busy .ico{background:conic-gradient(#b69bff calc(var(--p,0)*1%),rgba(255,255,255,.16) 0);position:relative}
  .btn.busy .ico::after{content:"";position:absolute;inset:4px;border-radius:50%;background:#15151f}
  .btn.busy .ico svg{display:none}
  .btn.spin .ico{background:conic-gradient(from 0deg,transparent 0 55%,#b69bff 100%);animation:smdspin .9s linear infinite}
  .btn.done{background:linear-gradient(135deg,#0fb57d,#34d399);box-shadow:0 10px 26px -8px rgba(16,185,129,.8),inset 0 1px 0 rgba(255,255,255,.35)}
  .btn.err{background:linear-gradient(135deg,#ef4444,#f97316);box-shadow:0 10px 26px -8px rgba(239,68,68,.8),inset 0 1px 0 rgba(255,255,255,.35)}
  @keyframes smdspin{to{transform:rotate(360deg)}}
  .aibadge{position:absolute;left:0;top:0;display:none;align-items:center;height:22px;padding:0 9px;border-radius:999px;pointer-events:auto;
    font:800 11.5px/1 inherit;color:#fff;letter-spacing:.02em;background:linear-gradient(135deg,#f59e0b,#ef4444);box-shadow:0 6px 16px -6px rgba(239,68,68,.8);white-space:nowrap}
  .aibadge.show{display:inline-flex}
  .acts{position:absolute;left:0;top:0;display:none;gap:4px;pointer-events:auto}
  .acts.show{display:inline-flex}
  .act{all:unset;cursor:pointer;height:26px;padding:0 10px;border-radius:999px;color:#fff;font:700 11.5px/26px inherit;white-space:nowrap;background:rgba(20,20,30,.82);box-shadow:0 4px 12px -4px rgba(0,0,0,.6)}
  .act:hover{filter:brightness(1.15)}
  .act.f{background:linear-gradient(135deg,#0a7aff,#5b5cff)}
  .act.b{background:linear-gradient(135deg,#4b5563,#1f2937)}
  .act.l{background:linear-gradient(135deg,#ff3d6e,#ff7a3d)}
  .act.busy{opacity:.55;pointer-events:none}
  .btn.downloaded{background:linear-gradient(135deg,#0fb57d,#34d399);box-shadow:0 8px 20px -8px rgba(16,185,129,.8),inset 0 1px 0 rgba(255,255,255,.35)}
  .btn.edit{cursor:grab;outline:2px dashed #fff;outline-offset:3px;animation:smdpulse 1.2s ease-in-out infinite}
  .btn.edit:active{cursor:grabbing}
  @keyframes smdpulse{50%{outline-color:rgba(255,255,255,.35)}}
  .panel{position:absolute;left:0;top:0;pointer-events:auto;width:300px;box-sizing:border-box;border-radius:16px;padding:14px 14px 12px;color:#f3f3f8;font:500 12.5px/1.55 inherit;
    background:rgba(21,21,33,.97);border:1px solid rgba(255,255,255,.09);box-shadow:0 22px 60px -14px rgba(0,0,0,.65);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:smdin .18s ease}
  @keyframes smdin{from{opacity:0}}
  .panel h4{margin:0 0 9px;font:800 13.5px/1.3 inherit;display:flex;align-items:center;gap:8px}
  .panel h4 i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;flex:none}
  .panel h4 i svg{width:12px;height:12px}
  .panel.e h4 i{background:#ef4444}.panel.s h4 i{background:#10b981}
  .row{display:grid;grid-template-columns:40px 1fr;gap:8px;margin:5px 0;word-break:break-all}
  .row b{color:#9d9db3;font-weight:700}
  .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:11px}
  .acts button{all:unset;cursor:pointer;padding:7px 12px;border-radius:10px;font:700 12px/1 inherit;color:#e9e9f2;background:rgba(255,255,255,.08)}
  .acts button:hover{background:rgba(255,255,255,.16)}
  .acts button.pri{background:linear-gradient(135deg,#5b5cff,#9b4dff);color:#fff}
  `;

  // 확장프로그램이 다시 로드되면 이전 버전이 남긴 버튼을 치운다.
  for (const old of document.querySelectorAll('smd-overlay, smd-anchor')) old.remove();

  // 버튼은 영상(사진) 바로 옆 DOM 에 붙는다 → 스크롤하면 브라우저가 영상과 함께 움직여 준다.
  const anchorParent = (el) => {
    const p = el.parentElement;
    if (!p) return null;
    return p.tagName === 'PICTURE' || p.tagName === 'VIDEO' ? p.parentElement : p;
  };
  function makeAnchor(entry) {
    const host = document.createElement('smd-anchor');
    host.setAttribute('style', 'all:initial;position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;display:block;overflow:visible;pointer-events:none;z-index:2147483647');
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${CSS}</style><div class="layer"></div>`;
    // 버튼을 누른 클릭이 사이트(예: X 사진 확대 창의 '배경 클릭 → 닫기')로 전달되지 않게 막는다
    for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'dblclick']) host.addEventListener(t, (ev) => ev.stopPropagation());
    entry.host = host;
    entry.layer = sh.querySelector('.layer');
  }
  function mountAnchor(entry) {
    const parent = anchorParent(entry.el);
    if (parent && entry.host.parentNode !== parent) parent.appendChild(entry.host);
  }

  // ───────────── 이미 받은 영상·사진 기억 (버튼을 초록 체크로 표시) ─────────────
  let downloaded = new Set();
  chrome.storage.local.get('downloadedKeys').then((r) => {
    downloaded = new Set(r.downloadedKeys || []);
    for (const e of tracked.values()) e.state === 'idle' && setLook(e, 'idle');
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.downloadedKeys) {
      downloaded = new Set(c.downloadedKeys.newValue || []);
      for (const e of tracked.values()) e.state === 'idle' && setLook(e, 'idle');
    }
  });
  // 유튜브 영상 ID: 본 플레이어(시청·쇼츠)는 주소에서, 피드 미리보기는 감싼 링크에서 읽는다.
  //   (유튜브는 영상 요소 하나를 다음 영상에도 다시 쓰고, 시청 주소가 모두 '/watch' 라서 경로만으로는 영상을 구분할 수 없음)
  function ytIdOf(el) {
    const main = el.closest('#movie_player, #shorts-player, ytd-reel-video-renderer, ytd-shorts, ytd-player#ytd-player');
    const preview = el.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, #video-preview, ytd-video-preview');
    if (preview && !el.closest('#movie_player:not(.ytd-video-preview), #shorts-player')) {
      const m = U.findLink(el, /(?:[?&]v=|\/shorts\/)([\w-]{11})/);
      if (m) return m[1];
    }
    const loc = /[?&]v=([\w-]{11})/.exec(location.search) || /\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(location.pathname);
    if (main || loc) return loc?.[1] || '';
    return U.findLink(el, /(?:[?&]v=|\/shorts\/)([\w-]{11})/)?.[1] || '';
  }
  // 영상·사진을 구분하는 키. 구분할 수 없으면 '' (받은 적 있음 표시를 하지 않음)
  function keyFor(entry) {
    const el = entry.el;
    if (entry.kind === 'image') return `img:${(SITES.originalImageUrls(el)[0] || '').split('#')[0]}`;
    if (adapter.id === 'youtube') {
      const id = ytIdOf(el);
      return id ? `youtube:${id}` : '';
    }
    // ① 그 게시물 안의 게시물 번호 링크 ② 게시물 화면 주소(화면에서 가장 큰 영상 하나에만) ③ 영상 파일·표지 주소
    //   예전에는 멀리 있는 링크(다른 게시물·'/reels/audio/' 음악 링크)나 피드 주소를 써서, 하나만 받아도 여러 영상이 '받은 적 있음'으로 보였다
    const re = POST_ID_RE[adapter.id] || POST_ID_RE.generic;
    const box = el.closest(POST_BOX_SEL);
    if (box) {
      for (const a of box.querySelectorAll('a[href]')) {
        const m = re.exec(a.getAttribute('href') || '');
        if (m) return `${adapter.id}:${m[1] || m[2]}`;
      }
    }
    const wrap = el.closest('a[href]');
    const wm = wrap && re.exec(wrap.getAttribute('href') || '');
    if (wm) return `${adapter.id}:${wm[1] || wm[2]}`;
    const um = re.exec(location.pathname + location.search);
    if (um && mainVideo() === el) return `${adapter.id}:${um[1] || um[2]}`;
    const poster = (el.getAttribute('poster') || '').split('?')[0];
    const src = /^https?:/.test(el.currentSrc || '') ? el.currentSrc.split('?')[0] : '';
    return src || poster ? `${adapter.id}:${src || poster}` : '';
  }
  // 사이트별 게시물 번호(주소에서). 인스타 '/reels/audio/…'(음악) 같은 공용 주소는 제외
  const POST_ID_RE = {
    instagram: /\/(?:p|reel|reels|tv)\/(?!audio\/)([\w-]{6,})/,
    threads: /\/post\/([\w-]{6,})/,
    x: /\/status\/(\d{6,})/,
    bluesky: /\/profile\/[^/]+\/post\/([\w]+)/,
    tiktok: /\/(?:video|photo)\/(\d{10,})/,
    douyin: /\/(?:video|note)\/(\d{10,})/,
    facebook: /(?:\/reel\/|\/videos\/(?:[^/]+\/)?|[?&]v=)(\d{6,})/,
    pinterest: /\/pin\/(\d{6,})/,
    xiaohongshu: /\/(?:explore|discovery\/item|user\/profile\/\w+)\/([0-9a-f]{24})/,
    bilibili: /\/video\/(BV\w{8,}|av\d+)/,
    kuaishou: /\/short-video\/([\w-]{6,})/,
    weibo: /weibo\.com\/\d+\/(\w{8,})|\/detail\/(\d{10,})/,
    vimeo: /vimeo\.com\/(\d{5,})|^\/(\d{5,})/,
    dailymotion: /\/video\/(\w{5,})/,
    naver: /\/(?:v|clips?|shortform)\/(\w{4,})/,
    snapchat: /\/spotlight\/([\w-]{6,})/,
    generic: /\/(?:status|video|videos|reel|watch|v|post|p)\/([\w-]{6,})/,
  };
  const POST_BOX_SEL = 'article, [role="article"], [role="dialog"], [data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"], [data-e2e="recommend-list-item-container"], [data-e2e="browse-video"], .note-item, .feed-item';
  // 화면에서 가장 크게 보이는 영상(게시물 화면 주소는 이 영상 것으로 본다)
  function mainVideo() {
    let best = null;
    let bestA = 0;
    for (const v of document.getElementsByTagName('video')) {
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w < 150 || h < 100) continue;
      if (w * h > bestA) {
        bestA = w * h;
        best = v;
      }
    }
    return best;
  }
  async function markDownloaded(entry) {
    const k = entry.dlKey || keyFor(entry);
    if (!k) return;
    entry.dlKey = k;
    downloaded.add(k);
    const r = await chrome.storage.local.get('downloadedKeys').catch(() => ({}));
    const list = [...new Set([...(r.downloadedKeys || []), k])].slice(-3000);
    await chrome.storage.local.set({ downloadedKeys: list }).catch(() => {});
  }

  const tracked = new Map(); // video -> entry
  const jobs = new Map(); // jobId -> entry
  let videoSeq = 0;

  // 작성자·플랫폼이 붙인 AI 표시(화면 라벨·해시태그)를 찾는다. 표시가 없는 AI 영상은 알아낼 수 없다.
  const AI_TEXT = /(AI\s*(로\s*)?(생성|제작|만든|정보|영상|이미지)|made\s+with\s+ai|ai[\s-]?generated|generated\s+(by|with)\s+ai|ai\s+info\b|altered\s+or\s+synthetic|합성된\s*콘텐츠|변경되거나\s*합성|AIGC|AI\s*生成|人工智能生成|内容由\s*AI|疑似包含\s*AI|#(ai|aiart|aivideo|ai영상|ai그림|aigc|aiart|sora|veo3?|kling|runway|midjourney|pika|hailuo|luma|genai)(?![\w가-힣]))/i;
  function aiInDom(entry) {
    try {
      const box = U.container(entry.el, 18);
      const text = (box.textContent || '').slice(0, 4000); // innerText 는 화면 배치를 다시 계산하게 해서 느림
      if (AI_TEXT.test(text)) return true;
      for (const el of box.querySelectorAll('[aria-label],[title]')) {
        if (AI_TEXT.test(el.getAttribute('aria-label') || el.getAttribute('title') || '')) return true;
      }
    } catch {}
    return false;
  }

  function makeButton(entry) {
    const badge = document.createElement('span');
    badge.className = 'aibadge';
    badge.textContent = 'AI 영상';
    badge.title = '작성자나 플랫폼이 AI 생성 콘텐츠로 표시한 영상입니다';
    entry.layer.appendChild(badge);
    // 게시물 아래 팔로우 · 차단 · 좋아요 (사이트마다 켜고 끄기: postActions)
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.innerHTML = '<button type="button" class="act f" title="이 게시물 작성자 팔로우">팔로우</button><button type="button" class="act b" title="이 게시물 작성자 차단">차단</button><button type="button" class="act l" title="이 게시물 좋아요">좋아요</button>';
    const busy = (btn, ms = 2500) => {
      btn.classList.add('busy');
      setTimeout(() => btn.classList.remove('busy'), ms);
    };
    acts.querySelector('.f').addEventListener('click', (ev) => {
      ev.preventDefault();
      busy(ev.currentTarget);
      autoFollow(entry.el, true);
    });
    acts.querySelector('.b').addEventListener('click', (ev) => {
      ev.preventDefault();
      busy(ev.currentTarget);
      blockAuthor(entry.el);
    });
    acts.querySelector('.l').addEventListener('click', async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      busy(btn, 1500);
      const like = globalThis.__SMD_LIKE_NOW;
      if (typeof like !== 'function') return actToast('좋아요', { error: { step: '좋아요 기능 준비', reason: '좋아요 기능이 아직 준비되지 않았습니다', action: '페이지를 새로고침(F5)한 뒤 다시 누르세요.' } });
      const r = await like(entry.el);
      if (r.error) actToast('좋아요', r);
      else if (r.liked !== null && r.liked !== undefined) actToast('좋아요', { custom: r.liked ? '좋아요 했습니다' : '좋아요를 취소했습니다' });
    });
    entry.layer.appendChild(acts);
    entry.acts = acts;
    entry.badge = badge;
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.title = '원본 화질로 다운로드';
    b.innerHTML = `<span class="ico">${ICON_DL}</span><span class="txt">다운로드</span>`;
    const activate = () => {
      entry.activatedAt = Date.now();
      if (editMode) return;
      if (entry.state === 'busy' || entry.state === 'resolving') return;
      if (entry.state === 'error' && entry.lastError) return showPanel(entry, 'e', entry.lastError);
      start(entry);
    };
    entry.activate = activate;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // 바로 앞의 '누르고 떼기'로 이미 시작했으면 다시 하지 않는다
      if (Date.now() - (entry.activatedAt || 0) < 600) return;
      activate();
    });
    // 안전장치: 사이트가 누르는 사이 플레이어 화면을 다시 그리면(X 등) click 이 사라질 수 있다.
    // 이 버튼에서 누르고 뗐는데 click 이 오지 않으면 그대로 다운로드를 시작한다(첫 번째 클릭이 무시되는 문제).
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button === 0) entry.pressAt = Date.now();
    });
    b.addEventListener('pointerup', (ev) => {
      if (ev.button !== 0 || !entry.pressAt || Date.now() - entry.pressAt > 1500) return;
      const pressed = entry.pressAt;
      entry.pressAt = 0;
      setTimeout(() => {
        if ((entry.activatedAt || 0) < pressed) activate();
      }, 120);
    });
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart']) {
      b.addEventListener(t, (ev) => ev.stopPropagation());
    }
    // 버튼 직접 배치 모드: 끌어서 영상 안 원하는 곳에 놓는다
    b.addEventListener('pointerdown', (ev) => {
      if (!editMode) return;
      ev.preventDefault();
      b.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const r = entry.el.getBoundingClientRect();
        editTemp[entry.kind] = {
          fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
          fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
        };
        place();
      };
      const up = () => {
        b.removeEventListener('pointermove', move);
        b.removeEventListener('pointerup', up);
      };
      b.addEventListener('pointermove', move);
      b.addEventListener('pointerup', up);
    });
    entry.layer.appendChild(b);
    return b;
  }

  // 사이트가 사진·영상 위에 투명 막을 덮어 두면(인스타그램 등) 버튼을 눌러도 그 막이 눌려
  //   아무 반응이 없거나 사이트 동작(영상 확대·게시물 열기·두 번 눌러 좋아요)이 먼저 일어난다.
  //   → 페이지 맨 바깥(window)에서 먼저 받아, 누른 자리가 저장 버튼이면 사이트로 넘기지 않고 다운로드를 시작한다.
  const hitButton = (x, y) => {
    for (const e of tracked.values()) {
      if (!e.visible || !e.btn) continue;
      const r = e.btn.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return e;
    }
    return null;
  };
  //   사이트(틱톡 등)가 페이지 맨 바깥에 먼저 걸어 둔 처리보다도 앞서야 해서, 받는 자리는 문서 시작 때 button-guard.js 가 미리 걸어 두고
  //   여기서는 판단 함수만 넘겨준다.
  globalThis.__SMD_HIT = (ev, t) => {
    if (!ev.isTrusted || editMode || !alive()) return;
    const pt = ev.touches?.[0] || ev.changedTouches?.[0] || ev;
    const e = hitButton(pt.clientX, pt.clientY);
    if (!e) return;
    ev.stopImmediatePropagation();
    if (ev.cancelable) ev.preventDefault();
    if (t === 'click' && Date.now() - (e.activatedAt || 0) > 600) e.activate?.();
  };
  if (!globalThis.__SMD_GUARD) {
    // button-guard.js 가 없으면(예전 페이지 등) 여기서라도 건다
    globalThis.__SMD_GUARD = true;
    for (const t of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'auxclick']) window.addEventListener(t, (ev) => globalThis.__SMD_HIT?.(ev, t), true);
  }

  function setLook(entry, state, text, percent) {
    const b = entry.btn;
    entry.state = state;
    b.classList.remove('busy', 'spin', 'done', 'err');
    const ico = b.querySelector('.ico');
    const txt = b.querySelector('.txt');
    b.classList.remove('downloaded');
    if (state === 'idle') {
      const k = entry.dlKey || keyFor(entry);
      const done = !!k && settings.downloadedMark !== false && downloaded.has(k);
      b.classList.toggle('downloaded', done);
      ico.innerHTML = done ? ICON_OK : ICON_DL;
      txt.textContent = done ? '받은 적 있음' : '다운로드';
      b.title = done ? '이미 다운로드한 적이 있어요 · 누르면 다시 받기' : entry.kind === 'image' ? '사진 원본 저장' : '원본 화질로 다운로드';
    } else if (state === 'resolving') {
      b.classList.add('busy', 'spin');
      ico.innerHTML = '';
      txt.textContent = text || '분석 중…';
      b.title = txt.textContent;
    } else if (state === 'busy') {
      b.classList.add('busy');
      ico.innerHTML = '';
      if (percent == null) b.classList.add('spin');
      b.style.setProperty('--p', String(Math.max(2, Math.min(100, percent || 0))));
      txt.textContent = text;
      b.title = text;
    } else if (state === 'done') {
      b.classList.add('done');
      ico.innerHTML = ICON_OK;
      txt.textContent = text || '저장 완료';
      b.title = txt.textContent;
    } else if (state === 'error') {
      b.classList.add('err');
      ico.innerHTML = ICON_ERR;
      txt.textContent = '실패 · 자세히';
      b.title = '눌러서 실패 원인 보기';
    }
    entry.measured = 0;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function closePanel(entry) {
    entry.panel?.remove();
    entry.panel = null;
    clearTimeout(entry.panelTimer);
  }

  function showPanel(entry, kind, data) {
    closePanel(entry);
    const p = document.createElement('div');
    p.className = `panel ${kind}`;
    if (kind === 'd') {
      // 이미 받은 파일(중복 다운로드 막기)
      p.innerHTML = `<h4><i>${ICON_OK}</i>${data.running ? '지금 받는 중' : '이미 받은 파일'}</h4>
        <div class="row"><b>안내</b><span>${escapeHtml(data.reason)}</span></div>
        ${data.where ? `<div class="row"><b>위치</b><span>${escapeHtml(data.where)}</span></div>` : ''}
        <div class="acts"><button data-a="close">닫기</button>${data.downloadId != null ? '<button data-a="showdup">폴더 열기</button>' : ''}${data.running ? '' : '<button class="pri" data-a="force">다시 받기</button>'}</div>`;
      entry.panelTimer = setTimeout(() => closePanel(entry), 12000);
    } else if (kind === 'e') {
      p.innerHTML = `<h4><i>${ICON_ERR}</i>다운로드 실패</h4>
        <div class="row"><b>단계</b><span>${escapeHtml(data.step)}</span></div>
        <div class="row"><b>원인</b><span>${escapeHtml(data.reason)}</span></div>
        <div class="row"><b>해결</b><span>${escapeHtml(data.action)}</span></div>
        <div class="acts"><button data-a="close">닫기</button><button class="pri" data-a="retry">다시 시도</button></div>`;
    } else {
      p.innerHTML = `<h4><i>${ICON_OK}</i>저장 완료</h4>
        <div class="row"><b>파일</b><span>${escapeHtml(data.file)}</span></div>
        ${data.where ? `<div class="row"><b>위치</b><span>${escapeHtml(data.where)}</span></div>` : ''}
        ${data.quality ? `<div class="row"><b>화질</b><span>${escapeHtml(data.quality)}</span></div>` : ''}
        ${data.warning ? `<div class="row"><b>안내</b><span>${escapeHtml(data.warning)}</span></div>` : ''}
        <div class="acts"><button data-a="close">닫기</button>${data.canShow ? '<button class="pri" data-a="show">폴더 열기</button>' : ''}</div>`;
      entry.panelTimer = setTimeout(() => closePanel(entry), data.warning ? 15000 : 6000);
    }
    p.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = ev.target.closest('button')?.dataset.a;
      if (a === 'close') {
        closePanel(entry);
        if (entry.state === 'error') setLook(entry, 'idle');
      } else if (a === 'retry') {
        closePanel(entry);
        start(entry);
      } else if (a === 'show') {
        chrome.runtime.sendMessage({ type: 'smd:show-file', jobId: entry.jobId }).catch(() => {});
      } else if (a === 'showdup') {
        chrome.runtime.sendMessage({ type: 'smd:show-file', downloadId: data.downloadId }).catch(() => {});
      } else if (a === 'force') {
        closePanel(entry);
        entry.force = true;
        start(entry);
      }
    });
    for (const t of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) p.addEventListener(t, (ev) => ev.stopPropagation());
    entry.layer.appendChild(p);
    entry.panel = p;
    entry.measured = 0;
    entry.panelKind = kind;
  }

  function showError(entry, err) {
    if (entry.staleResolve) {
      // 이미 다음 영상으로 넘어간 버튼에는 이전 영상의 오류를 띄우지 않는다
      entry.staleResolve = false;
      entry.dlKey = null;
      setLook(entry, 'idle');
      return;
    }
    // 중복 다운로드로 막힌 경우: 오류가 아니라 안내(받은 적 있음 표시)
    if (err?.duplicate) {
      entry.lastError = null;
      setLook(entry, 'idle');
      if (!err.running) markDownloaded(entry);
      showPanel(entry, 'd', err);
      return;
    }
    entry.lastError = {
      step: err?.step || '알 수 없는 단계',
      reason: err?.reason || err?.message || '원인을 확인하지 못했습니다.',
      action: err?.action || '페이지를 새로고침한 뒤 다시 시도하세요.',
    };
    setLook(entry, 'error');
    showPanel(entry, 'e', entry.lastError);
  }

  // 피드 게시물(글+영상) 영역을 화면 좌표로 구한다. iframe 안에서는 탭 화면 좌표와 달라 쓰지 않는다.
  const POST_SEL = 'article, [role="article"], [data-testid="tweet"], [data-testid="cellInnerDiv"], ytd-rich-item-renderer, ytd-reel-video-renderer, ytd-watch-metadata, [data-e2e="recommend-list-item-container"], .note-item, .feed-item';
  function postRect(el) {
    if (window.top !== window) return null;
    let box = el.closest(POST_SEL);
    if (!box) {
      // 게시물 표시가 없으면 영상보다 조금 크고 글이 들어 있는 조상을 쓴다
      const vr = el.getBoundingClientRect();
      for (let p = el.parentElement, i = 0; p && p !== document.body && i < 8; p = p.parentElement, i++) {
        const r = p.getBoundingClientRect();
        if (r.height > vr.height * 1.12 && (p.innerText || '').trim().length > 10) {
          box = p;
          break;
        }
        if (r.height > innerHeight * 1.5) break;
      }
    }
    const r = (box || el).getBoundingClientRect();
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x;
    const h = Math.min(innerHeight, r.bottom) - y;
    if (w < 40 || h < 40) return null;
    return { x, y, w, h, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1 };
  }

  // 요약에 쓸 '피드 본문'. 탭 제목·작성자 이름이 아니라 게시물 글을 쓴다.
  const TEXT_SEL = '[data-testid="tweetText"], [data-testid="postText"], [data-e2e="browse-video-desc"], [data-e2e="video-desc"], #detail-desc, #desc, .note-text, .desc, ._a9zs, [data-ad-preview="message"], [data-ad-comet-preview="message"], [class*="wbtext"], [data-test-id="truncated-description"], .video-info-title';
  function feedText(el, title) {
    const conf = SHOT_SITES[adapter.id];
    const box = el.closest(POST_SEL) || el.closest('[role="dialog"]') || (conf && shotBox(el, conf));
    let t = '';
    if (box) t = box.querySelector(TEXT_SEL)?.innerText || '';
    // X 사진·영상 확대 보기: 같은 게시물 글을 화면에서 찾는다
    if (!t) {
      const id = /\/status\/(\d+)/.exec(location.pathname)?.[1];
      if (id) {
        for (const a of document.querySelectorAll(`article a[href*="/status/${id}"]`)) {
          const tt = a.closest('article')?.querySelector('[data-testid="tweetText"]')?.innerText;
          if (tt) {
            t = tt;
            break;
          }
        }
      }
    }
    if (t.trim()) return t.trim();
    let s = String(title || '').trim();
    // 'OO on X: "본문" / X', 'X의 OO님: "본문"' 형태면 본문만
    const q = /[:：]\s*["“](.+)["”]\s*(?:\/\s*X)?\s*$/s.exec(s);
    if (q) return q[1].trim();
    // X 의 탭 제목('(1) 이름 / X')은 작성자·알림 수일 뿐 본문이 아니다
    const pageTitles = [document.title, U.metaTitle()].map((x) => String(x || '').trim());
    if (!s || /^(\(\d+\)\s*)?.{0,60}\s\/\s*X$/.test(s) || (adapter.id === 'x' && pageTitles.includes(s))) return '';
    return s;
  }

  // 게시물 작성자(이름 + @아이디). 영상·사진 위 글자 첫 줄 '작성자 이름 (@아이디) · 사이트'에 쓴다.
  //   사이트별 프로필 주소 모양으로 게시물 안의 작성자 링크를 찾고, 못 찾으면 사이트 데이터의 작성자(req.author)를 쓴다.
  const PROFILE_RE = {
    x: /^\/([A-Za-z0-9_]{1,15})\/?$/,
    bluesky: /^\/profile\/([^/?#]+)\/?$/,
    instagram: /^\/([A-Za-z0-9._]{1,30})\/?$/,
    threads: /^\/@([A-Za-z0-9._]{1,30})\/?$/,
    tiktok: /^\/@([A-Za-z0-9._]{1,30})\/?$/,
    youtube: /^\/@([\w.-]{1,40})\/?$/,
    pinterest: /^\/([A-Za-z0-9_]{3,30})\/?$/,
  };
  const NOT_PROFILE = /^(home|explore|search|notifications|messages|settings|i|reels?|p|stories|direct|accounts|about|privacy|terms|login|signup|tv|feed|following|foryou|live|shorts|watch|hashtag|tags?|compose)$/i;
  const txtOf = (e) => (e?.innerText || e?.textContent || '').replace(/\s+/g, ' ').trim();
  function postAuthor(el, req) {
    const conf = SHOT_SITES[adapter.id];
    const box = el.closest(POST_SEL) || el.closest('[role="dialog"]') || (conf && shotBox(el, conf));
    const re = PROFILE_RE[adapter.id];
    let handle = '';
    let name = '';
    // 유튜브: 보기·쇼츠 화면의 채널 칸(재생목록·관련 영상의 다른 채널 링크를 잡지 않게)
    if (adapter.id === 'youtube') {
      const inMain = el.closest('#movie_player, #shorts-player, ytd-player, ytd-reel-video-renderer, ytd-shorts');
      const ch = inMain && (el.closest('ytd-reel-video-renderer')?.querySelector('a[href^="/@"]') ||
        document.querySelector('ytd-reel-video-renderer[is-active] a[href^="/@"], ytd-watch-metadata #owner a[href^="/@"], ytd-watch-metadata ytd-channel-name a[href^="/@"], ytd-video-owner-renderer a[href^="/@"], #owner a[href^="/@"]'));
      if (ch) {
        handle = decodeURIComponent((ch.getAttribute('href') || '').replace(/^\/@/, '').split(/[/?#]/)[0]);
        name = txtOf(ch).replace(/^@/, '').slice(0, 40);
        if (name.toLowerCase() === handle.toLowerCase()) name = '';
      }
    } else if (adapter.id === 'bluesky' && SITES.bskyPost) {
      const p = SITES.bskyPost(el, '영상');
      if (p.found) {
        const it = el.closest('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]');
        handle = it?.dataset.testid.replace(/^(feedItem|postThreadItem)-by-/, '') || '';
        name = p.author && p.author !== handle ? p.author : '';
      }
    } else if (box?.querySelector('[data-testid="User-Name"]')) {
      // X(또는 같은 모양의 페이지): 작성자 줄 '이름 @아이디 · 날짜'
      const t = txtOf(box.querySelector('[data-testid="User-Name"]'));
      handle = /@([A-Za-z0-9_]{1,15})/.exec(t)?.[1] || '';
      name = t.split('@')[0].replace(/[·\s]+$/, '').trim().slice(0, 40);
    }
    // 틱톡 게시물 화면 주소(/@아이디/video|photo/번호)에는 작성자 아이디가 들어 있다 — 추천 계정 링크보다 먼저
    if (!handle && adapter.id === 'tiktok') {
      handle = /^\/@([^/]+)\/(?:video|photo)\//.exec(location.pathname)?.[1] || '';
      if (!handle && box) handle = (box.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]')?.innerText || '').trim().replace(/^@/, '');
    }
    if (!handle && box && re) {
      const links = [...box.querySelectorAll('a[href]')];
      for (const a of links) {
        const m = re.exec(a.getAttribute('href') || '');
        if (!m || NOT_PROFILE.test(m[1])) continue;
        handle = decodeURIComponent(m[1]);
        // 같은 프로필로 가는 링크 중 '@' 로 시작하지 않는 글자가 이름
        for (const b of links) {
          if (b.getAttribute('href') !== a.getAttribute('href')) continue;
          const t = (b.innerText || '').split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('@') && !/^\d+[smhd분시간일]/.test(x) && x.toLowerCase() !== handle.toLowerCase());
          if (t) {
            name = t.slice(0, 40);
            break;
          }
        }
        break;
      }
    }
    if (!handle && adapter.id === 'tiktok') handle = (document.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]')?.innerText || '').trim().replace(/^@/, '');
    const fromSite = String(req.author || '').trim().replace(/^@/, '');
    if (!handle && fromSite && /^[\w.-]{2,40}$/.test(fromSite)) handle = fromSite;
    else if (!name && fromSite && fromSite !== handle) name = fromSite.slice(0, 40);
    return { name, handle };
  }

  // 피드 글 부분(프로필 사진·이름·본문) 영역. raw=true 면 화면 밖이어도 그대로 돌려준다(스크롤 판단용).
  // 사이트별 캡처 위치: box = 게시물 묶음, parts = 작성자 줄 + 본문 요소(이것만 캡처)
  const SHOT_SITES = {
    x: { box: 'article[data-testid="tweet"]', parts: ['[data-testid="Tweet-User-Avatar"]', '[data-testid="User-Name"]', '[data-testid="tweetText"]'] },
    bluesky: { box: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]', parts: ['[data-testid="userAvatarImage"]', 'a[href^="/profile/"]:not([aria-label])', '[data-testid="postText"]'] },
    instagram: { box: 'article, [role="dialog"]', parts: ['header', 'h1', '._a9zs'] },
    tiktok: { box: '[data-e2e="recommend-list-item-container"], [data-e2e="browse-video"], article', parts: ['[data-e2e="video-author-avatar"]', '[data-e2e="video-author-uniqueid"]', '[data-e2e="browse-username"]', '[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]'], page: true },
    douyin: { box: '[data-e2e="feed-item"], [data-e2e="detail-video-info"]', parts: ['[data-e2e="feed-video-nickname"]', '[data-e2e="video-desc"]', '[data-e2e="detail-video-info"] h1'], page: true },
    facebook: { box: '[role="article"], div[data-pagelet^="FeedUnit"]', parts: ['h2', 'h3', 'h4', '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]'] },
    youtube: { box: 'ytd-reel-video-renderer[is-active], ytd-watch-metadata, ytd-rich-item-renderer', parts: ['yt-shorts-video-title-view-model', 'ytd-channel-name', '#title h1', '#owner', '#video-title'], page: true },
    weibo: { box: 'article', parts: ['header', '[class*="wbtext"]', '.weibo-text'] },
    xiaohongshu: { box: '#noteContainer, .note-container, section.note-item', parts: ['.author-wrapper', '.author', '#detail-title', '#detail-desc', '.title'], page: true },
    bilibili: { box: '#viewbox_report, .video-info-container, .up-panel-container', parts: ['.up-info-container', '.up-name', 'h1.video-title', '.video-title'], page: true },
    pinterest: { box: '[data-test-id="closeup-body"], [data-test-id="pin"]', parts: ['[data-test-id="pinner-name"]', '[data-test-id="pin-closeup-title"]', '[data-test-id="closeup-title"]', '[data-test-id="truncated-description"]'], page: true },
    kuaishou: { box: '.video-info, .feed-item, .short-video-info', parts: ['.profile-user-name', '.video-info-title', '.title'], page: true },
    naver: { box: '.se_component_wrap, ._articleBody, .video_info, .clip_info', parts: ['.title', '.desc', 'h3', 'h2'], page: true },
    vimeo: { box: 'main', parts: ['h1', '[class*="ClipTitle"]'], page: true },
    dailymotion: { box: 'main', parts: ['h1', '[class*="VideoInfoTitle"]'], page: true },
    snapchat: { box: 'main', parts: ['h1', '[class*="caption"]'], page: true },
  };
  // 작성자 줄(프로필 사진·이름·아이디·날짜) + 본문을 한 덩어리로 캡처한다(영상·사진은 빼고)
  const DEFAULT_SHOT = { box: POST_SEL, parts: ['[data-testid="Tweet-User-Avatar"]', '[data-testid="User-Name"]', 'header'].concat(TEXT_SEL.split(', ')) };

  // 게시물 묶음: 영상을 감싼 것이 먼저, 없으면(page:true 사이트) 화면에서 영상과 가장 가까운 것
  function shotBox(el, conf) {
    const own = el.closest(conf.box) || el.closest('[role="dialog"]');
    if (own) return own;
    if (!conf.page) return null;
    const vr = el.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    for (const c of [...document.querySelectorAll(conf.box)].slice(0, 40)) {
      const r = c.getBoundingClientRect();
      if (r.width < 40 || r.height < 10 || r.bottom < -innerHeight || r.top > innerHeight * 2) continue;
      const d = Math.max(0, r.top - vr.bottom, vr.top - r.bottom) + Math.max(0, r.left - vr.right, vr.left - r.right);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD < innerHeight ? best : null;
  }

  // 피드 본문 영역. 영상 위에 있는 부분과 아래에 있는 부분은 따로 잘라(영상은 빼고) 이어 붙인다.
  // raw=true 면 화면 밖이어도 그대로 돌려준다(스크롤 판단용).
  function textRect(el, raw = false) {
    if (window.top !== window) return null;
    const conf = SHOT_SITES[adapter.id] || DEFAULT_SHOT;
    const box = shotBox(el, conf);
    if (!box) return null;
    const vr = el.getBoundingClientRect();
    const seen = new Set();
    let rects = [];
    const heads = []; // 작성자 줄(프로필 사진·이름·아이디·날짜) — 번역하면 본문 대신 번역을 붙이므로 따로 기억
    for (const sel of conf.parts) {
      for (const p of box.querySelectorAll(sel)) {
        if (seen.has(p) || p.contains(el) || p.closest('smd-anchor')) continue;
        const r = tightRect(p);
        if (r.width < 4 || r.height < 4) continue;
        seen.add(p);
        rects.push(r);
        if (!p.matches(BODY_SEL)) heads.push(r);
        break; // 선택자마다 첫 번째 하나
      }
    }
    // 본문이 없는 게시물은 캡처하지 않는다
    if (!rects.length) return null;
    const br = box.getBoundingClientRect();
    // 작성자 줄 + 본문 글자에 여백 없이 딱 맞게
    const union = (list) => list.length && {
      left: Math.max(br.left, Math.min(...list.map((x) => x.left))),
      top: Math.min(...list.map((x) => x.top)),
      right: Math.min(Math.max(br.right, vr.right), Math.max(...list.map((x) => x.right))),
      bottom: Math.max(...list.map((x) => x.bottom)),
    };
    const mid = (vr.top + vr.bottom) / 2;
    const above = union(rects.filter((r) => (r.top + r.bottom) / 2 < mid));
    const below = union(rects.filter((r) => (r.top + r.bottom) / 2 >= mid));
    // 영상과 겹치는 부분은 잘라 낸다(영상 위 글은 영상 위쪽까지, 영상 아래 글은 영상 아래쪽부터)
    if (above && above.bottom > vr.top && above.top < vr.top) above.bottom = vr.top - 2;
    if (below && below.top < vr.bottom && below.bottom > vr.bottom && vr.height < innerHeight * 0.9) below.top = vr.bottom + 2;
    const groups = [above, below].filter(Boolean);
    if (raw) return groups[0] || null;
    const clip = (r) => {
      const x = Math.max(0, r.left);
      const y = Math.max(0, r.top);
      const w = Math.min(innerWidth, r.right) - x;
      const h = Math.min(innerHeight, r.bottom) - y;
      return w >= 60 && h >= 12 ? { x, y, w, h } : null;
    };
    const parts = groups.map(clip).filter(Boolean);
    if (!parts.length) return null;
    const hu = union(heads);
    const head = hu ? clip(hu) : null;
    return { ...parts[0], rects: parts, head, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1 };
  }

  // 요소 상자가 아니라 실제 글자·그림이 차지한 범위(짧은 글 오른쪽 빈칸 등 여백 제외)
  function tightRect(p) {
    const list = [];
    try {
      const range = document.createRange();
      range.selectNodeContents(p);
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) list.push(r);
    } catch {}
    for (const m of p.querySelectorAll('img, svg, video, canvas')) {
      const r = m.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) list.push(r);
    }
    if (!list.length) return p.getBoundingClientRect();
    // 숨긴(해시태그 등) 줄은 getClientRects 에 안 나온다
    return {
      left: Math.min(...list.map((r) => r.left)),
      top: Math.min(...list.map((r) => r.top)),
      right: Math.max(...list.map((r) => r.right)),
      bottom: Math.max(...list.map((r) => r.bottom)),
      get width() { return this.right - this.left; },
      get height() { return this.bottom - this.top; },
    };
  }

  // 본문 요소(작성자 줄이 아닌 것)
  const BODY_SEL = `${TEXT_SEL}, h1, ._a9zs, #detail-title, .title, yt-shorts-video-title-view-model, #video-title, #title h1, [data-test-id="pin-closeup-title"], [data-test-id="closeup-title"], .video-title`;

  // 화면 위쪽에 고정(position: fixed/sticky)된 사이트 요소가 덮는 높이(캡처 영역 가로 범위 안)
  function topCover(r) {
    let cover = 0;
    const xs = [r.left + 8, (r.left + r.right) / 2, r.right - 8].map((x) => Math.min(innerWidth - 1, Math.max(0, x)));
    for (const x of xs) {
      for (let y = 2; y < innerHeight * 0.4; y += 12) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest('smd-anchor, smd-toolbar, smd-follow, smd-bfollow, smd-ytstats')) break;
        let fixed = null;
        for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
          const pos = getComputedStyle(p).position;
          if (pos === 'fixed' || pos === 'sticky') {
            fixed = p;
            break;
          }
        }
        if (!fixed) break;
        cover = Math.max(cover, fixed.getBoundingClientRect().bottom);
        y = Math.max(y, fixed.getBoundingClientRect().bottom);
      }
    }
    return Math.min(cover, innerHeight * 0.4);
  }

  const HASHTAG_SEL = 'a[href^="/hashtag/"], a[href*="/hashtag/"], a[href*="/explore/tags/"], a[href*="/tag/"], a[href*="search?q=%23"], a[href*="search?q=#"], a[href*="/search?q=%23"], a[href*="huati.weibo"], a[href*="/topic/"]';
  let shotStyle = null;
  async function hideButtonsForShot(on) {
    if (!on) {
      shotStyle?.remove();
      shotStyle = null;
      return;
    }
    shotStyle = document.createElement('style');
    // 캡처에 넣지 않을 것: 다운로더 버튼들 + 해시태그(#…) 링크
    shotStyle.textContent = `smd-anchor, smd-toolbar, smd-follow, smd-bfollow, smd-ytstats { visibility: hidden !important; }
      ${HASHTAG_SEL} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(shotStyle);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // ───────────── 다운로드 누르면 작성자 자동 팔로우 ─────────────
  // X·블루스카이는 각 도구(x-tools / bsky-tools)가 처리하고, 그 밖의 사이트는 영상 가까이에 있는 팔로우·구독 버튼을 대신 누른다.
  // 이미 팔로우 중이면 아무것도 하지 않는다(언팔로우 버튼은 절대 누르지 않음).
  const FOLLOW_TEXT = /^(\+\s*)?(팔로우|팔로우하기|follow|follow back|구독|구독하기|subscribe|关注|關注|加关注|フォロー|フォローする|seguir|suivre|abonnieren|segui|takip et|ikuti)$/i;
  // 사이트별 팔로우·구독 단추 위치(영상과 떨어져 있는 경우: 유튜브 보기 화면 등). 영상에서 가장 가까운 것을 누른다.
  const SITE_FOLLOW = {
    youtube: ['ytd-reel-video-renderer[is-active] yt-subscribe-button-view-model button', 'ytd-reel-video-renderer[is-active] #subscribe-button button', 'ytd-subscribe-button-renderer button', '#subscribe-button button', 'yt-subscribe-button-view-model button', 'ytd-reel-player-overlay-renderer #subscribe-button button', 'yt-reel-channel-bar-view-model button', 'reel-channel-bar-view-model button'],
    tiktok: ['[data-e2e="follow-button"]', '[data-e2e="feed-follow"]', '[data-e2e="browse-follow"]'],
    instagram: ['header button', 'article header [role="button"]', '[role="dialog"] header button'],
    facebook: ['[aria-label="팔로우"]', '[aria-label="Follow"]'],
    pinterest: ['[data-test-id="user-follow-button"] button', '[data-test-id="creator-follow-button"] button', 'button[aria-label*="팔로우"]', 'button[aria-label*="Follow" i]'],
    bilibili: ['.follow-btn', '.up-panel-container .follow-btn', '.bili-follow-btn'],
    weibo: ['button[class*="follow"]', '.woo-button-main'],
    douyin: ['[data-e2e="feed-follow-icon"]', '[data-e2e="user-info-follow-btn"]', 'button[class*="follow"]'],
    kuaishou: ['.follow-button', '.profile-follow', 'button[class*="follow"]'],
    xiaohongshu: ['.follow-button', '.note-detail-follow-btn', 'button[class*="follow"]'],
    vimeo: ['button[class*="Follow"]', '[data-testid*="follow" i] button'],
    dailymotion: ['button[class*="Follow"]', '[data-testid*="follow" i]'],
    naver: ['button[class*="subscribe"]', 'button[class*="follow"]', 'a[class*="subscribe"][role="button"]'],
    snapchat: ['button[class*="Subscribe"]', 'button[class*="subscribe"]'],
  };
  const isFollowBtn = (b) => {
    if (!b || b.closest('smd-anchor') || b.disabled) return false;
    if (b.closest('a[href]') && !b.matches('[role="button"]')) return false;
    const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
    const label = (b.getAttribute('aria-label') || '').trim();
    // 글자 없는 아이콘 단추(틱톡 피드 프로필 사진의 '+')는 data-e2e 이름으로 판단
    const e2e = b.getAttribute('data-e2e') || '';
    if (!t && /follow/i.test(e2e) && !/following|unfollow|followed/i.test(e2e)) return true;
    return FOLLOW_TEXT.test(t) || (!t && FOLLOW_TEXT.test(label)) || (t.length < 2 && FOLLOW_TEXT.test(label));
  };
  const NO_DOM_FOLLOW = new Set(['x', 'bluesky']);
  // 자동 팔로우 결과 알림(화면 아래 가운데). 성공·이미 팔로우·실패(단계·원인·조치)를 모두 보여 준다.
  let toastHost = null;
  function followToast(r) {
    if (!r) return;
    if (!toastHost?.isConnected) {
      toastHost = document.createElement('smd-toast');
      toastHost.setAttribute('style', 'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;pointer-events:none');
      toastHost.attachShadow({ mode: 'open' }).innerHTML = `<style>.t{max-width:420px;padding:9px 14px;border-radius:12px;color:#fff;background:rgba(20,20,30,.92);font:600 12.5px/1.45 "Pretendard","Malgun Gothic",system-ui,sans-serif;white-space:pre-line;box-shadow:0 4px 16px rgba(0,0,0,.35)}.t.err{background:rgba(150,20,40,.95)}</style><div class="t"></div>`;
      document.documentElement.appendChild(toastHost);
    }
    const t = toastHost.shadowRoot.querySelector('.t');
    const who = r.who ? `${r.who} ` : '';
    if (r.custom) {
      t.className = r.err ? 't err' : 't';
      t.textContent = r.custom;
    } else if (r.error && r.error.step && !/팔로우|작성자|로그인/.test(r.error.step) && !r.who) {
      t.className = 't err';
      t.textContent = `실패\n단계: ${r.error.step}\n원인: ${r.error.reason}\n조치: ${r.error.action || '페이지를 새로고침한 뒤 다시 시도하세요.'}`;
    } else if (r.error) {
      t.className = 't err';
      t.textContent = `자동 팔로우 실패 ${who}\n단계: ${r.error.step || '팔로우'}\n원인: ${r.error.reason || r.error}\n조치: ${r.error.action || '페이지를 새로고침한 뒤 다시 시도하세요.'}`;
    } else {
      t.className = 't';
      t.textContent = r.already ? `자동 팔로우: ${who}이미 팔로우 중입니다` : `자동 팔로우: ${who}팔로우했습니다`;
    }
    toastHost.style.display = 'block';
    // 지나간 알림도 확인할 수 있게 최근 5개를 남겨 둔다(문제 확인용)
    try {
      const hist = JSON.parse(toastHost.dataset.history || '[]');
      hist.push(t.textContent);
      toastHost.dataset.history = JSON.stringify(hist.slice(-5));
    } catch {}
    clearTimeout(followToast.t);
    followToast.t = setTimeout(() => toastHost && (toastHost.style.display = 'none'), r.error || r.err ? 12000 : 4000);
  }
  globalThis.__SMD_FOLLOW_TOAST = followToast;

  // 팔로우가 이미 된 상태의 단추 글자(이미 팔로우 중이면 아무것도 하지 않는다)
  const FOLLOWING_TEXT = /^(팔로잉|팔로우 중|팔로우중|요청됨|구독중|구독 중|following|requested|subscribed|已关注|互相关注|已互粉|フォロー中|siguiendo|abonniert)$/i;
  const btnText = (b) => (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();

  // 인스타그램: 화면 단추는 게시물 구조가 깊고 자주 바뀌어 잘 못 찾으므로, 인스타그램 웹이 쓰는 요청으로 작성자를 팔로우한다
  async function igFollow(el, lookup) {
    const handle = postAuthor(el, {}).handle;
    if (!handle) return null; // 작성자를 모르면 화면 단추로
    const who = `@${handle}`;
    const cached = SITES.igUsers?.get(handle.toLowerCase());
    if (cached?.following === true) return { who, already: true };
    // 페이지 데이터에 계정 번호가 없으면: 먼저 화면 단추로 하고(lookup=false), 그래도 안 될 때만 따로 물어본다
    if (!cached?.id && !lookup) return null;
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1];
    const me = (document.cookie.match(/(?:^|; )ds_user_id=([^;]+)/) || [])[1];
    if (!csrf || !me) return { who, error: { step: '로그인 확인', reason: '인스타그램 로그인 정보를 찾지 못했습니다', action: '인스타그램에 로그인한 뒤 새로고침(F5)하세요.' } };
    const H = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' };
    let user = cached?.id ? { id: cached.id, followed_by_viewer: cached.following === true } : null;
    if (!user) {
      let status = 0;
      try {
        const r = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, { headers: H, credentials: 'include' });
        status = r.status;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        user = (await r.json())?.data?.user;
      } catch (err) {
        if (status === 429) return { who, error: { step: '작성자 정보 확인', reason: '인스타그램이 짧은 시간에 요청이 많다며 잠시 막았습니다 (HTTP 429)', action: '몇 분 뒤 다시 받거나, 게시물 위쪽의 팔로우 단추를 직접 누르세요.' } };
        return { who, error: { step: '작성자 정보 확인', reason: `인스타그램이 작성자 정보를 주지 않았습니다 (${err.message || err})`, action: '잠시 후 다시 시도하세요. 계속되면 새로고침(F5)하세요.' } };
      }
    }
    if (!user?.id) return { who, error: { step: '작성자 정보 확인', reason: '작성자 계정 번호를 찾지 못했습니다', action: '작성자 프로필에서 직접 팔로우하세요.' } };
    if (String(user.id) === String(me)) return null;
    if (user.followed_by_viewer || user.requested_by_viewer) return { who, already: true };
    let r2;
    let j = {};
    try {
      r2 = await fetch(`/api/v1/friendships/create/${user.id}/`, { method: 'POST', credentials: 'include', headers: { ...H, 'X-CSRFToken': decodeURIComponent(csrf), 'content-type': 'application/x-www-form-urlencoded' }, body: `container_module=profile&nav_chain=&user_id=${user.id}` });
      j = await r2.json().catch(() => ({}));
    } catch (err) {
      return { who, error: { step: '팔로우 요청', reason: `인스타그램에 연결하지 못했습니다 (${err.message || err})`, action: '인터넷 연결을 확인한 뒤 다시 시도하세요.' } };
    }
    const fs = j.friendship_status || {};
    if (r2.ok && j.status === 'ok' && (fs.following || fs.outgoing_request)) {
      SITES.igUsers?.set(handle.toLowerCase(), { id: String(user.id), following: true });
      return { who, ok: true };
    }
    const limited = r2.status === 429 || /wait|limit|try again|잠시/i.test(j.message || '');
    return { who, error: { step: '팔로우 요청', reason: `인스타그램이 팔로우를 받아들이지 않았습니다 (HTTP ${r2.status}${j.message ? ` · ${j.message}` : ''})`, action: limited ? '인스타그램이 잠시 팔로우를 막았습니다. 몇 시간 뒤에 다시 시도하세요.' : '작성자 프로필에서 직접 팔로우해 보세요.' } };
  }

  // 화면의 팔로우 단추를 찾아 누르고, 단추 글자가 바뀌는지로 결과를 확인한다
  function domFollow(el, report) {
    const vr = el.getBoundingClientRect();
    let handle = '';
    let who = '';
    try {
      const a = postAuthor(el, {});
      handle = a.handle || '';
      who = handle ? `@${handle}` : a.name || '';
    } catch {}
    const FOLLOW_SEL = 'button, [role="button"], [data-e2e="follow-button"], [data-e2e="feed-follow"], [data-e2e="browse-follow"]';
    // 작성자 프로필 링크 근처(6단계 안)에 있는 단추인가 — 추천 계정 등 다른 사람의 팔로우 단추를 누르지 않게
    const nearAuthor = (b) => {
      if (!handle) return false;
      const h = handle.toLowerCase();
      const isAuthor = (href) => href.includes(`/@${h}`) || href.replace(/\/+$/, '').endsWith(`/${h}`) || href.includes(`/${h}?`);
      // 단추에서 가장 가까운(처음 만나는) 링크 묶음만 본다 — 위로 많이 올라가면 다른 계정 단추도 작성자 링크를 품게 되므로
      for (let p = b.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) {
        const links = [...p.querySelectorAll('a[href]')].map((a) => (a.getAttribute('href') || '').toLowerCase()).filter((x) => x && x !== '#');
        if (links.length) return links.some(isAuthor);
      }
      return false;
    };
    const cands = [];
    let already = false;
    // ① 사진·영상을 감싼 묶음 안(인스타·샤오홍슈처럼 구조가 깊어도 화면 높이 기준으로 25단계까지)
    for (let p = el.parentElement, i = 0; p && p !== document.documentElement && i < 25; p = p.parentElement, i++) {
      if (p.getBoundingClientRect().height > Math.max(innerHeight * 2.5, vr.height * 4)) break;
      const bs = [...p.querySelectorAll(FOLLOW_SEL)];
      const f = bs.filter(isFollowBtn);
      if (f.length) {
        cands.push(...f);
        break;
      }
      if (bs.some((x) => FOLLOWING_TEXT.test(btnText(x)))) {
        already = true;
        break;
      }
    }
    // ② 게시물 창(샤오홍슈 노트 창·인스타 게시물 창 등) 안
    if (!cands.length && !already) {
      const box = el.closest('#noteContainer, .note-container, [role="dialog"], article, [data-e2e="browse-video"]');
      if (box) {
        const bs = [...box.querySelectorAll(FOLLOW_SEL)];
        cands.push(...bs.filter(isFollowBtn));
        if (!cands.length && bs.some((x) => FOLLOWING_TEXT.test(btnText(x)))) already = true;
      }
    }
    // ③ 사이트별 단추 위치(영상과 가까운 순)
    if (!cands.length && !already) {
      const near = [];
      for (const sel of SITE_FOLLOW[adapter.id] || []) {
        for (const x of document.querySelectorAll(sel)) {
          if (!isFollowBtn(x)) continue;
          const r = x.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          const d = Math.hypot(Math.max(0, r.left - vr.right, vr.left - r.right), Math.max(0, r.top - vr.bottom, vr.top - r.bottom));
          if (d < innerHeight * 1.5) near.push([d, x]);
        }
      }
      near.sort((x, y) => x[0] - y[0]).forEach(([, x]) => cands.push(x));
      // 같은 자리 단추가 이미 '구독중·팔로잉'이면 이미 팔로우 중
      if (!cands.length) {
        for (const sel of SITE_FOLLOW[adapter.id] || []) {
          for (const x of document.querySelectorAll(sel)) {
            const r = x.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            const d = Math.hypot(Math.max(0, r.left - vr.right, vr.left - r.right), Math.max(0, r.top - vr.bottom, vr.top - r.bottom));
            if (d < innerHeight * 1.5 && (FOLLOWING_TEXT.test(btnText(x)) || /^(구독 취소|unsubscribe)/i.test(x.getAttribute('aria-label') || ''))) already = true;
          }
        }
      }
    }
    if (already) return report({ who, already: true });
    // 작성자 프로필 링크 옆 단추를 먼저 고른다
    let btn = cands.find(nearAuthor) || null;
    if (!btn && handle) {
      // 사진 옆 단추가 추천 계정 것이면: 화면 전체에서 작성자 프로필 링크 옆 팔로우 단추를 찾는다
      btn = [...document.querySelectorAll(FOLLOW_SEL)].find((x) => isFollowBtn(x) && nearAuthor(x)) || null;
    }
    // 틱톡은 추천 계정 단추가 많아, 작성자 옆 단추를 못 찾으면 다른 단추는 누르지 않는다
    if (!btn && !(handle && adapter.id === 'tiktok')) btn = cands[0] || null;
    if (!btn) return report({ who, error: { step: '팔로우 단추 찾기', reason: '이 화면에서 작성자 팔로우 단추를 찾지 못했습니다', action: '게시물을 눌러 연 화면에서 다시 받거나, 작성자 프로필에서 직접 팔로우하세요.' } });
    const box = btn.parentElement?.parentElement?.parentElement || btn.parentElement;
    btn.click();
    // 사이트가 '팔로잉'으로 잠깐 바꿨다가 서버에서 거절되면 되돌리는 경우가 있어(틱톡 등) 4.5초 뒤의 최종 상태로 판단한다
    setTimeout(() => {
      const shown = (x) => x.isConnected && x.getBoundingClientRect().width > 0;
      let ok;
      if (shown(btn)) ok = FOLLOWING_TEXT.test(btnText(btn)) || FOLLOWING_TEXT.test(btn.getAttribute('aria-label') || '') || !isFollowBtn(btn);
      else {
        // 단추가 다시 그려졌으면 같은 자리에 '팔로우' 단추가 다시 생겼는지 본다
        const again = box?.isConnected ? [...box.querySelectorAll(FOLLOW_SEL)].filter((x) => shown(x) && isFollowBtn(x)) : [];
        ok = !again.length;
      }
      if (ok) report({ who, ok: true });
      else report({ who, error: { step: '팔로우 확인', reason: '팔로우 단추를 눌렀지만 사이트에서 팔로우가 유지되지 않았습니다(사이트가 자동으로 누른 것을 막았거나 로그인이 필요)', action: '작성자 이름 옆 팔로우 단추를 직접 눌러 주세요. 로그인 상태도 확인하세요.' } });
    }, 4500);
  }

  // 팔로우·차단·좋아요 버튼 결과 알림(성공·실패 단계/원인/조치)
  function actToast(what, r) {
    if (!r) return;
    const who = r.who ? ` ${r.who}` : '';
    if (r.custom) return followToast({ custom: r.custom });
    if (r.error) {
      const e = r.error;
      return followToast({ custom: `${what} 실패${who}\n단계: ${e.step || what}\n원인: ${e.reason || e}\n조치: ${e.action || '페이지를 새로고침한 뒤 다시 누르세요.'}`, err: true });
    }
    followToast({ custom: `${what}:${who} ${r.already ? '이미 되어 있습니다' : '완료했습니다'}` });
  }
  // 차단: X·블루스카이는 각 도구(x-tools / bsky-tools)가, 인스타그램은 인스타 웹 요청으로. 그 밖의 사이트는 안내
  function blockAuthor(el) {
    const detail = { el, handled: false, report: (r) => actToast('차단', r) };
    document.dispatchEvent(new CustomEvent('smd:block', { detail }));
    if (detail.handled) return;
    if (adapter.id === 'instagram') return igBlock(el).then((r) => actToast('차단', r), (err) => actToast('차단', { error: { step: '차단 요청', reason: String(err?.message || err) } }));
    actToast('차단', { error: { step: '차단 지원 확인', reason: `${adapter.name || '이 사이트'}에서는 아직 차단 버튼을 지원하지 않습니다 (지원: X·블루스카이·인스타그램)`, action: '작성자 프로필의 ⋯ 메뉴에서 직접 차단하세요.' } });
  }
  async function igBlock(el) {
    const handle = postAuthor(el, {}).handle;
    if (!handle) return { error: { step: '작성자 찾기', reason: '이 게시물의 작성자를 찾지 못했습니다', action: '게시물을 눌러 연 화면에서 다시 누르세요.' } };
    const who = `@${handle}`;
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1];
    const me = (document.cookie.match(/(?:^|; )ds_user_id=([^;]+)/) || [])[1];
    if (!csrf || !me) return { who, error: { step: '로그인 확인', reason: '인스타그램 로그인 정보를 찾지 못했습니다', action: '인스타그램에 로그인한 뒤 새로고침(F5)하세요.' } };
    const H = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' };
    let id = SITES.igUsers?.get(handle.toLowerCase())?.id;
    if (!id) {
      const r = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, { headers: H, credentials: 'include' }).catch(() => null);
      if (!r?.ok) return { who, error: { step: '작성자 정보 확인', reason: `인스타그램이 작성자 정보를 주지 않았습니다 (HTTP ${r?.status || '연결 실패'})`, action: r?.status === 429 ? '몇 분 뒤 다시 누르세요.' : '작성자 프로필에서 직접 차단하세요.' } };
      id = (await r.json().catch(() => ({})))?.data?.user?.id;
    }
    if (!id) return { who, error: { step: '작성자 정보 확인', reason: '작성자 계정 번호를 찾지 못했습니다', action: '작성자 프로필에서 직접 차단하세요.' } };
    if (String(id) === String(me)) return { who, error: { step: '작성자 확인', reason: '내 계정은 차단할 수 없습니다', action: '' } };
    const r2 = await fetch(`/api/v1/friendships/block/${id}/`, { method: 'POST', credentials: 'include', headers: { ...H, 'X-CSRFToken': decodeURIComponent(csrf), 'content-type': 'application/x-www-form-urlencoded' }, body: `user_id=${id}&surface=profile` }).catch(() => null);
    const j = r2 ? await r2.json().catch(() => ({})) : {};
    if (r2?.ok && j.status === 'ok') return { who, ok: true };
    return { who, error: { step: '차단 요청', reason: `인스타그램이 차단을 받아들이지 않았습니다 (HTTP ${r2?.status || '연결 실패'}${j.message ? ` · ${j.message}` : ''})`, action: '작성자 프로필의 ⋯ 메뉴에서 직접 차단하세요.' } };
  }

  // 유튜브: @아이디 → 채널 번호(resolve_url) → 구독(subscription/subscribe). 로그인 쿠키로 만든 인증 값은 요청에만 쓰고 저장·기록하지 않는다
  async function ytSubscribe(handle) {
    const who = `@${handle}`;
    const sap = (document.cookie.match(/(?:^|; )(?:SAPISID|__Secure-3PAPISID)=([^;]+)/) || [])[1];
    if (!sap) return { who, error: { step: '로그인 확인', reason: '유튜브 로그인 정보를 찾지 못했습니다', action: '유튜브에 로그인한 뒤 새로고침(F5)하세요.' } };
    const ts = Math.floor(Date.now() / 1000);
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sap} ${location.origin}`));
    const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const headers = { 'content-type': 'application/json', authorization: `SAPISIDHASH ${ts}_${hash}`, 'x-origin': location.origin, 'x-goog-authuser': '0' };
    const context = { client: { clientName: 'WEB', clientVersion: '2.20250925.01.00', hl: 'ko', gl: 'KR' } };
    const post = async (path, body, step) => {
      let r;
      try {
        r = await fetch(`/youtubei/v1/${path}?prettyPrint=false`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ context, ...body }) });
      } catch (err) {
        throw { step, reason: `유튜브에 연결하지 못했습니다 (${err?.message || err})`, action: '인터넷 연결을 확인한 뒤 다시 시도하세요.' };
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw { step, reason: `유튜브가 요청을 받아들이지 않았습니다 (HTTP ${r.status}${j.error?.message ? ` · ${j.error.message}` : ''})`, action: r.status === 401 || r.status === 403 ? '유튜브에 다시 로그인한 뒤 새로고침(F5)하세요.' : '채널 화면에서 구독 단추를 직접 누르세요.' };
      return j;
    };
    try {
      const j = await post('navigation/resolve_url', { url: `https://www.youtube.com/@${handle}` }, '채널 찾기');
      const id = j?.endpoint?.browseEndpoint?.browseId || '';
      if (!/^UC[\w-]{20,}$/.test(id)) return { who, error: { step: '채널 찾기', reason: `@${handle} 의 채널 번호를 찾지 못했습니다`, action: '채널 화면에서 구독 단추를 직접 누르세요.' } };
      await post('subscription/subscribe', { channelIds: [id] }, '구독 요청');
      return { who, ok: true };
    } catch (err) {
      return { who, error: err?.step ? err : { step: '구독 요청', reason: String(err?.message || err), action: '채널 화면에서 구독 단추를 직접 누르세요.' } };
    }
  }

  function autoFollow(el, force = false) {
    if (settings.autoFollow === false && !force) return;
    const detail = { el, handled: false, report: followToast };
    document.dispatchEvent(new CustomEvent('smd:auto-follow', { detail }));
    if (detail.handled || NO_DOM_FOLLOW.has(adapter.id)) return;
    if (adapter.id === 'youtube') {
      // ① 화면의 구독 단추 ② 단추가 없으면(홈 목록·검색 등) 유튜브 웹이 쓰는 구독 요청으로
      domFollow(el, (res) => {
        if (!res.error || res.error.step !== '팔로우 단추 찾기') return followToast(res);
        let handle = '';
        try {
          handle = postAuthor(el, {}).handle || '';
        } catch {}
        if (!handle) return followToast(res);
        ytSubscribe(handle).then(followToast, (err) => followToast({ who: `@${handle}`, error: { step: '구독 요청', reason: String(err?.message || err), action: '채널 화면에서 구독 단추를 직접 누르세요.' } }));
      });
      return;
    }
    if (adapter.id === 'instagram') {
      // ① 페이지 데이터에 계정 번호가 있으면 인스타 웹 요청 ② 없으면 화면 팔로우 단추 ③ 단추도 못 찾으면 계정 번호를 물어봐서 요청
      const viaLookup = (res) => igFollow(el, true).then((r2) => followToast(r2 || res), () => followToast(res));
      igFollow(el, false).then(
        (r) => (r ? followToast(r) : domFollow(el, (res) => (res.error && res.error.step === '팔로우 단추 찾기' ? viaLookup(res) : followToast(res)))),
        () => domFollow(el, followToast),
      );
      return;
    }
    domFollow(el, followToast);
  }

  // 떠 있는 팔로우 버튼(float-tools.js): 설정과 관계없이 지금 보이는 게시물 작성자를 팔로우
  globalThis.__SMD_FOLLOW_NOW = (el) => autoFollow(el, true);
  globalThis.__SMD_SITE_ID = adapter.id;
  globalThis.__SMD_POST_SEL = POST_SEL;

  async function start(entry) {
    const video = entry.el;
    closePanel(entry);
    entry.lastError = null;
    entry.dlKey = keyFor(entry) || null; // 누른 순간의 영상(다음 영상으로 넘어가도 이 영상으로 기록)
    entry.staleResolve = false;
    setLook(entry, 'resolving', '분석 중…');
    let req;
    try {
      req = await (entry.kind === 'image' ? SITES.imageRequest(video) : adapter.resolve(video, ctx));
    } catch (err) {
      return showError(entry, {
        step: err.step || (entry.kind === 'image' ? '사진 정보 찾기' : '영상 정보 찾기'),
        reason: err.reason || `영상 정보를 읽는 중 오류가 발생했습니다: ${err.message || err}`,
        action: err.action || '페이지를 새로고침한 뒤 다시 시도하세요.',
      });
    }
    req.force = !!entry.force; // '다시 받기'를 누른 경우 중복이어도 받는다
    entry.force = false;
    req.site = adapter.id;
    req.siteName = adapter.name;
    req.pageUrl = location.href;
    req.duration = Number.isFinite(video.duration) ? video.duration : 0;
    req.kind = entry.kind;
    if (!entry.ai && (U.aiFlag(req.info || {}) || req.info?.item?.ai || req.info?.media?.ai || req.info?.aweme?.ai || req.info?.note?.ai)) {
      entry.ai = true;
      if (entry.kind === 'image') entry.badge.textContent = 'AI 이미지';
    }
    req.ai = !!entry.ai;
    req.captionText = feedText(video, req.title).slice(0, 1000);
    try {
      const au = postAuthor(video, req);
      req.authorName = au.name;
      req.authorHandle = au.handle;
    } catch {}
    req.title = U.cleanTitle(req.title);
    // 클릭한 순간의 화면을 찍어 둔다. 버튼은 잠깐 숨긴다.
    //  ① 피드 본문 글 캡처를 사진·영상 빈 공간에 붙이기
    //  ②·③ 게시물 전체 캡처를 표지·인트로로
    const wantPost = entry.kind === 'video' && (settings.captionCover || settings.captionIntro);
    // ① 은 화면을 찍지 않고 글자만 쓴다(본문은 req.captionText). ②·③ 만 게시물 화면을 찍는다.
    if (wantPost) {
      await hideButtonsForShot(true);
      req.shot = postRect(video);
      if (!req.shot) hideButtonsForShot(false);
    }
    const undoShot = () => {
      if (!req.shot) return;
      hideButtonsForShot(false);
    };
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'smd:download', request: req });
    } catch (err) {
      undoShot();
      return showError(entry, {
        step: '확장프로그램 연결',
        reason: `확장프로그램 백그라운드와 연결이 끊겼습니다 (${err?.message || err}). 확장프로그램이 업데이트되었거나 다시 시작된 경우입니다.`,
        action: '페이지를 새로고침(F5)한 뒤 다시 시도하세요.',
      });
    }
    undoShot();
    if (!res || res.error) return showError(entry, res?.error || { step: '다운로드 요청', reason: '백그라운드가 응답하지 않았습니다.', action: '페이지를 새로고침한 뒤 다시 시도하세요.' });
    if (entry.staleResolve) {
      // 분석하는 사이 다음 영상으로 넘어감: 작업은 계속 받고 버튼은 새 영상용으로 비워 둔다
      entry.staleResolve = false;
      jobs.set(res.jobId, { ghost: true, kind: entry.kind, dlKey: entry.dlKey, lastMsg: Date.now() });
      entry.dlKey = null;
      setLook(entry, 'idle');
      return;
    }
    entry.jobId = res.jobId;
    entry.lastMsg = Date.now();
    jobs.set(res.jobId, entry);
    setLook(entry, 'busy', '준비 중…', null);
    // 다운로드 요청이 백그라운드로 넘어간 뒤에 자동 팔로우(사이트 버튼이 창을 열거나 페이지를 옮겨도 다운로드는 계속됨)
    setTimeout(() => {
      try {
        autoFollow(video);
      } catch {}
    }, 0);
  }

  const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

  // 진행 소식이 끊긴 작업 확인(백그라운드가 재시작된 경우 버튼이 '진행 중'으로 멈추지 않게)
  setInterval(async () => {
    if (!alive()) return;
    for (const [jobId, entry] of jobs) {
      if (entry.ghost || entry.state !== 'busy' || Date.now() - (entry.lastMsg || 0) < 40000) continue;
      entry.lastMsg = Date.now();
      const j = await chrome.runtime.sendMessage({ type: 'smd:job-status', jobId }).catch(() => undefined);
      if (j === null || j === undefined) {
        showError(entry, { step: '진행 상태 확인', reason: '확장프로그램 백그라운드가 다시 시작되어 진행 중이던 다운로드가 중단됐습니다.', action: '다시 시도를 누르세요.' });
      } else if (j.state === 'error' || j.state === 'canceled') {
        showError(entry, j.error);
      }
    }
  }, 15000);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'smd:progress') {
      const entry = jobs.get(msg.job?.id);
      if (!entry) return;
      entry.lastMsg = Date.now();
      const j = msg.job;
      if (entry.ghost) {
        // 다음 영상으로 넘어가 버튼에서 떼어 낸 작업: 화면 버튼은 건드리지 않고 기록만(실패 내용은 팝업 '최근 다운로드'에 단계·원인·조치로 남음)
        if (j.state === 'done') markDownloaded(entry);
        if (j.state === 'done' || j.state === 'error' || j.state === 'canceled') jobs.delete(j.id);
        return;
      }
      if (j.state === 'done') {
        // 완료 창은 띄우지 않고 버튼만 잠깐 '저장 완료'로 바꾼다.
        setLook(entry, 'done', '저장 완료');
        markDownloaded(entry);
        setTimeout(() => entry.state === 'done' && setLook(entry, 'idle'), 3000);
      } else if (j.state === 'error') {
        showError(entry, j.error);
      } else {
        const q = j.quality ? `${j.quality} · ` : '';
        const label =
          j.phase === 'resolve' ? '원본 찾는 중…'
          : j.phase === 'queue' ? '대기 중…'
          : j.phase === 'caption' ? `피드 내용 넣는 중 ${Math.floor(j.percent || 0)}%`
          : j.phase === 'encode' ? `H.264·AAC 변환 중 ${Math.floor(j.percent || 0)}%`
          : j.phase === 'mux' ? `${q}합치는 중 ${Math.floor(j.percent || 0)}%`
          : j.phase === 'save' ? '저장 중…'
          : j.percent != null ? `${q}${Math.floor(j.percent)}%`
          : j.bytes ? `${q}${fmtBytes(j.bytes)}`
          : '준비 중…';
        setLook(entry, 'busy', label, j.phase === 'resolve' ? null : j.percent);
      }
      return;
    }
    if (msg?.type === 'smd:play-ready') {
      const note = globalThis.__SMD_FOLLOW_TOAST;
      if (msg.error) note?.({ error: msg.error });
      else if (msg.opened) note?.({ custom: '받은 원본을 팟플레이어(기본 재생 프로그램)로 열었습니다.' });
      else note?.({ custom: `팟플레이어용 파일을 받았습니다: 다운로드/팟플레이어 재생\n웨일 다운로드 목록에서 그 파일을 누르면 열립니다.\n처음 한 번만: 그 파일을 마우스 오른쪽 버튼으로 눌러 '이 형식의 파일 항상 열기'를 켜 두면 다음부터 받자마자 자동으로 열립니다.` });
      return;
    }
    if (msg?.type === 'smd:edit-placement') {
      enterEdit();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'smd:images-info') {
      sendResponse({ count: allImages().length });
      return;
    }
    if (msg?.type === 'smd:save-all-images') {
      saveAllImages().then((n) => sendResponse({ started: n }));
      return true;
    }
    if (msg?.type === 'smd:list') {
      sendResponse(listVideos());
      return;
    }
    if (msg?.type === 'smd:start') {
      for (const entry of tracked.values()) {
        if (entry.key === msg.key) {
          start(entry);
          sendResponse({ ok: true });
          return;
        }
      }
      sendResponse({ ok: false });
    }
  });

  // ───────────── 사진 확대 보기에서 사진을 누르면 닫기 (X 는 전용 처리, 그 밖의 사이트는 확대 창·게시물 창 공용 처리) ─────────────
  if (adapter.id !== 'x' && window.top === window) {
    document.addEventListener(
      'click',
      (ev) => {
        if (settings.xPhotoTapClose !== true) return;
        const t = ev.target;
        if (!(t instanceof HTMLImageElement) || ev.composedPath().some((n) => /^SMD-/.test(n?.tagName || ''))) return;
        const modal = t.closest('[aria-modal="true"], [role="dialog"]');
        if (!modal) return;
        // 확대된 큰 사진만(목록 창의 프로필 사진·작은 그림은 제외)
        const r = t.getBoundingClientRect();
        if (r.width * r.height < innerWidth * innerHeight * 0.12) return;
        ev.preventDefault();
        ev.stopPropagation();
        const close = [...modal.querySelectorAll('[aria-label="Close"], [aria-label="close"], [aria-label="닫기"], [aria-label="关闭"], [aria-label="閉じる"], [data-testid*="close" i]')].find((b) => b.getBoundingClientRect().width > 0) ||
          [...document.querySelectorAll('[aria-label="Close"], [aria-label="닫기"], [aria-label="关闭"]')].find((b) => b.getBoundingClientRect().width > 0 && !b.closest('smd-float'));
        if (close) (close.closest('button, [role="button"]') || close).click();
        else {
          const k = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
          (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', k));
          document.dispatchEvent(new KeyboardEvent('keydown', k));
        }
        setTimeout(() => {
          if (modal.isConnected && modal.getBoundingClientRect().width > 0) followToast({ error: { step: '사진 확대 창 닫기', reason: '닫기 단추를 찾지 못했고 Esc 키로도 창이 닫히지 않았습니다', action: '창 바깥이나 닫기(X) 단추를 직접 누르세요. 이 사이트에서 계속 안 되면 팝업 \'이 사이트\'에서 \'사진 누르면 닫기\'를 끄세요.' } });
        }, 600);
      },
      true,
    );
  }
  if (adapter.id === 'x') {
    document.addEventListener(
      'click',
      (ev) => {
        if (settings.xPhotoTapClose === false || !/\/photo\/\d+/.test(location.pathname)) return;
        const t = ev.target;
        // 저장 버튼(smd-anchor)을 누른 경우에는 확대 창을 닫지 않는다
        if (ev.composedPath().some((n) => n?.tagName === 'SMD-ANCHOR')) return;
        if (!(t instanceof HTMLImageElement) && !t.closest?.('[data-testid="swipe-to-dismiss"]')) return;
        const modal = t.closest('[aria-modal="true"], [role="dialog"]');
        if (!modal) return;
        ev.preventDefault();
        ev.stopPropagation();
        // X 가 사진 탭으로 스스로 닫는 경우도 있다 → 잠깐 기다렸다가 아직 열려 있을 때만 닫는다(뒤로가기 두 번 방지)
        const href = location.href;
        setTimeout(() => {
          if (location.href !== href || !/\/photo\/\d+/.test(location.pathname) || !modal.isConnected) return;
          const close = modal.querySelector('[data-testid="app-bar-close"], [aria-label="Close"], [aria-label="닫기"]') || document.querySelector('[data-testid="app-bar-close"]');
          if (close) close.click();
          else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }, 180);
      },
      true,
    );
  }

  // ───────────── 버튼 직접 배치 모드 ─────────────
  let editMode = false;
  let editTemp = null;
  let toolbar = null;
  function enterEdit() {
    if (editMode) return;
    editMode = true;
    editTemp = { video: settings.placements?.[adapter.id] || null, image: settings.imagePlacements?.[adapter.id] || null };
    toolbar = document.createElement('smd-toolbar');
    toolbar.setAttribute('style', 'all:initial;position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;display:block');
    const sh = toolbar.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      .bar{display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;border-radius:14px;background:rgba(21,21,33,.96);color:#f3f3f8;
        font:600 13px/1.4 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;box-shadow:0 18px 50px -12px rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.1)}
      button{all:unset;cursor:pointer;padding:8px 13px;border-radius:10px;font:700 12.5px/1 inherit;background:rgba(255,255,255,.1);color:#fff}
      button:hover{background:rgba(255,255,255,.18)} .pri{background:linear-gradient(135deg,#5b5cff,#9b4dff 55%,#ff4f8b)}
    </style><div class="bar"><span>영상·사진 버튼을 끌어서 원하는 위치에 놓고 <b>저장</b>을 누르세요</span>
      <button data-a="reset">기본 위치</button><button data-a="cancel">취소</button><button class="pri" data-a="save">저장</button></div>`;
    sh.addEventListener('click', async (ev) => {
      const a = ev.target.closest('button')?.dataset.a;
      if (!a) return;
      if (a === 'reset') {
        editTemp = { video: null, image: null };
        return place();
      }
      if (a === 'save') {
        const r = await chrome.storage.local.get('settings');
        const cur = r.settings || {};
        const placements = { ...(cur.placements || {}) };
        const imagePlacements = { ...(cur.imagePlacements || {}) };
        if (editTemp.video) placements[adapter.id] = editTemp.video;
        else delete placements[adapter.id];
        if (editTemp.image) imagePlacements[adapter.id] = editTemp.image;
        else delete imagePlacements[adapter.id];
        await chrome.storage.local.set({ settings: { ...cur, placements, imagePlacements } });
        settings.placements = placements;
        settings.imagePlacements = imagePlacements;
      }
      exitEdit();
    });
    document.documentElement.appendChild(toolbar);
    place();
  }
  function exitEdit() {
    editMode = false;
    editTemp = null;
    toolbar?.remove();
    toolbar = null;
    place();
  }

  // ───────────── 페이지의 사진 전부 저장 ─────────────
  function allImages() {
    const seen = new Set();
    const out = [];
    const vids = videoRects();
    for (const img of document.images) {
      if (img.closest('smd-anchor')) continue;
      if (onVideo(img, vids)) continue;
      if ((img.naturalWidth || 0) < 200 || (img.naturalHeight || 0) < 150) continue;
      const key = SITES.originalImageUrls(img)[0];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(img);
    }
    return out;
  }
  async function saveAllImages() {
    const imgs = allImages().slice(0, 300);
    const page = U.cleanTitle(U.metaTitle()).slice(0, 50);
    let started = 0;
    for (let i = 0; i < imgs.length; i++) {
      try {
        const req = await SITES.imageRequest(imgs[i]);
        Object.assign(req, { site: adapter.id, siteName: adapter.name, pageUrl: location.href, kind: 'image', id: String(i + 1).padStart(3, '0'), title: adapter.id === 'bluesky' ? req.title : `${page} 사진` });
        const res = await chrome.runtime.sendMessage({ type: 'smd:download', request: req });
        if (res?.jobId) started++;
      } catch {}
    }
    return started;
  }

  function listVideos() {
    const out = [];
    for (const e of tracked.values()) {
      if (e.kind !== 'video') continue;
      const v = e.el;
      if (!v.isConnected) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      out.push({
        key: e.key,
        site: adapter.id,
        siteName: adapter.name,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        poster: v.poster || '',
        visible: !!e.visible,
        state: e.state,
      });
    }
    return out;
  }

  // ───────────── 영상·사진 찾기 & 버튼 위치 ─────────────
  function collectVideos(root, out, depth = 0) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    if (depth > 1) return;
    if (adapter.id === 'generic') {
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) collectVideos(el.shadowRoot, out, depth + 1);
    }
  }

  const imagesOn = () => settings.imageButtons !== false && enabled();
  // 영상 위에 겹친 썸네일·포스터 이미지는 사진이 아니다(영상에는 다운로드 버튼만)
  function videoRects() {
    const out = [];
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) out.push({ v, r });
    }
    return out;
  }
  function onVideo(img, vids) {
    const r = img.getBoundingClientRect();
    const area = Math.max(1, r.width * r.height);
    for (const { v, r: vr } of vids) {
      const w = Math.min(r.right, vr.right) - Math.max(r.left, vr.left);
      const h = Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top);
      if (w > 0 && h > 0 && (w * h) / area > 0.3) return true;
    }
    // 같은 플레이어 안의 이미지(영상 재생 전 썸네일) — 가까운 조상에 영상이 있으면 제외
    let p = img.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) {
      // 페이지 전체나 사진보다 훨씬 큰 묶음까지 올라가면 다른 게시물의 영상이므로 멈춘다
      if (p === document.body || p === document.documentElement) break;
      const pr = p.getBoundingClientRect();
      if (pr.width * pr.height > area * 3) break;
      if (p.querySelector('video')) return true;
      if (p.querySelectorAll('img').length > 1) break;
    }
    return /video_thumb|_video_thumb|videothumb/.test(img.currentSrc || img.src || '');
  }
  // 댓글·답글 칸 안의 사진·영상(댓글 이모티콘·첨부 그림 등)에는 버튼을 띄우지 않는다 — 게시물 본문 사진·영상만
  const COMMENT_RE = /comment|reply|replies|댓글|评论|評論/i;
  //   게시물 전체를 감싼 큰 묶음(영상이 들어 있거나 화면보다 큰 것)까지 올라가면 멈춘다 — 틱톡처럼 영상·댓글을 함께 감싼
  //   묶음 이름에 'comment' 가 들어 있어도 본문 영상·사진을 댓글로 잘못 보지 않게
  function inComment(el, depth = 12) {
    for (let p = el.parentElement, i = 0; p && p !== document.body && i < depth; p = p.parentElement, i++) {
      if (p !== el.parentElement && el.tagName !== 'VIDEO' && p.querySelector('video')) return false;
      const r = p.getBoundingClientRect();
      if (r.height > innerHeight * 1.2 || r.width > innerWidth * 0.9) return false;
      const tags = `${p.id || ''} ${typeof p.className === 'string' ? p.className : ''} ${p.getAttribute('data-e2e') || ''} ${p.getAttribute('aria-label') || ''}`;
      if (COMMENT_RE.test(tags)) return true;
    }
    return false;
  }
  // 실제로 화면에 보이는 사진인가: 카드에 잘려 거의 안 보이거나(넘김 사진의 옆 장), 다른 사진 뒤에 깔려 있으면(흐린 배경 그림) 버튼을 띄우지 않는다
  function shownImage(img, r) {
    const c = clipRect(img, img.__smdClip || (img.__smdClip = {}), performance.now());
    if (c.hidden) return false;
    const vis = Math.max(0, Math.min(c.right, innerWidth) - Math.max(c.left, 0)) * Math.max(0, Math.min(c.bottom, innerHeight) - Math.max(c.top, 0));
    const full = Math.max(1, Math.min(r.width * r.height, innerWidth * innerHeight));
    if (vis / full < 0.35 || vis < 120 * 100) return false;
    const x = (Math.max(c.left, 0) + Math.min(c.right, innerWidth)) / 2;
    const y = (Math.max(c.top, 0) + Math.min(c.bottom, innerHeight)) / 2;
    const top = document.elementFromPoint(x, y);
    if (!top) return false;
    if (top === img || img.contains(top) || top.closest?.('smd-anchor, smd-toast, smd-followall')) return true;
    // 사진 위에 덮인 투명 막(인스타·틱톡 등)은 괜찮지만, 다른 사진·영상에 가려진 것은 아니다
    if (top.tagName === 'IMG' || top.tagName === 'VIDEO' || top.tagName === 'CANVAS') return false;
    for (let p = img.parentElement, i = 0; p && i < 4 && p !== document.body; p = p.parentElement, i++) {
      const pr = p.getBoundingClientRect();
      if (pr.width * pr.height > r.width * r.height * 3) break; // 사진보다 훨씬 큰 묶음이면 다른 것
      if (p.contains(top)) return true;
    }
    return false;
  }
  function collectImages(out) {
    if (!imagesOn()) return;
    const vids = videoRects();
    // 싼 검사(원본 크기·화면 안)부터 하고, 비싼 검사(영상 위 썸네일·댓글·가려짐)는 남은 사진에만
    const vis = globalThis.__SMD_PERF?.visible;
    for (const img of vis ? [...vis].filter((x) => x.tagName === 'IMG') : document.images) {
      if ((img.naturalWidth || 0) < 200 || (img.naturalHeight || 0) < 150) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 120 || r.height < 100) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; // 화면에 보이는 사진만(스크롤하면 다시 찾음)
      if (img.closest('smd-anchor')) continue;
      if (onVideo(img, vids)) continue;
      if (inComment(img) || !shownImage(img, r)) continue;
      out.push(img);
    }
  }

  function track(el, kind) {
    const entry = { el, video: el, kind, key: `${kind[0]}${++videoSeq}`, state: 'idle', visible: false, measured: 0 };
    makeAnchor(entry);
    entry.btn = makeButton(entry);
    if (kind === 'video') entry.ident = keyFor(entry);
    setLook(entry, 'idle'); // 이미 받은 적 있으면 초록 체크로
    tracked.set(el, entry);
  }

  // 같은 영상 요소가 다음 영상으로 바뀐 경우(유튜브 쇼츠·시청 화면 등): 버튼을 새 영상 기준으로 되돌린다.
  //   진행 중이던 다운로드는 버튼에서 떼어 계속 받고, 끝나면 이전 영상으로 '받은 적 있음'에 기록한다.
  function refreshIdentity(entry) {
    if (entry.kind !== 'video') return;
    const now = keyFor(entry);
    if (now === entry.ident) return;
    entry.ident = now;
    if (entry.jobId && jobs.get(entry.jobId) === entry) {
      jobs.set(entry.jobId, { ghost: true, kind: entry.kind, dlKey: entry.dlKey, lastMsg: Date.now() });
    }
    entry.jobId = null;
    entry.dlKey = null;
    entry.lastError = null;
    entry.force = false;
    closePanel(entry);
    if (entry.state !== 'resolving') setLook(entry, 'idle');
    else entry.staleResolve = true;
  }
  addEventListener('yt-navigate-finish', () => setTimeout(() => tracked.forEach(refreshIdentity), 50));
  document.addEventListener('loadstart', (ev) => {
    const e = tracked.get(ev.target);
    if (e) setTimeout(() => refreshIdentity(e), 50);
  }, true);

  // 영상 칸 중 아직 보이는 <video> 가 없고 표지 사진만 있는 것(X 재생 전)
  function videoPosterBoxes() {
    const out = [];
    for (const box of document.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]')) {
      if (box.parentElement?.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]')) continue; // 바깥 칸 하나만
      const v = box.querySelector('video');
      if (v) {
        const r = v.getBoundingClientRect();
        if (r.width >= 140 && r.height >= 100 && getComputedStyle(v).visibility !== 'hidden' && Number(getComputedStyle(v).opacity) > 0) continue;
      }
      const r = box.getBoundingClientRect();
      if (r.width < 140 || r.height < 100 || r.bottom < 0 || r.top > innerHeight) continue;
      out.push(box);
    }
    return out;
  }
  function scan() {
    const vids = [];
    collectVideos(document, vids);
    const imgs = [];
    collectImages(imgs);
    // 댓글 칸 안의 영상(댓글 첨부 움짤 등)도 제외
    for (let i = vids.length - 1; i >= 0; i--) if (inComment(vids[i], 5)) vids.splice(i, 1);
    // X: 재생 전(자동재생 끄기 등)에는 <video> 없이 표지 사진(video_thumb)만 있다 → 영상 칸에 영상 다운로드 버튼
    if (adapter.id === 'x') for (const box of videoPosterBoxes()) if (!vids.includes(box)) vids.push(box);
    const set = new Set([...vids, ...imgs]);
    for (const v of vids) if (!tracked.has(v)) track(v, 'video');
    for (const e of tracked.values()) refreshIdentity(e);
    for (const im of imgs) if (!tracked.has(im)) track(im, 'image');
    for (const [el, e] of tracked) {
      const keepImage = e.kind === 'image' && e.state !== 'idle';
      if ((!set.has(el) && !keepImage) || !el.isConnected) {
        e.host.remove();
        tracked.delete(el);
      }
    }
    reportVideos();
  }

  let lastReport = '';
  function reportVideos() {
    const list = listVideos().map((v) => `${v.key}:${v.width}x${v.height}:${v.state}`).join('|');
    if (list === lastReport) return;
    lastReport = list;
    const count = [...tracked.values()].filter((e) => e.kind === 'video').length;
    chrome.runtime.sendMessage({ type: 'smd:videos', count, site: adapter.id }).catch(() => {});
  }

  let sniffCount = 0;
  async function refreshSniff() {
    if (adapter.id !== 'generic' || !tracked.size) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'smd:sniff-count' });
      sniffCount = r?.count || 0;
    } catch {}
  }
  setInterval(refreshSniff, 3000);

  function offsetFor(video) {
    const o = typeof adapter.offset === 'function' ? adapter.offset(video) : adapter.offset;
    return Number(o) || 56;
  }

  function hasSource(v) {
    if (adapter.id !== 'generic') return true;
    const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    // 저장 버튼 항상 표시: 재생 전이라도 영상 주소나 미리보기 그림이 있으면 버튼을 띄운다
    if (settings.alwaysShowButtons !== false && (/^https?:/.test(src) || v.getAttribute('poster'))) return true;
    return /^https?:/.test(src) || sniffCount > 0;
  }

  // 사진 버튼은 '저장 버튼 항상 표시'를 끄면 마우스가 사진 위에 있을 때만 보인다.
  let pointer = { x: -1, y: -1 };
  document.addEventListener('pointermove', (e) => (pointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
  const pointerIn = (r) => pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;

  // 버튼 위치: 직접 배치한 위치(사이트별) > 설정한 위치(기본: 오른쪽 가운데). 사진은 오른쪽 아래.
  // 화면에 실제로 보이는 사각형: overflow 로 잘라내는 조상(카드 등)과 겹치는 부분. 조상 찾기는 0.6초마다만.
  function clipRect(v, entry, now) {
    const r = v.getBoundingClientRect();
    if (!entry.clipAt || now - entry.clipAt > 600) {
      entry.clipAt = now;
      entry.clippers = [];
      for (let p = v.parentElement, i = 0; p && p !== document.body && p !== document.documentElement && i < 10; p = p.parentElement, i++) {
        const cs = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) entry.clippers.push(p);
      }
    }
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    for (const p of entry.clippers) {
      const c = p.getBoundingClientRect();
      if (c.width < 40 || c.height < 40) continue;
      left = Math.max(left, c.left);
      top = Math.max(top, c.top);
      right = Math.min(right, c.right);
      bottom = Math.min(bottom, c.bottom);
    }
    // 카드 밖으로 완전히 밀려난 경우(넘김 사진의 옆 장 등): 버튼 위치는 원래 사각형으로 두되 '보이지 않음' 표시
    if (right - left < 40 || bottom - top < 40) return Object.assign({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, x: r.x, y: r.y }, { hidden: true });
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top };
  }

  function buttonSpot(entry, r, bw, bh) {
    const clamp = (x, y) => ({
      x: Math.max(r.left + 4, Math.min(x, r.right - bw - 4)),
      y: Math.max(r.top + 4, Math.min(y, r.bottom - bh - 4)),
    });
    const midY = r.top + (r.height - bh) / 2;
    if (entry.kind === 'image') {
      const ci = editMode ? editTemp.image : settings.imagePlacements?.[adapter.id];
      if (ci) return clamp(r.left + ci.fx * r.width - bw / 2, r.top + ci.fy * r.height - bh / 2);
      // 기본: 오른쪽, 영상 버튼 자리(가운데)보다 약간 아래 → 영상 버튼과 겹치지 않음
      return clamp(r.right - bw - 12, midY + bh + 14);
    }
    const custom = editMode ? editTemp.video : settings.placements?.[adapter.id];
    if (custom) return clamp(r.left + custom.fx * r.width - bw / 2, r.top + custom.fy * r.height - bh / 2);
    const bottom = r.bottom - Math.min(offsetFor(entry.el), Math.max(8, r.height * 0.25)) - bh;
    switch (settings.buttonPosition) {
      case 'bottom-right': return clamp(r.right - bw - 12, bottom);
      case 'bottom-center':
      case 'center': return clamp(r.left + (r.width - bw) / 2, bottom);
      case 'bottom-left':
      case 'left': return clamp(r.left + 12, bottom);
      case 'top-right': return clamp(r.right - bw - 12, r.top + 12);
      default: return clamp(r.right - bw - 12, midY); // 'mid-right' (오른쪽 가운데)
    }
  }

  function place() {
    const on = enabled() || editMode;
    const now = performance.now();
    for (const entry of tracked.values()) {
      const v = entry.el;
      const b = entry.btn;
      mountAnchor(entry);
      // 사진·영상이 카드보다 커서 일부가 잘려 보이는 경우(틱톡 사진 목록 등): 실제로 보이는 영역 안에 버튼을 둔다
      const r = clipRect(v, entry, now);
      const isImg = entry.kind === 'image';
      let show = on && (isImg ? r.width >= 120 && r.height >= 100 : r.width >= 140 && r.height >= 100 && hasSource(v));
      if (show && now - (entry.styleCheck || 0) > 600) {
        entry.styleCheck = now;
        const cs = getComputedStyle(v);
        // X 는 사진 위에 투명도 0 인 <img> 를 깔아 두므로 사진은 투명도로 숨김 판단을 하지 않는다.
        entry.hiddenStyle = cs.visibility === 'hidden' || cs.display === 'none' || (!isImg && Number(cs.opacity) === 0);
      }
      if (entry.hiddenStyle) show = false;
      const busy = entry.state !== 'idle';
      // 사진 버튼: '저장 버튼 항상 표시'를 켜면 마우스를 올리지 않아도 보인다(끄면 마우스를 올렸을 때만)
      const visible = show && (busy || editMode || !isImg || settings.alwaysShowButtons !== false || pointerIn(r) || pointerIn(b.getBoundingClientRect()));
      b.classList.toggle('edit', editMode);
      if (!visible) {
        if (entry.visible) {
          b.classList.remove('show');
          entry.visible = false;
        }
        entry.acts?.classList.remove('show');
        if (entry.panel && !show) closePanel(entry);
        continue;
      }
      b.classList.add('compact'); // 모든 버튼은 작은 원형 아이콘
      if (!entry.measured) {
        entry.w = b.offsetWidth || 120;
        entry.h = b.offsetHeight || 36;
        entry.measured = 1;
      }
      const bw = entry.w;
      const bh = entry.h;
      // 앵커(0,0)의 화면 위치 = 이 버튼들이 기준으로 삼는 좌표 원점
      const o = entry.host.getBoundingClientRect();
      let { x, y } = buttonSpot(entry, r, bw, bh);
      x -= o.left;
      y -= o.top;
      const tf = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
      if (entry.tf !== tf) {
        entry.tf = tf;
        b.style.transform = tf;
      }
      if (!entry.visible) b.classList.add('show');
      entry.visible = true;
      if (settings.aiLabel !== false && !entry.ai && (entry.aiCheck === undefined || now - entry.aiCheck > 5000)) {
        entry.aiCheck = now;
        entry.ai = aiInDom(entry);
        if (entry.ai && isImg) entry.badge.textContent = 'AI 이미지';
      }
      // 팔로우·차단·좋아요 줄: 다운로드 버튼 바로 아래(영상 아래쪽이 모자라면 위)
      if (entry.acts) {
        const want = settings.postActions !== false && !editMode;
        entry.acts.classList.toggle('show', want);
        if (want) {
          const ah = 26;
          const aw = entry.acts.offsetWidth || 170;
          let ay = y + bh + 6;
          if (ay + o.top + ah > r.bottom) ay = y - ah - 6;
          // 다운로드 버튼 오른쪽 끝에 맞추고, 사진·영상 왼쪽 밖으로는 나가지 않게
          const ax = Math.max(r.left - o.left + 4, x + bw - aw);
          const atf = `translate3d(${Math.round(ax)}px,${Math.round(ay)}px,0)`;
          if (entry.atf !== atf) {
            entry.atf = atf;
            entry.acts.style.transform = atf;
          }
        }
      }
      const showBadge = settings.aiLabel !== false && entry.ai && (!isImg || visible);
      entry.badge.classList.toggle('show', !!showBadge);
      if (showBadge) {
        const bw2 = entry.badge.offsetWidth || 60;
        entry.badge.style.transform = `translate3d(${Math.round(x - bw2 - 6)}px,${Math.round(y + (bh - 22) / 2)}px,0)`;
      }
      if (entry.panel) {
        const pw = 300;
        const ph = entry.panel.offsetHeight || 150;
        let px = Math.max(r.left - o.left + 4, x + bw - pw);
        let py = y - ph - 10;
        if (py + o.top < 4) py = y + bh + 10;
        entry.panel.style.transform = `translate3d(${Math.round(px)}px,${Math.round(py)}px,0)`;
      }
    }
  }

  let raf = 0;
  let lastPlace = 0;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const loop = (t) => {
    if (!alive()) {
      // 확장프로그램이 업데이트/재시작되어 이 스크립트는 더 이상 쓸 수 없다 → 화면에서 치운다.
      for (const e of tracked.values()) e.host.remove();
      return;
    }
    raf = requestAnimationFrame(loop);
    if (!tracked.size || document.hidden) return;
    if (t - lastPlace < 50) return;
    lastPlace = t;
    const PERF = globalThis.__SMD_PERF;
    PERF ? PERF.time('다운로드 버튼 위치 맞추기', place) : place();
  };

  const boot = () => {
    scan();
    // 화면이 바뀔 때 다시 찾기: 유튜브처럼 DOM 이 쉬지 않고 바뀌는 사이트에서 페이지를 느리게 하지 않게
    //   마지막 찾기에서 최소 0.7초 지난 뒤, 브라우저가 한가할 때(최대 1초 기다림)만 찾는다. 숨은 탭에서는 쉬기
    let pending = false;
    let lastScan = 0;
    const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 1000 }) : (fn) => setTimeout(fn, 50);
    const PERF = globalThis.__SMD_PERF;
    const runScan = () => {
      pending = false;
      if (document.hidden) return;
      // 유튜브가 다음 영상으로 넘어가는 중(재생목록·관련 영상을 다시 그림)에는 쉬었다가 끝난 뒤 찾는다
      if (PERF?.navigating()) return setTimeout(schedule, 300);
      lastScan = performance.now();
      PERF ? PERF.time('다운로드 버튼 찾기', scan) : scan();
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => idle(runScan), Math.max(0, 700 - (performance.now() - lastScan)));
    };
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(schedule, 1500);
    document.addEventListener('visibilitychange', () => !document.hidden && schedule());
    raf = requestAnimationFrame(loop);
  };
  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
