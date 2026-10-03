// 화면의 모든 <video> 하단에 다운로드 버튼을 띄우고, 클릭 시 서비스워커에 다운로드를 요청한다.
(() => {
  'use strict';
  if (globalThis.__SMD_CORE) return;
  globalThis.__SMD_CORE = true;
  const SITES = globalThis.__SMD_SITES;
  if (!SITES || !chrome?.runtime?.id) return;
  const { pick, U } = SITES;
  const adapter = pick(location.hostname);

  const DEFAULTS = { showButtons: true, imageButtons: true, buttonPosition: 'right', disabledSites: [], genericButtons: true };
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
  .btn.compact .ico svg{width:18px;height:18px}
  .btn.busy{background:rgba(17,17,30,.88);box-shadow:0 10px 26px -8px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  .btn.busy .ico{background:conic-gradient(#b69bff calc(var(--p,0)*1%),rgba(255,255,255,.16) 0);position:relative}
  .btn.busy .ico::after{content:"";position:absolute;inset:4px;border-radius:50%;background:#15151f}
  .btn.busy .ico svg{display:none}
  .btn.spin .ico{background:conic-gradient(from 0deg,transparent 0 55%,#b69bff 100%);animation:smdspin .9s linear infinite}
  .btn.done{background:linear-gradient(135deg,#0fb57d,#34d399);box-shadow:0 10px 26px -8px rgba(16,185,129,.8),inset 0 1px 0 rgba(255,255,255,.35)}
  .btn.err{background:linear-gradient(135deg,#ef4444,#f97316);box-shadow:0 10px 26px -8px rgba(239,68,68,.8),inset 0 1px 0 rgba(255,255,255,.35)}
  @keyframes smdspin{to{transform:rotate(360deg)}}
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
    entry.host = host;
    entry.layer = sh.querySelector('.layer');
  }
  function mountAnchor(entry) {
    const parent = anchorParent(entry.el);
    if (parent && entry.host.parentNode !== parent) parent.appendChild(entry.host);
  }

  const tracked = new Map(); // video -> entry
  const jobs = new Map(); // jobId -> entry
  let videoSeq = 0;

  function makeButton(entry) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.title = '원본 화질로 다운로드';
    b.innerHTML = `<span class="ico">${ICON_DL}</span><span class="txt">다운로드</span>`;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (entry.state === 'busy' || entry.state === 'resolving') return;
      if (entry.state === 'error' && entry.lastError) return showPanel(entry, 'e', entry.lastError);
      start(entry);
    });
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart']) {
      b.addEventListener(t, (ev) => ev.stopPropagation());
    }
    entry.layer.appendChild(b);
    return b;
  }

  function setLook(entry, state, text, percent) {
    const b = entry.btn;
    entry.state = state;
    b.classList.remove('busy', 'spin', 'done', 'err');
    const ico = b.querySelector('.ico');
    const txt = b.querySelector('.txt');
    if (state === 'idle') {
      ico.innerHTML = ICON_DL;
      txt.textContent = '다운로드';
      b.title = '원본 화질로 다운로드';
    } else if (state === 'resolving') {
      b.classList.add('busy', 'spin');
      ico.innerHTML = '';
      txt.textContent = text || '분석 중…';
    } else if (state === 'busy') {
      b.classList.add('busy');
      ico.innerHTML = '';
      if (percent == null) b.classList.add('spin');
      b.style.setProperty('--p', String(Math.max(2, Math.min(100, percent || 0))));
      txt.textContent = text;
    } else if (state === 'done') {
      b.classList.add('done');
      ico.innerHTML = ICON_OK;
      txt.textContent = text || '저장 완료';
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
    req.title = U.cleanTitle(req.title);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'smd:download', request: req });
    } catch (err) {
      return showError(entry, {
        step: '확장프로그램 연결',
        reason: `확장프로그램 백그라운드와 연결이 끊겼습니다 (${err?.message || err}). 확장프로그램이 업데이트되었거나 다시 시작된 경우입니다.`,
        action: '페이지를 새로고침(F5)한 뒤 다시 시도하세요.',
      });
    }
    if (!res || res.error) return showError(entry, res?.error || { step: '다운로드 요청', reason: '백그라운드가 응답하지 않았습니다.', action: '페이지를 새로고침한 뒤 다시 시도하세요.' });
    entry.jobId = res.jobId;
    entry.lastMsg = Date.now();
    jobs.set(res.jobId, entry);
    setLook(entry, 'busy', '준비 중…', null);
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
        setTimeout(() => entry.state === 'done' && setLook(entry, 'idle'), 3000);
      } else if (j.state === 'error') {
        showError(entry, j.error);
      } else {
        const q = j.quality ? `${j.quality} · ` : '';
        const label =
          j.phase === 'resolve' ? '원본 찾는 중…'
          : j.phase === 'mux' ? `${q}합치는 중 ${Math.floor(j.percent || 0)}%`
          : j.phase === 'save' ? '저장 중…'
          : j.percent != null ? `${q}${Math.floor(j.percent)}%`
          : j.bytes ? `${q}${fmtBytes(j.bytes)}`
          : '준비 중…';
        setLook(entry, 'busy', label, j.phase === 'resolve' ? null : j.percent);
      }
      return;
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
  function collectImages(out) {
    if (!imagesOn()) return;
    const vh = window.innerHeight;
    for (const img of document.images) {
      if (img.closest('smd-anchor')) continue;
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
    if (kind === 'image') entry.btn.title = '사진 원본 저장';
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

  function place() {
    const on = enabled();
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
        entry.hiddenStyle = cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0;
      }
      if (entry.hiddenStyle) show = false;
      const busy = entry.state !== 'idle';
      const visible = show && (busy || !isImg || pointerIn(r) || pointerIn(b.getBoundingClientRect()));
      if (!visible) {
        if (entry.visible) {
          b.classList.remove('show');
          entry.visible = false;
        }
        if (entry.panel && !show) closePanel(entry);
        continue;
      }
      b.classList.toggle('compact', isImg ? entry.state === 'idle' : r.width < 300 && entry.state === 'idle');
      if (!entry.measured) {
        entry.w = b.offsetWidth || 120;
        entry.h = b.offsetHeight || 36;
        entry.measured = 1;
      }
      const bw = entry.w;
      const bh = entry.h;
      // 앵커(0,0)의 화면 위치 = 이 버튼들이 기준으로 삼는 좌표 원점
      const o = entry.host.getBoundingClientRect();
      const bottom = isImg ? 10 : Math.min(offsetFor(v), Math.max(8, r.height * 0.25));
      const pos = settings.buttonPosition;
      let x = isImg || pos === 'right' || !pos ? r.right - bw - 10 : pos === 'left' ? r.left + 10 : r.left + (r.width - bw) / 2;
      let y = r.bottom - bottom - bh;
      if (y < r.top + 4) y = r.top + 4;
      x -= o.left;
      y -= o.top;
      const tf = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
      if (entry.tf !== tf) {
        entry.tf = tf;
        b.style.transform = tf;
      }
      if (!entry.visible) b.classList.add('show');
      entry.visible = true;
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
