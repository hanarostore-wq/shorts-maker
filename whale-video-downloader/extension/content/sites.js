// 사이트별 어댑터 (ISOLATED world).
// 역할: 화면의 <video> 가 어떤 게시물/영상인지 알아내고, 그 영상의 원본 데이터(사이트 API 응답)를 모아
// 서비스워커로 넘긴다. 화질 선택과 실제 다운로드 방식 결정은 서비스워커(builders.js)가 한다.
(() => {
  'use strict';
  if (globalThis.__SMD_SITES) return;

  // ───────────────────────────── 공용 도구 ─────────────────────────────
  const U = {};

  U.walk = (root, visit, maxNodes = 400000) => {
    const stack = [root];
    let n = 0;
    while (stack.length && n++ < maxNodes) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (visit(node) === true) continue; // true = 하위는 보지 않음
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) if (node[i] && typeof node[i] === 'object') stack.push(node[i]);
      } else {
        for (const k in node) {
          const v = node[k];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
  };

  // for(;;); 접두사, )]}' 접두사, 줄 단위 다중 JSON(페이스북 스트리밍 응답) 처리
  U.parseLoose = (text) => {
    if (typeof text !== 'string') return [];
    let t = text.trim();
    t = t.replace(/^for\s*\(;;\);/, '').replace(/^\)\]\}',?/, '').trim();
    if (!t) return [];
    try {
      return [JSON.parse(t)];
    } catch {}
    const out = [];
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || (s[0] !== '{' && s[0] !== '[')) continue;
      try { out.push(JSON.parse(s)); } catch {}
    }
    return out;
  };

  U.abs = (url, base = location.href) => {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url.replace(/\\u0026/g, '&').replace(/\\\//g, '/'), base);
      if (u.protocol === 'http:' && !/^(localhost|127\.)/.test(u.hostname)) u.protocol = 'https:';
      return u.href;
    } catch {
      return '';
    }
  };

  // 영상 하나만 들어 있는 가장 큰 조상 = 게시물 카드
  U.container = (video, maxDepth = 14) => {
    let el = video;
    let best = video.parentElement || video;
    for (let i = 0; i < maxDepth && el.parentElement; i++) {
      const p = el.parentElement;
      if (p === document.body || p === document.documentElement) break;
      if (p.querySelectorAll('video').length > 1) break;
      best = p;
      el = p;
    }
    return best;
  };

  U.findLink = (video, re, maxDepth) => {
    const box = U.container(video, maxDepth);
    const links = box.querySelectorAll('a[href]');
    for (const a of links) {
      const m = re.exec(a.getAttribute('href') || '');
      if (m) return m;
    }
    // 영상 바로 위 단계에 링크가 감싸고 있는 경우
    const wrap = video.closest('a[href]');
    if (wrap) {
      const m = re.exec(wrap.getAttribute('href'));
      if (m) return m;
    }
    return null;
  };

  U.matchAncestorAttr = (video, attrNames, re, depth = 16) => {
    let el = video;
    for (let i = 0; el && i < depth; i++, el = el.parentElement) {
      for (const name of attrNames) {
        const v = el.getAttribute?.(name);
        if (v) {
          const m = re.exec(v);
          if (m) return m;
        }
      }
    }
    return null;
  };

  U.scripts = (selector, mustContain) => {
    const out = [];
    for (const s of document.querySelectorAll(selector)) {
      const t = s.textContent || '';
      if (mustContain && !mustContain.test(t)) continue;
      out.push(t);
    }
    return out;
  };

  U.durationClose = (a, b) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(1.5, b * 0.03);

  // 사이트 데이터 안의 AI 생성 표시(틱톡 aigcLabelType, 도우인 aigc_info, 메타 gen_ai_* 등)
  const AI_KEY = /aigc|ai_?generated|is_?ai\b|isai|gen_?ai|made_?with_?ai|synthetic|ai_?label|ai_?info/i;
  U.aiFlag = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 2) return false;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (AI_KEY.test(k)) {
        if (v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v && !/^(0|false|none|null)$/i.test(v))) return true;
        if (v && typeof v === 'object' && Object.values(v).some((x) => x === true || (typeof x === 'number' && x > 0))) return true;
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2 && k !== 'video' && U.aiFlag(v, depth + 1)) return true;
    }
    return false;
  };

  U.cleanTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);

  U.metaTitle = () =>
    document.querySelector('meta[property="og:title"]')?.content || document.title || '';

  // 사이트별 데이터 저장소
  class Store {
    constructor() {
      this.map = new Map();
      this.order = [];
    }
    put(keys, value) {
      const ks = keys.filter((k) => k != null && k !== '').map(String);
      if (!ks.length) return;
      const prev = this.get(ks[0]);
      const merged = prev && typeof prev === 'object' ? { ...prev, ...value, __t: Date.now() } : { ...value, __t: Date.now() };
      for (const k of ks) this.map.set(k, merged);
      this.order.push(merged);
      if (this.order.length > 600) {
        const old = this.order.shift();
        for (const [k, v] of this.map) if (v === old) this.map.delete(k);
      }
    }
    get(k) {
      return k == null ? undefined : this.map.get(String(k));
    }
    values() {
      return [...new Set(this.map.values())];
    }
    byDuration(seconds, pick = (v) => v.duration) {
      if (!(seconds > 0)) return null;
      const list = this.values().filter((v) => U.durationClose(pick(v), seconds));
      list.sort((a, b) => b.__t - a.__t);
      return list[0] || null;
    }
    latest() {
      return this.order[this.order.length - 1] || null;
    }
  }

  class SiteError extends Error {
    constructor(reason, action) {
      super(reason);
      this.step = '영상 정보 찾기';
      this.reason = reason;
      this.action = action;
    }
  }

  const fetchJson = async (url, init = {}) => {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (!res.ok) throw new SiteError(`사이트 API 가 HTTP ${res.status} 로 응답했습니다 (${new URL(url, location.href).pathname}).`, res.status === 401 || res.status === 403 ? '사이트에 로그인한 뒤 페이지를 새로고침하고 다시 시도하세요.' : '페이지를 새로고침한 뒤 다시 시도하세요.');
    const text = await res.text();
    const parsed = U.parseLoose(text);
    if (!parsed.length) throw new SiteError('사이트 API 응답을 해석하지 못했습니다.', '페이지를 새로고침한 뒤 다시 시도하세요.');
    return parsed[0];
  };

  const fetchText = async (url, init = {}) => {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (!res.ok) throw new SiteError(`페이지를 다시 읽지 못했습니다 (HTTP ${res.status}).`, '페이지를 새로고침한 뒤 다시 시도하세요.');
    return res.text();
  };

  const extractScriptJson = (html, id) => {
    const re = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`);
    const m = re.exec(html);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  };

  // ───────────────────────────── 어댑터 ─────────────────────────────
  const sites = [];
  const add = (a) => sites.push(a);

  // ── YouTube / Shorts ──
  add({
    id: 'youtube',
    name: '유튜브',
    match: (h) => /(^|\.)youtube(-nocookie)?\.com$/.test(h),
    offset: (video) => (video.closest('#shorts-player, ytd-reel-video-renderer, ytd-shorts') ? 18 : 62),
    async resolve(video, ctx) {
      const token = ctx.mark(video);
      const info = await ctx.ask({ kind: 'ytplayer', token }).catch(() => ({}));
      let id = info?.id;
      if (!id) {
        const m =
          /[?&]v=([\w-]{11})/.exec(location.search) ||
          /\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(location.pathname);
        id = m?.[1];
      }
      if (!id) throw new SiteError('재생 중인 유튜브 영상의 ID 를 찾지 못했습니다.', '영상을 한 번 재생한 뒤 다시 눌러 주세요.');
      const player = video.closest('.html5-video-player');
      if (player?.classList.contains('ad-showing')) {
        throw new SiteError('지금은 광고가 재생 중입니다.', '광고가 끝난 뒤 다시 다운로드 버튼을 누르세요.');
      }
      if (info?.isLive) throw new SiteError('라이브 방송은 다운로드할 수 없습니다.', '방송이 끝나고 다시보기로 올라온 뒤 시도하세요.');
      return {
        id,
        title: info?.title || document.title.replace(/\s*-\s*YouTube\s*$/, ''),
        author: info?.author || '',
        bg: { kind: 'youtube', id, visitorData: info?.visitorData || '', pagePlayer: info?.pagePlayer || null },
      };
    },
  });

  // ── TikTok ──
  const tiktok = new Store();
  const ingestTikTok = (json) =>
    U.walk(json, (o) => {
      const v = o.video;
      if (o.id && v && typeof v === 'object' && (v.playAddr || v.bitrateInfo || v.PlayAddrStruct || v.downloadAddr)) {
        tiktok.put([o.id], {
          id: String(o.id),
          ai: U.aiFlag(o),
          desc: o.desc || '',
          author: o.author?.uniqueId || o.author?.nickname || (typeof o.author === 'string' ? o.author : ''),
          duration: Number(v.duration) || 0,
          video: {
            playAddr: v.playAddr,
            downloadAddr: v.downloadAddr,
            width: v.width,
            height: v.height,
            bitrate: v.bitrate,
            codecType: v.codecType,
            bitrateInfo: v.bitrateInfo,
            PlayAddrStruct: v.PlayAddrStruct,
          },
        });
        return true;
      }
      return false;
    });
  add({
    id: 'tiktok',
    name: '틱톡',
    match: (h) => /(^|\.)tiktok\.com$/.test(h),
    offset: 56,
    ingest: ingestTikTok,
    init() {
      for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__NEXT_DATA__']) {
        const el = document.getElementById(id);
        if (el) U.parseLoose(el.textContent).forEach(ingestTikTok);
      }
    },
    async resolve(video) {
      let id =
        U.matchAncestorAttr(video, ['id', 'data-item-id', 'data-video-id'], /(\d{17,21})/)?.[1] ||
        U.findLink(video, /\/video\/(\d{15,21})/)?.[1] ||
        /\/video\/(\d{15,21})/.exec(location.pathname)?.[1];
      let item = id && tiktok.get(id);
      if (!item && !id) item = tiktok.byDuration(video.duration);
      if (!item && id) {
        const html = await fetchText(`/@_/video/${id}`);
        const data = extractScriptJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__') || extractScriptJson(html, 'SIGI_STATE');
        if (data) ingestTikTok(data);
        item = tiktok.get(id);
      }
      if (!item) throw new SiteError('이 틱톡 영상의 원본 주소를 찾지 못했습니다.', '영상을 클릭해 상세 페이지를 연 뒤 다시 다운로드하세요.');
      return { id: item.id, title: item.desc, author: item.author, info: { item } };
    },
  });

  // ── Instagram ──
  const insta = new Store();
  const IG_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const igMediaId = (code) => {
    let id = 0n;
    for (const ch of code.slice(0, 11)) id = id * 64n + BigInt(IG_ALPHA.indexOf(ch));
    return id.toString();
  };
  const igPick = (o) => ({
    id: String(o.pk || o.id || ''),
    ai: U.aiFlag(o),
    code: o.code || '',
    duration: Number(o.video_duration) || 0,
    video_versions: o.video_versions,
    video_dash_manifest: o.video_dash_manifest,
    original_width: o.original_width,
    original_height: o.original_height,
  });
  const ingestInsta = (json) =>
    U.walk(json, (o) => {
      if (Array.isArray(o.carousel_media) && (o.code || o.pk)) {
        const children = o.carousel_media.filter((c) => c && c.video_versions).map(igPick);
        insta.put([o.code, o.pk, o.id], {
          code: o.code,
          title: o.caption?.text || '',
          author: o.user?.username || o.owner?.username || '',
          children,
        });
        return true;
      }
      if (o.video_versions && (o.code || o.pk || o.id)) {
        const base = igPick(o);
        insta.put([o.code, o.pk, o.id, String(o.id || '').split('_')[0]], {
          ...base,
          title: o.caption?.text || '',
          author: o.user?.username || o.owner?.username || '',
        });
        return true;
      }
      return false;
    });
  add({
    id: 'instagram',
    name: '인스타그램',
    match: (h) => /(^|\.)instagram\.com$/.test(h),
    offset: 52,
    ingest: ingestInsta,
    init() {
      for (const t of U.scripts('script[type="application/json"]', /video_versions/)) U.parseLoose(t).forEach(ingestInsta);
    },
    async resolve(video) {
      const re = /\/(?:p|reel|reels|tv)\/(?!audio\/)([A-Za-z0-9_-]{6,})/;
      const code = U.findLink(video, re)?.[1] || re.exec(location.pathname)?.[1];
      let item = code && insta.get(code);
      if (!item && code) {
        const data = await fetchJson(`/api/v1/media/${igMediaId(code)}/info/`, {
          headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' },
        });
        ingestInsta(data);
        item = insta.get(code);
      }
      if (!item) item = insta.byDuration(video.duration);
      if (!item) throw new SiteError('이 인스타그램 영상의 원본 주소를 찾지 못했습니다.', '게시물을 클릭해 열거나(/p/, /reel/ 주소) 로그인 상태에서 새로고침한 뒤 다시 시도하세요.');
      let media = item;
      if (item.children?.length) {
        media = item.children.find((c) => U.durationClose(c.duration, video.duration)) || item.children[0];
      }
      return {
        id: item.code || media.code || media.id,
        title: item.title,
        author: item.author,
        info: { media },
      };
    },
  });

  // ── Facebook ──
  const fb = new Store();
  const FB_KEYS = [
    'browser_native_hd_url',
    'browser_native_sd_url',
    'playable_url',
    'playable_url_quality_hd',
    'hd_src',
    'sd_src',
    'dash_manifest',
    'dash_manifest_xml_string',
    'manifest_xml',
  ];
  const fbCollect = (o) => {
    const out = {};
    for (const k of FB_KEYS) if (typeof o[k] === 'string' && o[k]) out[k] = o[k];
    const legacy = o.videoDeliveryLegacyFields;
    if (legacy) for (const k of FB_KEYS) if (typeof legacy[k] === 'string' && legacy[k]) out[k] = legacy[k];
    const frag = o.videoDeliveryResponseFragment?.videoDeliveryResponseResult || o.videoDeliveryResponseResult;
    if (frag) {
      if (Array.isArray(frag.progressive_urls)) out.progressive_urls = frag.progressive_urls;
      if (Array.isArray(frag.dash_manifests)) out.dash_manifests = frag.dash_manifests.map((d) => d?.manifest_xml).filter(Boolean);
    }
    if (Array.isArray(o.all_video_dash_prefetch_representations)) {
      out.prefetch = o.all_video_dash_prefetch_representations;
    }
    const dur = Number(o.playable_duration_in_ms) / 1000 || Number(o.length_in_second) || 0;
    if (dur) out.duration = dur;
    return out;
  };
  const ingestFacebook = (json) =>
    U.walk(json, (o) => {
      if (Array.isArray(o.all_video_dash_prefetch_representations)) {
        for (const rep of o.all_video_dash_prefetch_representations) {
          if (rep?.video_id) fb.put([rep.video_id], { id: String(rep.video_id), prefetch: [rep] });
        }
      }
      const id = o.videoId || o.video_id || (o.__typename === 'Video' ? o.id : null) || (o.playable_url || o.browser_native_hd_url || o.browser_native_sd_url ? o.id : null);
      if (id) {
        const got = fbCollect(o);
        if (Object.keys(got).length) {
          fb.put([id], { id: String(id), ...got, title: o.title?.text || o.name || o.savable_description?.text || '', author: o.owner?.name || '' });
        }
      }
      return false;
    });
  add({
    id: 'facebook',
    name: '페이스북',
    match: (h) => /(^|\.)facebook\.com$/.test(h),
    offset: 60,
    ingest: ingestFacebook,
    init() {
      for (const t of U.scripts('script[type="application/json"]', /browser_native_|playable_url|dash_manifest|progressive_url/)) {
        U.parseLoose(t).forEach(ingestFacebook);
      }
    },
    async resolve(video) {
      const re = /\/(?:reel|videos(?:\/[^/?#]+)?|watch\/?\?v=|watch\/live\/?\?v=)\/?(\d{6,})/;
      let id =
        U.matchAncestorAttr(video, ['data-video-id'], /(\d{6,})/)?.[1] ||
        U.findLink(video, re)?.[1] ||
        re.exec(location.pathname + location.search)?.[1] ||
        /[?&]v=(\d{6,})/.exec(location.search)?.[1];
      let item = id && fb.get(id);
      if (!item) item = fb.byDuration(video.duration);
      if (!item && id) {
        // 해당 영상 페이지를 다시 읽어 내장 JSON 에서 찾는다.
        const html = await fetchText(`/reel/${id}`);
        for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
          if (/browser_native_|playable_url|dash_manifest|progressive_url/.test(m[1])) U.parseLoose(m[1]).forEach(ingestFacebook);
        }
        item = fb.get(id);
      }
      if (!item) throw new SiteError('이 페이스북 영상의 원본 주소를 찾지 못했습니다.', '영상을 클릭해 릴스/동영상 페이지(/reel/, /watch)를 연 뒤 다시 시도하세요.');
      return { id: item.id, title: item.title || U.metaTitle(), author: item.author, info: { video: item } };
    },
  });

  // ── X (Twitter) ──
  const xs = new Store();
  const xTweets = new Store();
  // X 사용자(팔로우 상태): 화면 이름(소문자) → { id, screenName, following }
  const xUsers = new Map();
  const xFollowState = (o) => {
    if (typeof o.relationship_perspectives?.following === 'boolean') return o.relationship_perspectives.following;
    if (typeof o.legacy?.following === 'boolean') return o.legacy.following;
    // X 는 팔로우하지 않은 경우 following 값을 아예 빼고 보내는 일이 많다 → 전체 사용자 정보가 있으면 false 로 본다
    if (o.legacy && typeof o.legacy.followers_count === 'number') return false;
    return undefined;
  };
  const ingestXUser = (o) => {
    const sn = o.legacy?.screen_name || o.core?.screen_name;
    if (!sn || !o.rest_id || (o.__typename && o.__typename !== 'User')) return;
    const f = xFollowState(o);
    const key = sn.toLowerCase();
    const prev = xUsers.get(key);
    // 방금 직접 팔로우·언팔로우한 계정은 2분 동안 그 상태를 지킨다(먼저 받아 둔 피드 데이터가 '팔로우 안 함'으로 되돌리지 않게)
    if (prev?.manualAt && Date.now() - prev.manualAt < 120000) return;
    xUsers.set(key, { id: String(o.rest_id), screenName: sn, following: f ?? prev?.following, t: Date.now() });
  };
  const ingestX = (json) =>
    U.walk(json, (o) => {
      ingestXUser(o);
      const legacy = o.legacy && typeof o.legacy === 'object' ? o.legacy : o;
      const media = legacy.extended_entities?.media;
      const tweetId = o.rest_id || legacy.id_str;
      if (Array.isArray(media) && tweetId) {
        const ids = [];
        for (const m of media) {
          if (!m?.video_info) continue;
          xs.put([m.id_str, m.media_key], {
            id: m.id_str,
            tweetId,
            title: legacy.full_text || legacy.text || '',
            author: o.core?.user_results?.result?.legacy?.screen_name || o.core?.user_results?.result?.core?.screen_name || '',
            duration: (m.video_info.duration_millis || 0) / 1000,
            media: { video_info: m.video_info, original_info: m.original_info, type: m.type },
          });
          ids.push(m.id_str);
        }
        if (ids.length) xTweets.put([tweetId], { ids });
      }
      return false;
    });
  add({
    id: 'x',
    name: 'X(트위터)',
    match: (h) => /(^|\.)(x|twitter)\.com$/.test(h),
    offset: 50,
    ingest: ingestX,
    async resolve(video, ctx) {
      const poster = video.getAttribute('poster') || '';
      const mediaId = /(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\d+)/.exec(poster)?.[1];
      const article = video.closest('article') || U.container(video);
      let tweetId = null;
      for (const a of article.querySelectorAll('a[href*="/status/"]')) {
        const m = /\/status\/(\d+)/.exec(a.getAttribute('href'));
        if (m && a.querySelector('time')) { tweetId = m[1]; break; }
      }
      tweetId ||= /\/status\/(\d+)/.exec(location.pathname)?.[1] || U.findLink(video, /\/status\/(\d+)/)?.[1];
      let item = mediaId && xs.get(mediaId);
      if (!item && tweetId) {
        const t = xTweets.get(tweetId);
        const list = (t?.ids || []).map((i) => xs.get(i)).filter(Boolean);
        item = list.find((m) => U.durationClose(m.duration, video.duration)) || list[0];
      }
      if (item) return { id: item.id, title: item.title, author: item.author, info: { media: item.media } };
      // 타임라인: 화면에 그려진 게시물이 들고 있는 데이터에서 직접 찾는다(게시물을 열지 않아도 됨)
      const r = await ctx.ask({ kind: 'reactmedia', token: ctx.mark(video) }, 2500).catch(() => ({}));
      const found = (r?.media || []).filter((m) => m.video_info?.variants?.length);
      if (found.length) {
        const m = found.find((x) => mediaId && x.id_str === mediaId) || found.find((x) => U.durationClose((x.video_info.duration_millis || 0) / 1000, video.duration)) || found[0];
        return { id: m.id_str || tweetId, title: m.text || U.metaTitle(), info: { media: { video_info: m.video_info } } };
      }
      if (!tweetId && !mediaId) throw new SiteError('이 게시물의 트윗 ID 를 찾지 못했습니다.', '게시물을 클릭해 상세 화면(/status/ 주소)을 연 뒤 다시 시도하세요.');
      return { id: tweetId || mediaId, title: U.metaTitle(), bg: { kind: 'x', tweetId, mediaId, duration: video.duration || 0 } };
    },
  });

  // ── Bluesky ──
  // 블루스카이는 화면을 옮겨도 탭 제목·og:title 이 처음 연 페이지 것으로 남아 있어(예: 'ㅎㅊㅁㅃ') 제목에 쓰면 안 된다.
  // 그래서 누른 사진·영상이 들어 있는 게시물(작성자 이름 - 본문)에서 읽는다.
  //   게시물 밖(사진 크게 보기 창 등)이면 ① 게시물 상세 화면의 본 게시물 ② 방금 누른 게시물 순으로 찾는다.
  let bskyLastItem = null;
  let bskyLastAt = 0;
  const BSKY_ITEM = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';
  if (/(^|\.)bsky\.app$/.test(location.hostname)) {
    addEventListener('pointerdown', (e) => {
      const it = e.target?.closest?.(BSKY_ITEM);
      if (it) {
        bskyLastItem = it;
        bskyLastAt = Date.now();
      }
    }, true);
  }
  function bskyItemOf(el) {
    const own = el.closest?.(BSKY_ITEM) || [...document.querySelectorAll('[data-testid^="postThreadItem-by-"]')].find((x) => x.contains(el));
    if (own) return own;
    const path = /^\/profile\/([^/]+)\/post\//.exec(location.pathname);
    if (path) {
      const h = decodeURIComponent(path[1]);
      const main = document.querySelector(`[data-testid="postThreadItem-by-${CSS.escape(h)}"]`);
      if (main) return main;
    }
    if (bskyLastItem?.isConnected && Date.now() - bskyLastAt < 10 * 60 * 1000) return bskyLastItem;
    return null;
  }
  function bskyPost(el, kindKo) {
    const item = bskyItemOf(el);
    const handle = item?.dataset.testid.replace(/^(feedItem|postThreadItem)-by-/, '') || /^\/profile\/([^/]+)/.exec(location.pathname)?.[1] || '';
    let name = '';
    if (item && handle) {
      for (const a of item.querySelectorAll(`a[href="/profile/${handle}"], a[href^="/profile/${handle}"]`)) {
        const t = (a.innerText || '').split('\n')[0].replace(/\s+/g, ' ').replace(/\s*@\S+.*$/, '').trim();
        if (t && !/^\d+[smhd분시간일]/.test(t)) {
          name = t.slice(0, 60);
          break;
        }
      }
    }
    const text = (item?.querySelector('[data-testid="postText"]')?.innerText || '').replace(/\s+/g, ' ').trim();
    const who = name || (handle ? `@${decodeURIComponent(handle)}` : '');
    return { title: [who, text].filter(Boolean).join(' - ') || `블루스카이 ${kindKo}`, author: name || handle, found: !!item };
  }
  add({
    id: 'bluesky',
    name: '블루스카이',
    match: (h) => /(^|\.)bsky\.app$/.test(h),
    offset: 48,
    async resolve(video) {
      // 제목·작성자는 누른 게시물에서 읽는다(블루스카이는 페이지를 옮겨도 탭 제목·메타 정보가 처음 것으로 남아 있음)
      const meta = bskyPost(video, '영상');
      const re = /\/watch\/(did(?:%3A|:)[^/]+)\/([a-z0-9]{20,})\//i;
      const srcs = [video.getAttribute('poster'), video.currentSrc, video.querySelector('source')?.src, ...[...U.container(video).querySelectorAll('img')].map((i) => i.src)];
      for (const s of srcs) {
        const m = s && re.exec(s);
        if (m) {
          const did = decodeURIComponent(m[1]);
          return { id: m[2], title: meta.title, author: meta.author, bg: { kind: 'bluesky', did, cid: m[2] } };
        }
      }
      const post = U.findLink(video, /\/profile\/([^/]+)\/post\/([a-z0-9]+)/) || /\/profile\/([^/]+)\/post\/([a-z0-9]+)/.exec(location.pathname);
      if (post) return { id: post[2], title: meta.title, author: meta.author, bg: { kind: 'bluesky', actor: post[1], rkey: post[2] } };
      throw new SiteError('블루스카이 영상의 게시물 정보를 찾지 못했습니다.', '게시물을 클릭해 연 뒤 다시 시도하세요.');
    },
  });

  // ── Xiaohongshu ──
  const xhs = new Store();
  const ingestXhs = (json) =>
    U.walk(json, (o) => {
      const card = o.note_card || o.noteCard || (o.note && o.note.video ? o.note : null) || (o.video && (o.noteId || o.note_id || o.id) ? o : null);
      if (card && card.video) {
        const id = o.id || o.note_id || o.noteId || card.note_id || card.noteId || card.id;
        if (id) {
          xhs.put([id], {
            id: String(id),
            ai: U.aiFlag(card) || U.aiFlag(o),
            title: card.title || card.display_title || card.displayTitle || card.desc || '',
            author: card.user?.nickname || card.user?.nick_name || '',
            duration: Number(card.video?.capa?.duration || card.video?.media?.video?.duration) || 0,
            video: card.video,
          });
          return true;
        }
      }
      return false;
    });
  add({
    id: 'xiaohongshu',
    name: '샤오홍슈',
    match: (h) => /(^|\.)xiaohongshu\.com$/.test(h),
    offset: 48,
    ingest: ingestXhs,
    async resolve(video, ctx) {
      const re = /\/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/;
      const id = re.exec(location.pathname)?.[1] || U.findLink(video, re)?.[1];
      let item = id && xhs.get(id);
      if (!item) {
        const g = await ctx.globals(['__INITIAL_STATE__.note.noteDetailMap', '__INITIAL_STATE__.feed.feeds']);
        for (const v of Object.values(g)) U.parseLoose(v).forEach(ingestXhs);
        // noteDetailMap 은 {noteId: {note:{...}}} 형태
        const map = g['__INITIAL_STATE__.note.noteDetailMap'] && U.parseLoose(g['__INITIAL_STATE__.note.noteDetailMap'])[0];
        if (map) for (const [k, v] of Object.entries(map)) if (v?.note?.video) xhs.put([k], { id: k, title: v.note.title || v.note.desc || '', author: v.note.user?.nickname || '', video: v.note.video });
        item = (id && xhs.get(id)) || xhs.byDuration(video.duration);
      }
      if (!item && id) {
        const html = await fetchText(location.href);
        const m = /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*<\/script>/.exec(html);
        if (m) U.parseLoose(m[1].replace(/\bundefined\b/g, 'null')).forEach(ingestXhs);
        item = xhs.get(id);
      }
      if (!item) throw new SiteError('이 샤오홍슈 노트의 영상 정보를 찾지 못했습니다.', '노트를 클릭해 상세 화면(/explore/ 주소)을 연 뒤 다시 시도하세요.');
      return { id: item.id, title: item.title, author: item.author, info: { note: item } };
    },
  });

  // ── Snapchat ──
  const snap = new Store();
  const ingestSnap = (json) =>
    U.walk(json, (o) => {
      const url = o.snapUrls?.mediaUrl || (o.mediaType === 'VIDEO' || o.mediaType === 1 ? o.mediaUrl : null) || o.contentUrl;
      if (typeof url === 'string' && /^https?:/.test(url)) {
        const id = o.snapId?.value || o.snapId || o.id || url;
        snap.put([id, url], { id: String(id), url, duration: Number(o.duration || o.videoMetadata?.durationMs / 1000) || 0, title: o.title || o.name || o.description || '' });
      }
      if (o.videoMetadata?.contentUrl) {
        const vm = o.videoMetadata;
        snap.put([vm.contentUrl], { id: vm.name || vm.contentUrl, url: vm.contentUrl, title: vm.name || vm.description || '', duration: Number(vm.durationMs) / 1000 || 0 });
      }
      return false;
    });
  add({
    id: 'snapchat',
    name: '스냅챗',
    match: (h) => /(^|\.)snapchat\.com$/.test(h),
    offset: 48,
    ingest: ingestSnap,
    init() {
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) U.parseLoose(nd.textContent).forEach(ingestSnap);
      for (const t of U.scripts('script[type="application/ld+json"]')) U.parseLoose(t).forEach(ingestSnap);
    },
    async resolve(video) {
      const src = video.currentSrc || video.src || video.querySelector('source')?.src || '';
      const known = src && snap.get(src);
      if (/^https?:/.test(src)) {
        return { id: known?.id || src.split('/').pop().split('.')[0], title: known?.title || U.metaTitle(), info: { url: src } };
      }
      const item = snap.byDuration(video.duration) || snap.latest();
      if (item) return { id: item.id, title: item.title || U.metaTitle(), info: { url: item.url } };
      throw new SiteError('스냅챗 영상 주소를 찾지 못했습니다.', '스포트라이트/스토리를 클릭해 재생한 뒤 다시 시도하세요.');
    },
  });

  // ── Douyin ──
  const douyin = new Store();
  const ingestDouyin = (json) =>
    U.walk(json, (o) => {
      const id = o.aweme_id || o.awemeId;
      const v = o.video;
      if (id && v && typeof v === 'object' && (v.play_addr || v.bit_rate || v.playAddr || v.bitRateList)) {
        douyin.put([id], {
          id: String(id),
          ai: U.aiFlag(o),
          title: o.desc || '',
          author: o.author?.nickname || '',
          duration: (Number(o.duration || v.duration) || 0) / (Number(o.duration || v.duration) > 1000 ? 1000 : 1),
          video: v,
        });
        return true;
      }
      return false;
    });
  add({
    id: 'douyin',
    name: '도우인',
    match: (h) => /(^|\.)douyin\.com$/.test(h),
    offset: 60,
    ingest: ingestDouyin,
    init() {
      const rd = document.getElementById('RENDER_DATA');
      if (rd) {
        try { ingestDouyin(JSON.parse(decodeURIComponent(rd.textContent))); } catch {}
      }
    },
    async resolve(video) {
      const id =
        U.matchAncestorAttr(video, ['data-e2e-vid', 'data-aweme-id', 'data-id'], /(\d{15,21})/)?.[1] ||
        /[?&]modal_id=(\d+)/.exec(location.search)?.[1] ||
        /\/(?:video|note)\/(\d+)/.exec(location.pathname)?.[1] ||
        U.findLink(video, /\/video\/(\d{15,21})/)?.[1];
      let item = (id && douyin.get(id)) || douyin.byDuration(video.duration);
      if (!item) throw new SiteError('이 도우인 영상의 원본 주소를 찾지 못했습니다.', '영상을 클릭해 상세 화면을 열고 한 번 재생한 뒤 다시 시도하세요.');
      return { id: item.id, title: item.title, author: item.author, info: { aweme: item } };
    },
  });

  // ── Kuaishou ──
  const ks = new Store();
  const ingestKs = (json) =>
    U.walk(json, (o) => {
      if (o.id && (o.photoUrl || o.videoResource || o.manifest || o.manifestH265) && (o.caption !== undefined || o.duration !== undefined || o.photoUrl)) {
        ks.put([o.id], {
          id: String(o.id),
          title: o.caption || '',
          duration: (Number(o.duration) || 0) / 1000,
          photo: { photoUrl: o.photoUrl, photoH265Url: o.photoH265Url, videoResource: o.videoResource, manifest: o.manifest, manifestH265: o.manifestH265 },
        });
        return true;
      }
      return false;
    });
  add({
    id: 'kuaishou',
    name: '콰이쇼우',
    match: (h) => /(^|\.)kuaishou\.com$/.test(h),
    offset: 60,
    ingest: ingestKs,
    async resolve(video, ctx) {
      const re = /\/(?:short-video|video|f)\/([0-9a-zA-Z_-]{6,})/;
      const id = re.exec(location.pathname)?.[1] || U.findLink(video, re)?.[1];
      let item = id && ks.get(id);
      if (!item) {
        const g = await ctx.globals(['__APOLLO_STATE__']);
        if (g.__APOLLO_STATE__) {
          const state = U.parseLoose(g.__APOLLO_STATE__)[0] || {};
          const client = state.defaultClient || state;
          for (const [k, v] of Object.entries(client)) {
            if (/^VisionVideoDetailPhoto:|^VisionVideoDetailPhotoV2:/.test(k) && v) ingestKs({ ...v, id: v.id || k.split(':')[1] });
          }
          ingestKs(state);
        }
        item = (id && ks.get(id)) || ks.byDuration(video.duration);
      }
      if (item) return { id: item.id, title: item.title, info: { photo: item.photo } };
      const src = video.currentSrc || video.src;
      if (/^https?:/.test(src)) return { id: id || 'video', title: U.metaTitle(), info: { photo: { photoUrl: src } } };
      throw new SiteError('이 콰이쇼우 영상의 원본 주소를 찾지 못했습니다.', '영상을 클릭해 상세 화면을 연 뒤 다시 시도하세요.');
    },
  });

  // ── Bilibili ──
  const bili = new Store();
  const ingestBili = (json, url = '') =>
    U.walk(json, (o) => {
      const d = o.dash || o.durl ? o : null;
      if (d && (d.dash?.video || Array.isArray(d.durl))) {
        const cid = /[?&]cid=(\d+)/.exec(url)?.[1] || '';
        const bvid = /[?&]bvid=(BV\w+)/.exec(url)?.[1] || '';
        const ep = /[?&]ep_id=(\d+)/.exec(url)?.[1] || '';
        const value = { dash: d.dash, durl: d.durl, quality: d.quality, accept: d.accept_description, duration: (Number(d.timelength) || 0) / 1000 };
        bili.put([cid && `cid:${cid}`, bvid && cid && `${bvid}:${cid}`, ep && `ep:${ep}`, '__latest'], value);
        return true;
      }
      return false;
    });
  add({
    id: 'bilibili',
    name: '빌리빌리',
    match: (h) => /(^|\.)bilibili\.com$/.test(h),
    offset: 58,
    ingest: (json, url) => ingestBili(json, url),
    async resolve(video, ctx) {
      const g = await ctx.globals(['__playinfo__', '__INITIAL_STATE__.videoData', '__INITIAL_STATE__.epInfo', '__INITIAL_STATE__.p', '__INITIAL_STATE__.cid']);
      const vd = g['__INITIAL_STATE__.videoData'] ? U.parseLoose(g['__INITIAL_STATE__.videoData'])[0] : null;
      const p = Number(new URLSearchParams(location.search).get('p') || (g['__INITIAL_STATE__.p'] ? JSON.parse(g['__INITIAL_STATE__.p']) : 1) || 1);
      let bvid = /\/video\/(BV\w{10})/.exec(location.pathname)?.[1] || U.findLink(video, /\/video\/(BV\w{10})/)?.[1] || vd?.bvid;
      let cid = vd?.pages?.[p - 1]?.cid || vd?.cid || (g['__INITIAL_STATE__.cid'] ? JSON.parse(g['__INITIAL_STATE__.cid']) : null);
      const linkBvid = U.findLink(video, /\/video\/(BV\w{10})/)?.[1];
      if (linkBvid && linkBvid !== vd?.bvid) {
        bvid = linkBvid;
        cid = null;
      }
      if (bvid && !cid) {
        const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
        cid = view?.data?.pages?.[0]?.cid || view?.data?.cid;
      }
      let play = (cid && bili.get(`cid:${cid}`)) || null;
      if (!play && g.__playinfo__ && (!vd || vd.bvid === bvid)) {
        const pi = U.parseLoose(g.__playinfo__)[0];
        if (pi) {
          ingestBili(pi, cid ? `?cid=${cid}` : '');
          play = (cid && bili.get(`cid:${cid}`)) || bili.get('__latest');
        }
      }
      if (!play && bvid && cid) {
        const data = await fetchJson(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=127&fnval=4048&fnver=0&fourk=1`);
        if (data?.code && data.code !== 0) throw new SiteError(`빌리빌리 재생 정보 API 오류: ${data.message || data.code}`, '빌리빌리에 로그인한 뒤 새로고침하고 다시 시도하세요.');
        ingestBili(data, `?cid=${cid}&bvid=${bvid}`);
        play = bili.get(`cid:${cid}`);
      }
      if (!play) play = bili.byDuration(video.duration);
      if (!play) throw new SiteError('빌리빌리 영상의 재생 정보를 찾지 못했습니다.', '영상 페이지(/video/BV...)를 열고 재생한 뒤 다시 시도하세요.');
      const title = vd?.title || U.metaTitle().replace(/_哔哩哔哩_bilibili$/, '');
      return { id: `${bvid || 'bili'}${p > 1 ? `_p${p}` : ''}`, title, author: vd?.owner?.name || '', info: { play } };
    },
  });

  // ── Weibo ──
  const weibo = new Store();
  const ingestWeibo = (json) =>
    U.walk(json, (o) => {
      const mi = o.page_info?.media_info || (o.media_info && o.object_type !== undefined ? o.media_info : null);
      if (mi && (o.mblogid || o.id || o.idstr)) {
        weibo.put([o.mblogid, o.idstr, o.id, mi.media_id, o.page_info?.object_id], {
          id: String(o.mblogid || o.idstr || o.id),
          title: (o.text_raw || o.page_info?.content2 || o.page_info?.title || '').slice(0, 120),
          author: o.user?.screen_name || '',
          duration: Number(mi.duration) || 0,
          media: mi,
        });
      }
      const pi = o.Component_Play_Playinfo;
      if (pi && (pi.urls || pi.mid)) {
        weibo.put([pi.mid, pi.media_id, pi.oid], { id: String(pi.mid || pi.media_id), title: pi.title || '', author: pi.author || '', duration: Number(pi.duration_time) || 0, urls: pi.urls });
      }
      return false;
    });
  add({
    id: 'weibo',
    name: '웨이보',
    match: (h) => /(^|\.)weibo\.(com|cn)$/.test(h),
    offset: 52,
    ingest: ingestWeibo,
    async resolve(video) {
      const re = /weibo\.(?:com|cn)\/(?:\d+|detail|status)\/([A-Za-z0-9]{9,})/;
      let id = U.findLink(video, re)?.[1] || /\/(?:\d+|detail|status)\/([A-Za-z0-9]{9,})/.exec(location.pathname)?.[1];
      let item = id && weibo.get(id);
      const tv = /\/tv\/show\/(\d+:\w+)/.exec(location.pathname)?.[1];
      if (!item && tv) {
        const body = new URLSearchParams({ data: JSON.stringify({ Component_Play_Playinfo: { oid: tv } }) });
        const data = await fetchJson(`/tv/api/component?page=${encodeURIComponent(`/tv/show/${tv}`)}`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        ingestWeibo(data);
        item = weibo.get(tv.split(':')[1]) || weibo.latest();
      }
      if (!item && id) {
        const data = await fetchJson(`/ajax/statuses/show?id=${id}`);
        ingestWeibo(data);
        item = weibo.get(id);
      }
      if (!item) item = weibo.byDuration(video.duration);
      if (item) return { id: item.id, title: item.title, author: item.author, info: { media: item.media, urls: item.urls } };
      const src = video.currentSrc || video.src;
      if (/^https?:/.test(src)) return { id: id || 'weibo', title: U.metaTitle(), info: { direct: src } };
      throw new SiteError('이 웨이보 영상의 원본 주소를 찾지 못했습니다.', '게시물 시간을 클릭해 상세 페이지를 연 뒤 다시 시도하세요.');
    },
  });

  // ── Pinterest ──
  const pin = new Store();
  const ingestPin = (json) =>
    U.walk(json, (o) => {
      if (o.id && (o.videos?.video_list || o.story_pin_data || o.carousel_data) && /^\d+$/.test(String(o.id))) {
        const lists = [];
        U.walk(o, (x) => {
          if (x.video_list && typeof x.video_list === 'object') {
            lists.push(x.video_list);
            return true;
          }
          return false;
        });
        if (lists.length) {
          pin.put([o.id], { id: String(o.id), title: o.title || o.grid_title || o.description || '', author: o.pinner?.username || o.native_creator?.username || '', lists });
        }
        return true;
      }
      return false;
    });
  add({
    id: 'pinterest',
    name: '핀터레스트',
    match: (h) => /(^|\.)pinterest\./.test(h),
    offset: 52,
    ingest: ingestPin,
    init() {
      for (const id of ['__PWS_INITIAL_PROPS__', '__PWS_DATA__']) {
        const el = document.getElementById(id);
        if (el) U.parseLoose(el.textContent).forEach(ingestPin);
      }
    },
    async resolve(video) {
      const re = /\/pin\/(\d{6,})/;
      const id = U.findLink(video, re)?.[1] || re.exec(location.pathname)?.[1];
      let item = id && pin.get(id);
      if (!item && id) {
        const data = encodeURIComponent(JSON.stringify({ options: { id, field_set_key: 'detailed' }, context: {} }));
        const json = await fetchJson(`/resource/PinResource/get/?source_url=${encodeURIComponent(`/pin/${id}/`)}&data=${data}`, {
          headers: { 'X-Pinterest-PWS-Handler': 'www/pin/[id].js', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        });
        ingestPin(json?.resource_response?.data ? { ...json.resource_response.data } : json);
        item = pin.get(id);
      }
      if (!item) {
        const src = video.currentSrc || video.src;
        if (/^https?:.*\.(mp4|m3u8)/.test(src)) return { id: id || 'pin', title: U.metaTitle(), info: { lists: [{ V_SRC: { url: src } }] } };
        throw new SiteError('이 핀의 영상 정보를 찾지 못했습니다.', '핀을 클릭해 상세 화면(/pin/ 주소)을 연 뒤 다시 시도하세요.');
      }
      return { id: item.id, title: item.title, author: item.author, info: { lists: item.lists, duration: video.duration || 0 } };
    },
  });

  // ── Naver TV / 네이버 클립 / 블로그·카페 동영상 ──
  const naver = new Store();
  const naverKeys = new Map(); // videoId → inKey
  const ingestNaverText = (text, url) => {
    const vidFromUrl = /\/(?:vod\/play\/v2\.0|playback|vodplay\/v\d\/playback)\/([0-9A-F]{20,})/i.exec(url || '')?.[1];
    const keyFromUrl = /[?&]key=([^&]+)/.exec(url || '')?.[1];
    if (vidFromUrl && keyFromUrl) naverKeys.set(vidFromUrl, decodeURIComponent(keyFromUrl));
    if (/<MPD[\s>]/.test(text)) {
      naver.put([vidFromUrl || `mpd:${url}`], { id: vidFromUrl || 'naver', mpd: text, base: url, __vid: vidFromUrl });
      return;
    }
    for (const json of U.parseLoose(text)) {
      if (json?.videos?.list || json?.streams) {
        const meta = json.meta || {};
        const list = json.videos?.list || [];
        naver.put([vidFromUrl || meta.masterVideoId || list[0]?.id], {
          id: vidFromUrl || meta.masterVideoId || 'naver',
          title: meta.subject || '',
          author: meta.user?.name || '',
          duration: Number(list[0]?.duration) || Number(json.videos?.duration) || 0,
          play: { videos: json.videos, streams: json.streams },
        });
      }
      U.walk(json, (o) => {
        const vid = o.videoId || o.vid || o.masterVideoId;
        const key = o.inKey || o.inkey;
        if (vid && key) naverKeys.set(String(vid), String(key));
        return false;
      });
    }
  };
  add({
    id: 'naver',
    name: '네이버 TV·클립',
    match: (h) => /(^|\.)naver\.com$/.test(h),
    offset: 58,
    ingestText: ingestNaverText,
    init() {
      for (const t of U.scripts('script', /"(?:inKey|inkey)"\s*:/)) {
        for (const m of t.matchAll(/"(?:videoId|vid)"\s*:\s*"([0-9A-F]{20,})"[\s\S]{0,400}?"(?:inKey|inkey)"\s*:\s*"([^"]+)"/gi)) naverKeys.set(m[1], m[2]);
      }
    },
    async resolve(video) {
      const attrVid = U.matchAncestorAttr(video, ['data-video-id', 'data-vid', 'data-videoid'], /([0-9A-F]{20,})/i)?.[1];
      let item = (attrVid && naver.get(attrVid)) || naver.byDuration(video.duration);
      if (!item) {
        const all = naver.values();
        if (all.length === 1) item = all[0];
      }
      if (item) {
        return { id: item.id, title: item.title || U.metaTitle(), author: item.author, info: item.play ? { play: item.play } : { mpd: item.mpd, base: item.base } };
      }
      const pairs = [...naverKeys.entries()];
      const pair = (attrVid && naverKeys.has(attrVid) && [attrVid, naverKeys.get(attrVid)]) || pairs[pairs.length - 1];
      if (pair) return { id: pair[0], title: U.metaTitle(), bg: { kind: 'naver', videoId: pair[0], inKey: pair[1], duration: video.duration || 0 } };
      return { id: 'naver', title: U.metaTitle(), bg: { kind: 'naver', duration: video.duration || 0 } };
    },
  });

  // ── Vimeo ──
  const vimeo = new Store();
  const ingestVimeo = (json) => {
    U.walk(json, (o) => {
      if (o.request?.files && o.video?.id) {
        vimeo.put([o.video.id], { id: String(o.video.id), title: o.video.title || '', author: o.video.owner?.name || '', duration: Number(o.video.duration) || 0, config: { request: { files: o.request.files }, video: { id: o.video.id, title: o.video.title } } });
        return true;
      }
      return false;
    });
  };
  add({
    id: 'vimeo',
    name: '비메오',
    match: (h) => /(^|\.)vimeo\.com$/.test(h),
    offset: 64,
    ingest: ingestVimeo,
    async resolve(video, ctx) {
      const idFromUrl = /\/(?:video\/)?(\d{5,})/.exec(location.pathname)?.[1];
      let item = (idFromUrl && vimeo.get(idFromUrl)) || vimeo.byDuration(video.duration);
      if (!item) {
        const g = await ctx.globals(['playerConfig', 'vimeo.clip_page_config.player.config_url', '__vimeo_player_config']);
        for (const k of ['playerConfig', '__vimeo_player_config']) if (g[k]) U.parseLoose(g[k]).forEach(ingestVimeo);
        item = (idFromUrl && vimeo.get(idFromUrl)) || vimeo.latest();
        if (!item) {
          const cu = g['vimeo.clip_page_config.player.config_url'] && JSON.parse(g['vimeo.clip_page_config.player.config_url']);
          if (cu || idFromUrl) return { id: idFromUrl || 'vimeo', title: U.metaTitle(), bg: { kind: 'vimeo', configUrl: cu || '', id: idFromUrl || '' } };
        }
      }
      if (!item) throw new SiteError('비메오 플레이어 설정을 찾지 못했습니다.', '영상을 한 번 재생한 뒤 다시 시도하세요.');
      return { id: item.id, title: item.title, author: item.author, info: { config: item.config } };
    },
  });

  // ── Dailymotion ──
  add({
    id: 'dailymotion',
    name: '데일리모션',
    match: (h) => /(^|\.)dailymotion\.com$/.test(h),
    offset: 64,
    async resolve(video) {
      const xid =
        /\/video\/([a-z0-9]{5,})/i.exec(location.pathname)?.[1] ||
        /[?&]video=([a-z0-9]{5,})/i.exec(location.search)?.[1] ||
        U.findLink(video, /\/video\/([a-z0-9]{5,})/i)?.[1];
      if (!xid) return { id: 'dailymotion', title: U.metaTitle(), bg: { kind: 'sniff', duration: video.duration || 0 } };
      return { id: xid, title: U.metaTitle(), bg: { kind: 'dailymotion', xid } };
    },
  });

  // ── 그 밖의 모든 사이트(일반) ──
  const generic = {
    id: 'generic',
    name: '일반 사이트',
    match: () => true,
    offset: 56,
    async resolve(video) {
      const src = video.currentSrc || video.src || video.querySelector('source[src]')?.src || '';
      if (/^https?:/.test(src)) return { id: '', title: U.metaTitle(), info: { url: src } };
      return { id: '', title: U.metaTitle(), bg: { kind: 'sniff', duration: video.duration || 0 } };
    },
  };

  const pick = (host) => sites.find((s) => s.match(host)) || generic;

  // ── 사진: 화면의 <img> 에서 원본(가장 큰) 주소 찾기 ──
  function largestFromSrcset(img) {
    const set = img.getAttribute('srcset') || img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset') || '';
    let best = '';
    let bestW = 0;
    for (const part of set.split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      const w = d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1;
      if (u && w >= bestW) {
        bestW = w;
        best = u;
      }
    }
    return best ? U.abs(best) : '';
  }

  function originalImageUrls(img) {
    const cur = img.currentSrc || img.src || '';
    const big = largestFromSrcset(img) || cur;
    const out = [];
    const add = (u) => u && !out.includes(u) && out.push(u);
    try {
      const u = new URL(big, location.href);
      const h = u.hostname;
      if (h === 'pbs.twimg.com') {
        u.searchParams.set('name', 'orig');
        add(u.href);
      } else if (/(^|\.)pinimg\.com$/.test(h) && /^\/\d+x\d*\//.test(u.pathname)) {
        add(u.href.replace(/\/\d+x\d*\//, '/originals/'));
        add(u.href.replace(/\/\d+x\d*\//, '/736x/'));
      } else if (h === 'cdn.bsky.app') {
        add(u.href.replace(/\/img\/[a-z_]+\//, '/img/feed_fullsize/'));
      } else if (/sinaimg\.cn$/.test(h)) {
        add(u.href.replace(/\/(?:orj\d+|mw\d+|thumb\d+|bmiddle|wap\d+|small|square|crop\.[^/]+)\//, '/large/'));
      } else if (/pstatic\.net$/.test(h) && u.searchParams.has('type')) {
        const o = new URL(u.href);
        o.searchParams.delete('type');
        add(o.href);
      } else if (/googleusercontent\.com$|ggpht\.com$/.test(h)) {
        add(u.href.replace(/=[sw]\d+[^/?]*$/, '=s0'));
      }
    } catch {}
    add(big);
    add(cur);
    return out;
  }

  async function imageRequest(img) {
    const urls = originalImageUrls(img);
    if (!urls.length) throw new SiteError('사진 주소를 찾지 못했습니다.', '사진이 다 불러와진 뒤 다시 눌러 주세요.');
    const site = pick(location.hostname);
    // blob:/data: 사진은 페이지 안에서만 읽을 수 있어 여기서 데이터로 바꿔 넘긴다.
    if (/^blob:/.test(urls[0])) {
      const blob = await (await fetch(urls[0])).blob();
      urls[0] = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
    }
    const alt = (img.getAttribute('alt') || '').trim();
    const goodAlt = alt && alt.length > 2 && !/^(image|이미지|사진|photo)$/i.test(alt) ? alt.slice(0, 80) : '';
    let title = goodAlt || `${U.metaTitle().slice(0, 60)} 사진`;
    let author;
    if (site.id === 'bluesky') {
      // 고정된 탭 제목 대신 사진이 달린 게시물의 작성자·본문
      const post = bskyPost(img, '사진');
      title = post.found ? post.title : goodAlt || post.title;
      author = post.author || undefined;
    }
    return {
      id: '',
      title,
      author,
      info: { image: { url: urls[0], fallbacks: urls.slice(1), width: img.naturalWidth, height: img.naturalHeight } },
      siteNameOverride: site.name,
    };
  }

  globalThis.__SMD_SITES = { sites, generic, pick, U, SiteError, igMediaId, imageRequest, originalImageUrls, xUsers, bskyPost, bskyItemOf };
})();
