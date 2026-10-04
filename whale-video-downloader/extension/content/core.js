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
  const enabled = () =>
    settings.showButtons !== false &&
    !(settings.disabledSites || []).includes(adapter.id) &&
    (adapter.id !== 'generic' || settings.genericButtons !== false);

  chrome.storage.local.get('settings').then((r) => {
    settings = { ...DEFAULTS, ...(r.settings || {}) };
  }, () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
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
  function keyFor(entry) {
    const el = entry.el;
    if (entry.kind === 'image') return `img:${(SITES.originalImageUrls(el)[0] || '').split('#')[0]}`;
    const poster = el.getAttribute('poster') || '';
    const src = /^https?:/.test(el.currentSrc || '') ? el.currentSrc.split('?')[0] : '';
    const link = U.findLink(el, /\/(?:status|video|reel|reels|p|pin|short-video|explore|shorts)\/[\w-]+/)?.[0] || '';
    return `${adapter.id}:${link || poster.split('?')[0] || src || location.pathname}`;
  }
  async function markDownloaded(entry) {
    const k = keyFor(entry);
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
      const text = (box.innerText || '').slice(0, 4000);
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

  function setLook(entry, state, text, percent) {
    const b = entry.btn;
    entry.state = state;
    b.classList.remove('busy', 'spin', 'done', 'err');
    const ico = b.querySelector('.ico');
    const txt = b.querySelector('.txt');
    b.classList.remove('downloaded');
    if (state === 'idle') {
      const done = settings.downloadedMark !== false && downloaded.has(entry.dlKey || keyFor(entry));
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
    if (kind === 'e') {
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
      }
    });
    for (const t of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) p.addEventListener(t, (ev) => ev.stopPropagation());
    entry.layer.appendChild(p);
    entry.panel = p;
    entry.measured = 0;
    entry.panelKind = kind;
  }

  function showError(entry, err) {
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
  const FOLLOW_TEXT = /^(\+\s*)?(팔로우|팔로우하기|follow|구독|subscribe|关注|關注|フォロー)$/i;
  const NO_DOM_FOLLOW = new Set(['x', 'bluesky']);
  function autoFollow(el) {
    if (settings.autoFollow === false) return;
    const detail = { el, handled: false };
    document.dispatchEvent(new CustomEvent('smd:auto-follow', { detail }));
    if (detail.handled || NO_DOM_FOLLOW.has(adapter.id)) return;
    const vr = el.getBoundingClientRect();
    for (let p = el.parentElement, i = 0; p && p !== document.documentElement && i < 10; p = p.parentElement, i++) {
      if (p.getBoundingClientRect().height > Math.max(innerHeight * 2.5, vr.height * 4)) break;
      const btn = [...p.querySelectorAll('button, [role="button"], [data-e2e="follow-button"], [data-e2e="feed-follow"]')].find((b) => {
        // 다른 페이지로 옮기는 링크형 버튼은 누르지 않는다(로그인 화면 이동 등)
        if (b.closest('smd-anchor') || b.disabled || b.closest('a[href]')) return false;
        const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        const label = (b.getAttribute('aria-label') || '').trim();
        return FOLLOW_TEXT.test(t) || (!t && FOLLOW_TEXT.test(label));
      });
      if (btn) {
        btn.click();
        return;
      }
    }
  }

  async function start(entry) {
    const video = entry.el;
    closePanel(entry);
    entry.lastError = null;
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
      if (entry.state !== 'busy' || Date.now() - (entry.lastMsg || 0) < 40000) continue;
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
          : j.phase === 'mux' ? `${q}합치는 중 ${Math.floor(j.percent || 0)}%`
          : j.phase === 'save' ? '저장 중…'
          : j.percent != null ? `${q}${Math.floor(j.percent)}%`
          : j.bytes ? `${q}${fmtBytes(j.bytes)}`
          : '준비 중…';
        setLook(entry, 'busy', label, j.phase === 'resolve' ? null : j.percent);
      }
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

  // ───────────── X: 사진 확대 보기에서 사진을 누르면 닫기 ─────────────
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
        Object.assign(req, { site: adapter.id, siteName: adapter.name, pageUrl: location.href, kind: 'image', id: String(i + 1).padStart(3, '0'), title: `${page} 사진` });
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
      if (p.querySelector('video')) return true;
      if (p.querySelectorAll('img').length > 1) break;
    }
    return /video_thumb|_video_thumb|videothumb/.test(img.currentSrc || img.src || '');
  }
  function collectImages(out) {
    if (!imagesOn()) return;
    const vh = window.innerHeight;
    const vids = videoRects();
    for (const img of document.images) {
      if (img.closest('smd-anchor')) continue;
      if (onVideo(img, vids)) continue;
      if ((img.naturalWidth || 0) < 200 || (img.naturalHeight || 0) < 150) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 120 || r.height < 100) continue;
      if (r.bottom < -600 || r.top > vh + 600) continue; // 화면 근처 사진만
      out.push(img);
    }
  }

  function track(el, kind) {
    const entry = { el, video: el, kind, key: `${kind[0]}${++videoSeq}`, state: 'idle', visible: false, measured: 0 };
    makeAnchor(entry);
    entry.btn = makeButton(entry);
    setLook(entry, 'idle'); // 이미 받은 적 있으면 초록 체크로
    tracked.set(el, entry);
  }

  function scan() {
    const vids = [];
    collectVideos(document, vids);
    const imgs = [];
    collectImages(imgs);
    const set = new Set([...vids, ...imgs]);
    for (const v of vids) if (!tracked.has(v)) track(v, 'video');
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
    const src = v.currentSrc || v.src || '';
    return /^https?:/.test(src) || sniffCount > 0;
  }

  // 사진 버튼은 마우스가 사진 위에 있을 때만 보인다.
  let pointer = { x: -1, y: -1 };
  document.addEventListener('pointermove', (e) => (pointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
  const pointerIn = (r) => pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;

  // 버튼 위치: 직접 배치한 위치(사이트별) > 설정한 위치(기본: 오른쪽 가운데). 사진은 오른쪽 아래.
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
      const r = v.getBoundingClientRect();
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
      const visible = show && (busy || editMode || !isImg || pointerIn(r) || pointerIn(b.getBoundingClientRect()));
      b.classList.toggle('edit', editMode);
      if (!visible) {
        if (entry.visible) {
          b.classList.remove('show');
          entry.visible = false;
        }
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
      if (!entry.ai && now - (entry.aiCheck || 0) > 2000) {
        entry.aiCheck = now;
        entry.ai = aiInDom(entry);
        if (entry.ai && isImg) entry.badge.textContent = 'AI 이미지';
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
    place();
  };

  const boot = () => {
    scan();
    let pending = 0;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = 0;
        scan();
      }, 250);
    }).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 1500);
    raf = requestAnimationFrame(loop);
  };
  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
