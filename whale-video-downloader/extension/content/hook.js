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

  // ── fetch ──
  const nativeFetch = window.fetch;
  if (rule && typeof nativeFetch === 'function') {
    const wrapped = function (input, init) {
      const p = nativeFetch.apply(this, arguments);
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
