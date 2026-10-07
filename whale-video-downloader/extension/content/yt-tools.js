// 유튜브 쇼츠: 재생 중인 쇼츠 오른쪽 위에 조회수·구독자 수를 띄운다.
//   유튜브 페이지와 같은 출처로 /youtubei/v1/next 를 불러 화면에 쓰인 글자(예: 조회수 12만회, 구독자 3.4만명)를 그대로 보여 준다.
(() => {
  if (window.top !== window || window.__smdYtTools) return;
  window.__smdYtTools = true;

  let on = true;
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
    tick();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      on = effOf(c.settings.newValue, 'youtube').ytShortsStats !== false;
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

  setInterval(tick, 400);
  addEventListener('yt-navigate-finish', tick);
  addEventListener('resize', tick);
  addEventListener('scroll', tick, { passive: true, capture: true });
})();
