// 페이지(MAIN world)에서 실행: 사이트가 스스로 받아오는 API 응답 중 영상 주소가 들어 있는 것만
// 확장프로그램 쪽(ISOLATED world)으로 전달한다. 응답 내용은 바꾸지 않는다.
(() => {
  'use strict';
  if (window.__smdHooked) return;
  Object.defineProperty(window, '__smdHooked', { value: true });

  const host = location.hostname;
  // 사이트별: 어떤 요청 주소를 볼지(path), 응답 안에 어떤 단어가 있어야 전달할지(marker)
  const RULES = [
    { h: /(^|\.)tiktok\.com$/, path: /\/api\//, marker: /"playAddr"|"bitrateInfo"/ },
    { h: /(^|\.)instagram\.com$/, path: /\/graphql|\/api\/v1\//, marker: /"video_versions"|"video_dash_manifest"/ },
    { h: /(^|\.)facebook\.com$/, path: /\/api\/graphql|\/ajax\/|\/graphql/, marker: /browser_native_(?:hd|sd)_url|playable_url|dash_manifest|progressive_url|base_url/ },
    { h: /(^|\.)(x|twitter)\.com$/, path: /\/graphql\/|\/i\/api\/|\/2\/timeline/, marker: /"video_info"/ },
    { h: /(^|\.)douyin\.com$/, path: /\/aweme\/|\/web\/api\//, marker: /"play_addr"|"bit_rate"/ },
    { h: /(^|\.)kuaishou\.com$/, path: /graphql|\/rest\//, marker: /"photoUrl"|"videoResource"|"manifest"/ },
    { h: /(^|\.)xiaohongshu\.com$/, path: /\/api\/sns\//, marker: /master_url|masterUrl|origin_video_key|originVideoKey/ },
    { h: /(^|\.)weibo\.(com|cn)$/, path: /\/ajax\/|\/tv\/api\/|\/api\//, marker: /"media_info"|"playback_list"|Component_Play_Playinfo|"stream_url"/ },
    { h: /(^|\.)bilibili\.com$/, path: /playurl|\/pgc\/|\/x\/player/, marker: /"dash"|"durl"/ },
    { h: /(^|\.)pinterest\./, path: /\/resource\/|\/_\/graphql/, marker: /"video_list"/ },
    { h: /(^|\.)naver\.com$/, path: /rmcnmv|neonplayer|vodplay|playback|\/vod\/play|shortform|\/clip|\/api\//, marker: /"videos"|"inKey"|"inkey"|<MPD|"source"|"videoId"/ },
    { h: /(^|\.)vimeo\.com$/, path: /\/config|\/video\//, marker: /"progressive"|"hls"|"dash"/ },
    { h: /(^|\.)dailymotion\.com$/, path: /\/player\/metadata\/|\/metadata\//, marker: /"qualities"/ },
    { h: /(^|\.)snapchat\.com$/, path: /\/api\/|_next\/data/, marker: /mediaUrl|contentUrl/ },
  ];
  // 응답 가로채기 규칙이 없는 사이트(유튜브·블루스카이 등)도 아래의 전역 변수/플레이어 질의 처리기는 등록한다.
  const rule = RULES.find((r) => r.h.test(host));

  const MAX_TEXT = 25 * 1024 * 1024;
  const queue = [];
  let ready = false;

  function emit(url, text) {
    const detail = JSON.stringify({ u: String(url), t: text });
    if (!ready) {
      queue.push(detail);
      if (queue.length > 60) queue.shift();
      return;
    }
    document.dispatchEvent(new CustomEvent('__smd_cap', { detail }));
  }

  function consider(url, text) {
    if (!rule || typeof text !== 'string' || !text || text.length > MAX_TEXT) return;
    if (!rule.marker.test(text)) return;
    emit(url, text);
  }

  function wanted(url) {
    if (!rule) return false;
    try {
      const u = new URL(url, location.href);
      return rule.path.test(u.pathname + u.search) || rule.path.test(u.hostname + u.pathname);
    } catch {
      return false;
    }
  }

  // X: 페이지가 쓰는 인증 헤더(웹 공개 Bearer)를 기억해 둔다 → 팔로우 버튼이 같은 방식으로 요청
  const isX = /(^|\.)(x|twitter)\.com$/.test(host);
  const rememberAuth = (v) => {
    if (isX && typeof v === 'string' && /^Bearer /.test(v)) window.__smdXAuth = v;
  };

  // X: 재생 화질 항상 최고 — HLS 마스터 재생목록에서 가장 높은 화질만 남겨 플레이어가 그 화질만 쓰게 한다.
  // 끄기: 확장 설정이 x.com 의 localStorage['smd_xhq'] = '0' 으로 알려 준다.
  let xhqOn = false;
  try { xhqOn = isX && localStorage.getItem('smd_xhq') !== '0'; } catch { xhqOn = isX; }
  const isXMaster = (url) => xhqOn && /video\.twimg\.com\/.+\.m3u8/.test(String(url || ''));
  function bestOnly(text) {
    if (typeof text !== 'string' || !/#EXT-X-STREAM-INF/.test(text)) return text;
    const lines = text.split(/\r?\n/);
    const head = [];
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('#EXT-X-STREAM-INF')) {
        const res = /RESOLUTION=(\d+)x(\d+)/.exec(l);
        const bw = Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] || 0);
        variants.push({ inf: l, uri: lines[i + 1] || '', area: res ? res[1] * res[2] : 0, bw });
        i++;
      } else if (l.trim()) head.push(l);
    }
    if (variants.length < 2) return text;
    variants.sort((a, b) => b.area - a.area || b.bw - a.bw);
    return [...head, variants[0].inf, variants[0].uri, ''].join('\n');
  }

  // ── fetch ──
  const nativeFetch = window.fetch;
  if (rule && typeof nativeFetch === 'function') {
    const wrapped = function (input, init) {
      try {
        if (isX) {
          const h = init?.headers || (typeof input === 'object' ? input.headers : null);
          rememberAuth(h instanceof Headers ? h.get('authorization') : h?.authorization || h?.Authorization);
        }
      } catch {}
      const p = nativeFetch.apply(this, arguments);
      try {
        const u0 = typeof input === 'string' ? input : input?.url || String(input);
        if (isXMaster(u0)) {
          return p.then((res) =>
            res.clone().text().then(
              (t) => (/#EXT-X-STREAM-INF/.test(t) ? new Response(bestOnly(t), { status: res.status, statusText: res.statusText, headers: res.headers }) : res),
              () => res,
            ),
          );
        }
      } catch {}
      try {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        if (wanted(url)) {
          p.then((res) => {
            try {
              const ct = res.headers.get('content-type') || '';
              if (/video|audio|image|octet-stream/.test(ct)) return;
              res.clone().text().then((t) => consider(res.url || url, t), () => {});
            } catch {}
          }, () => {});
        }
      } catch {}
      return p;
    };
    try {
      Object.defineProperty(wrapped, 'toString', { value: () => nativeFetch.toString() });
    } catch {}
    window.fetch = wrapped;
  }

  // ── XMLHttpRequest ──
  const XHR = window.XMLHttpRequest;
  if (isX && XHR) {
    // XHR 로 받는 마스터 재생목록도 최고 화질만 보이게 응답 읽기를 감싼다
    const open0 = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try { this.__smdXhq = isXMaster(url); } catch {}
      return open0.apply(this, arguments);
    };
    for (const prop of ['responseText', 'response']) {
      const desc = Object.getOwnPropertyDescriptor(XHR.prototype, prop);
      if (!desc?.get) continue;
      Object.defineProperty(XHR.prototype, prop, {
        configurable: true,
        get() {
          const v = desc.get.call(this);
          if (!this.__smdXhq || this.readyState !== 4 || typeof v !== 'string') return v;
          if (this.__smdXhqText === undefined) this.__smdXhqText = bestOnly(v);
          return this.__smdXhqText;
        },
      });
    }
    const setHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.setRequestHeader = function (name, value) {
      try { if (/^authorization$/i.test(name)) rememberAuth(value); } catch {}
      return setHeader.apply(this, arguments);
    };
  }
  if (rule && XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__smdUrl = url; } catch {}
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        if (this.__smdUrl && wanted(this.__smdUrl)) {
          this.addEventListener('load', () => {
            try {
              const rt = this.responseType;
              if (rt === '' || rt === 'text') consider(this.responseURL || this.__smdUrl, this.responseText);
              else if (rt === 'json' && this.response) consider(this.responseURL || this.__smdUrl, JSON.stringify(this.response));
            } catch {}
          });
        }
      } catch {}
      return send.apply(this, arguments);
    };
  }

  // ── 페이지 전역 변수 읽기 요청 처리 ──
  function safeJson(value, depthLimit = 40) {
    const seen = new WeakSet();
    let budget = 400000; // 노드 수 제한
    function walk(v, depth) {
      if (budget-- <= 0 || depth > depthLimit) return undefined;
      if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
      if (seen.has(v)) return undefined;
      seen.add(v);
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
      const out = {};
      for (const k of Object.keys(v)) {
        let x;
        try { x = v[k]; } catch { continue; }
        const w = walk(x, depth + 1);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    try {
      return JSON.stringify(walk(value, 0));
    } catch {
      return null;
    }
  }

  function readPath(path) {
    let cur = window;
    for (const key of path.split('.')) {
      if (cur == null) return undefined;
      try { cur = cur[key]; } catch { return undefined; }
    }
    return cur;
  }

  document.addEventListener('__smd_req', (ev) => {
    let req;
    try { req = JSON.parse(ev.detail); } catch { return; }
    const res = { id: req.id, data: {} };
    try {
      if (req.kind === 'globals') {
        for (const name of req.names || []) {
          const v = readPath(name);
          if (v !== undefined) res.data[name] = safeJson(v);
        }
      } else if (req.kind === 'reactuser') {
        // 화면 게시물(React)이 들고 있는 작성자 정보에서 팔로우 상태를 찾는다
        const el = document.querySelector(`[data-smd-q="${CSS.escape(req.token)}"]`);
        const want = String(req.screenName || '').toLowerCase();
        let user = null;
        const seen = new WeakSet();
        const scan = (obj, depth) => {
          if (user || !obj || typeof obj !== 'object' || depth > 8 || seen.has(obj)) return;
          seen.add(obj);
          const sn = obj.legacy?.screen_name || obj.core?.screen_name || obj.screen_name;
          if (sn && String(sn).toLowerCase() === want && (obj.rest_id || obj.id_str)) {
            const rp = obj.relationship_perspectives?.following;
            const lf = obj.legacy ? obj.legacy.following : obj.following;
            user = { id: String(obj.rest_id || obj.id_str), screenName: sn, following: typeof rp === 'boolean' ? rp : typeof lf === 'boolean' ? lf : (obj.legacy && typeof obj.legacy.followers_count === 'number' ? false : null) };
            return;
          }
          for (const k of Object.keys(obj)) {
            if (k === 'children' || k === '_owner' || k.startsWith('__')) continue;
            let v;
            try { v = obj[k]; } catch { continue; }
            if (v && typeof v === 'object') scan(v, depth + 1);
          }
        };
        for (let node = el, i = 0; node && i < 25 && !user; i++, node = node.parentElement) {
          const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
          for (let f = key ? node[key] : null, j = 0; f && j < 80 && !user; j++, f = f.return) if (f.memoizedProps) scan(f.memoizedProps, 0);
        }
        res.data = { user, auth: window.__smdXAuth || '' };
      } else if (req.kind === 'reactmedia') {
        // 화면에 그려진 게시물(React 컴포넌트)이 들고 있는 원본 데이터에서 영상 정보를 찾는다(X 타임라인용).
        const el = document.querySelector(`[data-smd-q="${CSS.escape(req.token)}"]`);
        const media = [];
        const seen = new WeakSet();
        const scan = (obj, depth, ctx) => {
          if (!obj || typeof obj !== 'object' || depth > 7 || seen.has(obj) || media.length > 12) return;
          seen.add(obj);
          if (obj.video_info && Array.isArray(obj.video_info.variants)) {
            media.push({ id_str: String(obj.id_str || obj.media_key || ''), media_key: obj.media_key || '', type: obj.type || '', video_info: { duration_millis: obj.video_info.duration_millis || 0, variants: obj.video_info.variants.map((v) => ({ content_type: v.content_type, bitrate: v.bitrate, url: v.url })) }, tweetId: ctx.tweetId, text: ctx.text });
            return;
          }
          const legacy = obj.legacy && typeof obj.legacy === 'object' ? obj.legacy : null;
          const next = legacy && (obj.rest_id || legacy.id_str) ? { tweetId: String(obj.rest_id || legacy.id_str), text: legacy.full_text || '' } : ctx;
          for (const k of Object.keys(obj)) {
            if (k === 'children' || k === '_owner' || k.startsWith('__')) continue;
            let v;
            try { v = obj[k]; } catch { continue; }
            if (v && typeof v === 'object') scan(v, depth + 1, next);
          }
        };
        let node = el;
        for (let i = 0; node && i < 25 && !media.length; i++, node = node.parentElement) {
          const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
          let fiber = key ? node[key] : null;
          for (let j = 0; fiber && j < 80 && !media.length; j++, fiber = fiber.return) {
            if (fiber.memoizedProps) scan(fiber.memoizedProps, 0, {});
          }
        }
        res.data = { media };
      } else if (req.kind === 'ytplayer') {
        // 유튜브 플레이어 API 로 지금 재생 중인 영상 ID/제목을 묻는다.
        const el = document.querySelector(`[data-smd-q="${CSS.escape(req.token)}"]`);
        const player = el?.closest('.html5-video-player') || document.querySelector('#movie_player');
        const d = player?.getVideoData?.();
        if (d) res.data = { id: d.video_id, title: d.title, author: d.author, isLive: !!d.isLive };
        // 페이지 플레이어가 이미 받은 재생 정보 중 바로 받을 수 있는 주소가 있으면 함께 넘긴다(최후 대체 경로).
        try {
          const pr = player?.getPlayerResponse?.();
          const sd = pr?.streamingData;
          const pickUrl = (list) => (list || []).filter((f) => f && f.url).map((f) => ({ itag: f.itag, url: f.url, mimeType: f.mimeType, width: f.width, height: f.height, fps: f.fps, bitrate: f.bitrate, contentLength: f.contentLength, qualityLabel: f.qualityLabel, audioTrack: f.audioTrack, isDrc: f.isDrc }));
          if (sd && pr?.videoDetails?.videoId === d?.video_id) {
            const page = { adaptiveFormats: pickUrl(sd.adaptiveFormats), formats: pickUrl(sd.formats), hlsManifestUrl: sd.hlsManifestUrl || '' };
            if (page.adaptiveFormats.length || page.formats.length || page.hlsManifestUrl) res.data.pagePlayer = { streamingData: page };
          }
        } catch {}
        try {
          const cfg = window.ytcfg?.data_ || {};
          res.data.visitorData = cfg.VISITOR_DATA || cfg.INNERTUBE_CONTEXT?.client?.visitorData || '';
        } catch {}
      }
    } catch (err) {
      res.error = String(err?.message || err);
    }
    document.dispatchEvent(new CustomEvent('__smd_res', { detail: JSON.stringify(res) }));
  });

  document.addEventListener('__smd_ready', () => {
    ready = true;
    while (queue.length) document.dispatchEvent(new CustomEvent('__smd_cap', { detail: queue.shift() }));
  });
})();
