// 17개 사이트 + CDN 을 흉내 내는 로컬 HTTPS 서버.
// 크롬을 --host-resolver-rules="MAP * 127.0.0.1" 로 띄우면 실제 도메인 주소 그대로 이 서버로 들어온다.
// 각 사이트는 실제 서비스의 페이지 내장 데이터/API 응답 구조를 따라 만들었다.
// CDN 은 실제처럼 Referer·User-Agent 가 맞지 않으면 403 을 돌려준다(확장프로그램의 헤더 처리 검증용).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const MEDIA = path.resolve(here, '../fixtures/media');
export const log = [];

const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.jpg': 'image/jpeg' };

function serveFile(req, res, file, { type, extra = {} } = {}) {
  const full = path.join(MEDIA, file);
  if (!fs.existsSync(full)) {
    res.writeHead(404);
    return res.end('not found');
  }
  const size = fs.statSync(full).size;
  const ct = type || TYPES[path.extname(full)] || 'application/octet-stream';
  const h = { 'Content-Type': ct, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length', ...extra };
  const u = new URL(req.url, 'https://x');
  const rq = u.searchParams.get('range');
  if (rq) {
    const m = /(\d+)-(\d*)/.exec(rq);
    const s = Number(m[1]);
    const e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(200, { ...h, 'Content-Length': e - s + 1 });
    return fs.createReadStream(full, { start: s, end: e }).pipe(res);
  }
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const s = Number(m[1]);
    const e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (s >= size) {
      res.writeHead(416, { ...h, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 });
    return fs.createReadStream(full, { start: s, end: e }).pipe(res);
  }
  res.writeHead(200, { ...h, 'Content-Length': size });
  fs.createReadStream(full).pipe(res);
}

const json = (req, res, obj, status = 200) => {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.end(body);
};

const html = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
};

const esc = (s) => String(s).replace(/</g, '\\u003c');
const PREVIEW = 'https://cdn.example-videos.com/preview.webm';
const vtag = (attrs = '', w = 360, h = 640) => `<video src="${PREVIEW}" muted playsinline loop autoplay ${attrs} style="width:${w}px;height:${h}px;object-fit:cover;background:#000;display:block"></video>`;
const page = (title, body, script = '', head = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><meta property="og:title" content="${title}">${head}
<style>body{margin:0;background:#0f0f14;color:#eee;font-family:system-ui,sans-serif}.wrap{padding:24px;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}article,.card{background:#1b1b24;border-radius:12px;padding:10px}</style></head>
<body><div class="wrap">${body}</div>${script ? `<script>${script}</script>` : ''}</body></html>`;

// 실제 서비스처럼 Referer 검사
const needReferer = (req, res, prefix) => {
  const r = req.headers.referer || '';
  if (!r.startsWith(prefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(`referer required: ${prefix} (got "${r}")`);
    return false;
  }
  return true;
};

const IG_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const igId = (code) => {
  let id = 0n;
  for (const ch of code.slice(0, 11)) id = id * 64n + BigInt(IG_ALPHA.indexOf(ch));
  return id.toString();
};

const mpd = (reps) => `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT6S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period duration="PT6S">
<AdaptationSet segmentAlignment="true" contentType="video" mimeType="video/mp4">${reps.video.map((r) => `<Representation id="${r.id}" codecs="${r.codecs}" width="${r.w}" height="${r.h}" bandwidth="${r.bw}" FBQualityLabel="${Math.min(r.w, r.h)}p"><BaseURL>${r.url.replace(/&/g, '&amp;')}</BaseURL><SegmentBase indexRange="0-0"><Initialization range="0-0"/></SegmentBase></Representation>`).join('')}</AdaptationSet>
<AdaptationSet contentType="audio" mimeType="audio/mp4">${reps.audio.map((r) => `<Representation id="${r.id}" codecs="mp4a.40.2" bandwidth="${r.bw}" audioSamplingRate="44100"><BaseURL>${r.url.replace(/&/g, '&amp;')}</BaseURL></Representation>`).join('')}</AdaptationSet>
</Period></MPD>`;

// ─────────────────────────── 사이트별 처리 ───────────────────────────
const YT_UA = 'com.google.android.apps.youtube.vr';
const ytPlayer = (id, vertical) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: id, title: vertical ? '유튜브 쇼츠 테스트' : '유튜브 일반 영상 테스트', author: '테스트 채널', lengthSeconds: '6' },
  streamingData: {
    formats: [{ itag: 18, url: `https://rr1---sn-mock.googlevideo.com/videoplayback?itag=18&id=${id}&f=progressive_360p.mp4`, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', width: 640, height: 360, contentLength: String(fs.statSync(path.join(MEDIA, 'progressive_360p.mp4')).size) }],
    adaptiveFormats: [
      vertical
        ? { itag: 137, url: `https://rr1---sn-mock.googlevideo.com/videoplayback?itag=137&id=${id}&f=dash_video_vertical.mp4`, mimeType: 'video/mp4; codecs="avc1.640028"', width: 1080, height: 1920, fps: 30, bitrate: 4000000, contentLength: String(fs.statSync(path.join(MEDIA, 'dash_video_vertical.mp4')).size), qualityLabel: '1080p' }
        : { itag: 137, url: `https://rr1---sn-mock.googlevideo.com/videoplayback?itag=137&id=${id}&f=dash_video_avc.mp4`, mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, fps: 30, bitrate: 4000000, contentLength: String(fs.statSync(path.join(MEDIA, 'dash_video_avc.mp4')).size), qualityLabel: '1080p' },
      { itag: 247, url: `https://rr1---sn-mock.googlevideo.com/videoplayback?itag=247&id=${id}&f=dash_video_vp9.webm`, mimeType: 'video/webm; codecs="vp9"', width: 1280, height: 720, fps: 30, bitrate: 1500000, contentLength: String(fs.statSync(path.join(MEDIA, 'dash_video_vp9.webm')).size), qualityLabel: '720p' },
      { itag: 401, signatureCipher: 's=AAA&sp=sig&url=https%3A%2F%2Frr1---sn-mock.googlevideo.com%2Fciphered', mimeType: 'video/mp4; codecs="av01.0.12M.08"', width: 3840, height: 2160, qualityLabel: '2160p' },
      { itag: 140, url: `https://rr1---sn-mock.googlevideo.com/videoplayback?itag=140&id=${id}&f=dash_audio.m4a`, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: String(fs.statSync(path.join(MEDIA, 'dash_audio.m4a')).size) },
      { itag: 251, url: `https://rr1---sn-mock.googlevideo.com/videoplayback?itag=251&id=${id}&f=dash_audio_opus.webm`, mimeType: 'audio/webm; codecs="opus"', bitrate: 150000, contentLength: String(fs.statSync(path.join(MEDIA, 'dash_audio_opus.webm')).size) },
    ],
  },
});

const ytPage = (id, shorts) => page(
  shorts ? '유튜브 쇼츠 테스트 - YouTube' : '유튜브 일반 영상 테스트 - YouTube',
  `<div id="${shorts ? 'shorts-player' : 'movie_player'}" class="html5-video-player" style="position:relative;width:${shorts ? 360 : 854}px;height:${shorts ? 640 : 480}px">
     <div class="html5-video-container">${vtag('', shorts ? 360 : 854, shorts ? 640 : 480)}</div>
     <div class="ytp-chrome-bottom" style="position:absolute;left:0;right:0;bottom:0;height:48px;background:rgba(0,0,0,.5)"></div>
   </div>`,
  `document.querySelector('.html5-video-player').getVideoData = () => ({ video_id: '${id}', title: '${shorts ? '유튜브 쇼츠 테스트' : '유튜브 일반 영상 테스트'}', author: '테스트 채널', isLive: false });
   document.querySelector('.html5-video-player').getPlayerResponse = () => (!'${id}'.startsWith('YTpage') ? { videoDetails: { videoId: '${id}' } } : { videoDetails: { videoId: '${id}' }, streamingData: { adaptiveFormats: [
     { itag: 137, url: 'https://rr1---sn-mock.googlevideo.com/videoplayback?c=WEB&itag=137&f=dash_video_avc.mp4', mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, contentLength: '${fs.statSync(path.join(MEDIA, 'dash_video_avc.mp4')).size}' },
     { itag: 140, url: 'https://rr1---sn-mock.googlevideo.com/videoplayback?c=WEB&itag=140&f=dash_audio.m4a', mimeType: 'audio/mp4; codecs="mp4a.40.2"', contentLength: '${fs.statSync(path.join(MEDIA, 'dash_audio.m4a')).size}' } ] } });
   window.ytcfg = { data_: { VISITOR_DATA: 'CgtWaXNpdG9yMTIz' } };`,
);

function tiktokItem(id, desc, big) {
  return {
    id,
    desc,
    author: { uniqueId: 'tiktok_creator' },
    video: {
      duration: 6,
      width: 576,
      height: 1024,
      playAddr: `https://v16-webapp-prime.tiktok.com/video/tos/${id}/540.mp4`,
      downloadAddr: `https://v16-webapp-prime.tiktok.com/video/tos/${id}/watermark.mp4`,
      bitrateInfo: [
        { GearName: 'normal_720_0', Bitrate: 900000, CodecType: 'h264', PlayAddr: { Width: 720, Height: 1280, UrlList: [`https://v16-webapp-prime.tiktok.com/video/tos/${id}/720.mp4`] } },
        { GearName: 'normal_1080_0', Bitrate: 2400000, CodecType: 'h264', PlayAddr: { Width: 1080, Height: 1920, DataSize: 4596565, UrlList: [`https://v16-webapp-prime.tiktok.com/video/tos/${id}/${big}`, `https://v19-webapp-prime.tiktok.com/video/tos/${id}/${big}`] } },
      ],
    },
  };
}

const handlers = {
  // ── 공용 테스트 CDN / 일반 사이트 ──
  'cdn.example-videos.com': (req, res, u) => {
    if (u.pathname === '/__upload') {
      const out = path.join(process.env.E2E_OUT || '/tmp', path.basename(u.searchParams.get('name') || 'upload.bin'));
      const f = fs.createWriteStream(out);
      req.pipe(f);
      f.on('finish', () => json(req, res, { ok: true, path: out }));
      return;
    }
    if (u.pathname.startsWith('/hls_ts/')) return serveFile(req, res, u.pathname.slice(1));
    if (u.pathname.startsWith('/img/')) return serveFile(req, res, `images/${path.basename(u.pathname)}`);
    if (u.pathname === '/live/index.m3u8') {
      // 끝나지 않은 라이브 재생목록(#EXT-X-ENDLIST 없음)
      const seq = Math.floor(Date.now() / 2000);
      const body = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', `#EXT-X-MEDIA-SEQUENCE:${seq}`, '#EXTINF:2.0,', '/hls_ts/v1_seg0.ts', '#EXTINF:2.0,', '/hls_ts/v1_seg1.ts', '#EXTINF:2.0,', '/hls_ts/v1_seg2.ts'].join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' });
      return res.end(body);
    }
    if (u.searchParams.get('norange') === '1') {
      // Range 를 무시하고 항상 전체 파일을 200 으로 주는 서버
      const full = path.join(MEDIA, path.basename(u.pathname));
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(full).size });
      return fs.createReadStream(full).pipe(res);
    }
    serveFile(req, res, path.basename(u.pathname));
  },
  'www.example-videos.com': (req, res, u) => {
    if (u.pathname === '/watch') {
      return html(res, page('일반 사이트 영상', `<div class="card"><h3>일반 사이트</h3><video src="https://cdn.example-videos.com/progressive_1080p_land.mp4" controls muted style="width:640px;height:360px;background:#000"></video></div>`));
    }
    if (u.pathname === '/photos') {
      return html(res, page('사진 페이지', `<div class="card"><img class="photo" src="https://cdn.example-videos.com/img/photo.webp" style="width:480px"></div>
        <div class="card"><a href="/somewhere"><img class="photo" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px"></a></div>
        <div class="card"><img class="photo" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=small" style="width:480px"></div>`));
    }
    if (u.pathname === '/feed') {
      const items = Array.from({ length: 4 }, (_, i) => `<div class="card" style="position:relative;margin:30px 0"><p>게시물 ${i + 1}</p><video src="https://cdn.example-videos.com/progressive_360p.mp4" muted style="width:360px;height:420px;background:#000;display:block"></video></div>`).join('');
      return html(res, page('피드', `<div style="display:block">${items}</div>`));
    }
    if (u.pathname === '/norange') {
      return html(res, page('Range 미지원 서버', `<div class="card"><video src="https://cdn.example-videos.com/progressive_1080x1920.mp4?norange=1" muted style="width:360px;height:640px;background:#000"></video></div>`));
    }
    if (u.pathname === '/live') {
      return html(res, page('라이브 방송', `<div class="card"><video src="https://cdn.example-videos.com/live/index.m3u8" muted style="width:640px;height:360px;background:#000"></video></div>`));
    }
    if (u.pathname === '/blob') {
      return html(res, page('스트리밍 사이트', `<div class="card"><h3>blob 재생 사이트</h3><video id="v" muted style="width:640px;height:360px;background:#000"></video></div>`,
        `fetch('https://cdn.example-videos.com/hls_ts/master.m3u8').then(r=>r.text()).then(()=>{ const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms); });`));
    }
    res.writeHead(404);
    res.end();
  },

  // ── YouTube ──
  'www.youtube.com': (req, res, u) => {
    if (u.pathname === '/watch') return html(res, ytPage(u.searchParams.get('v'), false));
    if (u.pathname.startsWith('/shorts/')) return html(res, ytPage(u.pathname.split('/')[2], true));
    if (u.pathname === '/youtubei/v1/player') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const b = JSON.parse(body || '{}');
        log.push({ host: 'www.youtube.com', path: u.pathname, ua: req.headers['user-agent'], origin: req.headers.origin, client: b.context?.client?.clientName, videoId: b.videoId });
        if (b.videoId === 'YTlogin0001') return json(req, res, { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' } });
        if (b.videoId.startsWith('YTpage')) return json(req, res, { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [{ itag: 137, signatureCipher: 's=AAA&url=x', mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080 }] } });
        json(req, res, ytPlayer(b.videoId, b.videoId.startsWith('YTshort')));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  },
  'rr1---sn-mock.googlevideo.com': (req, res, u) => {
    if (u.searchParams.get('c') !== 'WEB' && !String(req.headers['user-agent'] || '').includes(YT_UA)) {
      res.writeHead(403);
      return res.end('client user-agent mismatch');
    }
    serveFile(req, res, u.searchParams.get('f'));
  },

  // ── TikTok ──
  'www.tiktok.com': (req, res, u) => {
    if (/^\/@[^/]+\/video\/\d+/.test(u.pathname)) {
      const id = u.pathname.split('/').pop();
      const item = id.endsWith('9') ? tiktokItem(id, '만료된 영상', 'expired.mp4') : tiktokItem(id, '틱톡 상세 영상 테스트 #shorts', 'progressive_1080x1920.mp4');
      const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: item } } } };
      return html(res, page('틱톡 테스트 | TikTok',
        `<div id="xgwrapper-0-${id}" class="xgplayer">${vtag()}</div>
         <div id="feed"></div>`,
        id.endsWith('9') ? '' : `fetch('/api/recommend/item_list/?count=1').then(r => r.json()).then(d => {
           const it = d.itemList[0];
           document.getElementById('feed').innerHTML = '<div id="xgwrapper-1-' + it.id + '" class="xgplayer">${vtag().replace(/"/g, '\\"')}</div>';
         });`,
        `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${esc(JSON.stringify(data))}</script>`));
    }
    if (u.pathname.startsWith('/api/recommend/item_list')) {
      return json(req, res, { statusCode: 0, itemList: [tiktokItem('7300000000000000002', '추천 피드 두 번째 영상', 'progressive_1080x1920.mp4')] });
    }
    res.writeHead(404);
    res.end();
  },
  'v16-webapp-prime.tiktok.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://www.tiktok.com/')) return;
    const f = path.basename(u.pathname);
    if (f === 'expired.mp4' || u.pathname.includes('7300000000000000009')) {
      res.writeHead(403);
      return res.end('expired');
    }
    serveFile(req, res, f === 'progressive_1080x1920.mp4' ? f : 'progressive_360p.mp4');
  },
  'v19-webapp-prime.tiktok.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://www.tiktok.com/')) return;
    if (path.basename(u.pathname) === 'expired.mp4' || u.pathname.includes('7300000000000000009')) {
      res.writeHead(403);
      return res.end('expired');
    }
    serveFile(req, res, 'progressive_1080x1920.mp4');
  },

  // ── Instagram ──
  'www.instagram.com': (req, res, u) => {
    if (u.pathname.startsWith('/reel/CmockReel01')) {
      const item = {
        code: 'CmockReel01',
        pk: igId('CmockReel01'),
        id: `${igId('CmockReel01')}_99`,
        video_duration: 6,
        caption: { text: '인스타 릴스 테스트' },
        user: { username: 'insta_tester' },
        video_versions: [{ type: 101, width: 720, height: 1280, url: 'https://scontent-icn2-1.cdninstagram.com/o1/v/t16/p720.mp4?efg=1&oh=abc' }],
        video_dash_manifest: mpd({
          video: [
            { id: 'v1080', codecs: 'avc1.640028', w: 1080, h: 1920, bw: 3500000, url: 'https://scontent-icn2-1.cdninstagram.com/o1/v/t2/v1080.mp4?efg=2&oh=def' },
            { id: 'v540', codecs: 'avc1.4d401f', w: 540, h: 960, bw: 900000, url: 'https://scontent-icn2-1.cdninstagram.com/o1/v/t2/v540.mp4' },
          ],
          audio: [{ id: 'a1', bw: 128000, url: 'https://scontent-icn2-1.cdninstagram.com/o1/v/t2/audio.m4a?efg=3' }],
        }),
      };
      const sjs = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_PolarisPostRoot', { __bbox: { result: { data: { xdt_api__v1__media__shortcode__web_info: { items: [item] } } } } }]]] } }]]] };
      return html(res, page('인스타그램 릴스', `<article><a href="/reel/CmockReel01/">릴스 링크</a>${vtag()}</article>
        <article><a href="/p/CmockPost02/">게시물 링크</a>${vtag()}</article>`, '', `<script type="application/json" data-sjs>${esc(JSON.stringify(sjs))}</script>`));
    }
    const m = /^\/api\/v1\/media\/(\d+)\/info\/$/.exec(u.pathname);
    if (m) {
      log.push({ host: 'www.instagram.com', path: u.pathname, appId: req.headers['x-ig-app-id'] });
      if (m[1] !== igId('CmockPost02') || req.headers['x-ig-app-id'] !== '936619743392459') return json(req, res, { message: 'bad' }, 400);
      return json(req, res, { items: [{ code: 'CmockPost02', pk: m[1], video_duration: 6, caption: { text: 'API 로 찾은 게시물' }, user: { username: 'insta_tester' }, video_versions: [{ width: 1080, height: 1920, url: 'https://scontent-icn2-1.cdninstagram.com/o1/v/t16/p1080.mp4' }] }] });
    }
    res.writeHead(404);
    res.end();
  },
  'scontent-icn2-1.cdninstagram.com': (req, res, u) => {
    const f = path.basename(u.pathname);
    const map = { 'p720.mp4': 'progressive_360p.mp4', 'v1080.mp4': 'dash_video_vertical.mp4', 'v540.mp4': 'dash_video_avc.mp4', 'audio.m4a': 'dash_audio.m4a', 'p1080.mp4': 'progressive_1080x1920.mp4' };
    serveFile(req, res, map[f] || f);
  },

  // ── Facebook ──
  'www.facebook.com': (req, res, u) => {
    if (u.pathname.startsWith('/reel/1234567890123')) {
      const video = {
        __typename: 'Video',
        id: '1234567890123',
        videoId: '1234567890123',
        playable_duration_in_ms: 6000,
        browser_native_hd_url: 'https://video-icn1-1.xx.fbcdn.net/v/t42/hd.mp4?_nc_cat=1&oh=x',
        browser_native_sd_url: 'https://video-icn1-1.xx.fbcdn.net/v/t42/sd.mp4?_nc_cat=1',
        all_video_dash_prefetch_representations: [{
          video_id: '1234567890123',
          representations: [
            { base_url: 'https://video-icn1-1.xx.fbcdn.net/v/t42/v1080.mp4?bytestart=0', mime_type: 'video/mp4', codecs: 'avc1.640028', width: 1080, height: 1920, bandwidth: 3200000 },
            { base_url: 'https://video-icn1-1.xx.fbcdn.net/v/t42/v360.mp4', mime_type: 'video/mp4', codecs: 'avc1.4d401e', width: 360, height: 640, bandwidth: 400000 },
            { base_url: 'https://video-icn1-1.xx.fbcdn.net/v/t42/audio.mp4', mime_type: 'audio/mp4', codecs: 'mp4a.40.5', bandwidth: 64000 },
          ],
        }],
      };
      const blob = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_FBReelsRootQuery', { __bbox: { result: { data: { video } } } }]]] } }]]] };
      return html(res, page('페이스북 릴스', `<div class="card" data-pagelet="Reels">${vtag()}</div>`, '', `<script type="application/json" data-content-len="1" data-sjs>${esc(JSON.stringify(blob))}</script>`));
    }
    res.writeHead(404);
    res.end();
  },
  'video-icn1-1.xx.fbcdn.net': (req, res, u) => {
    const map = { 'hd.mp4': 'progressive_360p.mp4', 'sd.mp4': 'progressive_360p.mp4', 'v1080.mp4': 'dash_video_vertical.mp4', 'v360.mp4': 'dash_video_avc.mp4', 'audio.mp4': 'dash_audio.m4a' };
    serveFile(req, res, map[path.basename(u.pathname)] || 'missing');
  },

  // ── X ──
  'x.com': (req, res, u) => {
    if (u.pathname === '/tester/status/1790000000000000001') {
      return html(res, page('X 게시물', `<article data-testid="tweet"><a href="/tester/status/1790000000000000001"><time datetime="2026-09-30">9월 30일</time></a>
          ${vtag('poster="https://pbs.twimg.com/ext_tw_video_thumb/1790000000000000999/pu/img/thumb.jpg"')}</article>`,
        `fetch('/i/api/graphql/abc123/TweetDetail?variables=%7B%7D').then(r=>r.json());`));
    }
    if (u.pathname === '/tester/status/1790000000000000002') {
      return html(res, page('X 게시물 (신디케이션)', `<article data-testid="tweet"><a href="/tester/status/1790000000000000002"><time>9월 30일</time></a>${vtag()}</article>`));
    }
    if (u.pathname.includes('/TweetDetail')) {
      const tweet = {
        __typename: 'Tweet',
        rest_id: '1790000000000000001',
        core: { user_results: { result: { legacy: { screen_name: 'tester' } } } },
        legacy: {
          id_str: '1790000000000000001',
          full_text: 'X 영상 테스트 게시물',
          extended_entities: { media: [{ id_str: '1790000000000000999', media_key: '7_1790000000000000999', type: 'video', original_info: { width: 1080, height: 1920 }, video_info: { duration_millis: 6000, variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/1790000000000000999/pu/pl/master.m3u8' },
            { content_type: 'video/mp4', bitrate: 632000, url: 'https://video.twimg.com/ext_tw_video/1790000000000000999/pu/vid/avc1/320x568/low.mp4' },
            { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.com/ext_tw_video/1790000000000000999/pu/vid/avc1/1080x1920/high.mp4' },
          ] } }] },
        },
      };
      return json(req, res, { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries: [{ content: { itemContent: { tweet_results: { result: tweet } } } }] }] } } });
    }
    res.writeHead(404);
    res.end();
  },
  'video.twimg.com': (req, res, u) => serveFile(req, res, u.pathname.endsWith('high.mp4') || u.pathname.endsWith('synd.mp4') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4'),
  'pbs.twimg.com': (req, res, u) => {
    if (u.pathname === '/media/MockPic') return serveFile(req, res, u.searchParams.get('name') === 'orig' ? 'images/x_orig.jpg' : 'images/x_small.jpg');
    res.writeHead(404);
    res.end();
  },
  'cdn.syndication.twimg.com': (req, res, u) => {
    log.push({ host: 'cdn.syndication.twimg.com', id: u.searchParams.get('id'), token: u.searchParams.get('token') });
    if (u.searchParams.get('id') !== '1790000000000000002' || !u.searchParams.get('token')) return json(req, res, {}, 404);
    json(req, res, { text: 'X 신디케이션으로 찾은 영상', user: { screen_name: 'tester' }, mediaDetails: [{ type: 'video', id_str: '1790000000000000888', video_info: { duration_millis: 6000, variants: [{ content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/amplify_video/1790000000000000888/vid/avc1/1080x1920/synd.mp4' }] } }] });
  },

  // ── Bluesky ──
  'bsky.app': (req, res, u) => {
    const m = /^\/profile\/([^/]+)\/post\/([a-z0-9]+)/.exec(u.pathname);
    if (m) {
      const cid = m[2] === '3kmockpost2' ? 'bafkreimocknoblob0000000000000000000000000000000000002' : 'bafkreimockoriginal000000000000000000000000000000000001';
      return html(res, page('블루스카이 게시물', `<div class="card"><a href="/profile/${m[1]}/post/${m[2]}">게시물</a>${vtag(`poster="https://video.bsky.app/watch/did%3Aplc%3Amockalice/${cid}/thumbnail.jpg"`, 480, 360)}</div>`));
    }
    res.writeHead(404);
    res.end();
  },
  'plc.directory': (req, res, u) => {
    if (u.pathname === '/did:plc:mockalice') {
      return json(req, res, { id: 'did:plc:mockalice', service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://bsky.social' }] });
    }
    json(req, res, { message: 'not found' }, 404);
  },
  'bsky.social': (req, res, u) => {
    if (u.pathname === '/xrpc/com.atproto.sync.getBlob') {
      if (u.searchParams.get('cid')?.includes('noblob')) return json(req, res, { error: 'BlobNotFound' }, 400);
      return serveFile(req, res, 'original_upload.mov', { type: 'video/quicktime' });
    }
    res.writeHead(404);
    res.end();
  },
  'video.bsky.app': (req, res, u) => {
    const m = /\/watch\/[^/]+\/[^/]+\/(.+)$/.exec(u.pathname);
    if (!m) {
      res.writeHead(404);
      return res.end();
    }
    if (m[1] === 'playlist.m3u8') return serveFile(req, res, 'hls_ts/master.m3u8');
    if (m[1] === 'thumbnail.jpg') {
      res.writeHead(404);
      return res.end();
    }
    serveFile(req, res, `hls_ts/${m[1]}`);
  },

  // ── Xiaohongshu ──
  'www.xiaohongshu.com': (req, res, u) => {
    const m = /^\/explore\/([0-9a-f]{24})/.exec(u.pathname);
    if (m) {
      const state = { note: { noteDetailMap: { [m[1]]: { note: { noteId: m[1], title: '샤오홍슈 영상 노트', type: 'video', user: { nickname: '레드노트' }, video: { capa: { duration: 6 }, consumer: { originVideoKey: 'pre_post/1040g2t0mockorigin' }, media: { stream: { h264: [{ masterUrl: 'http://sns-video-bd.xhscdn.com/stream/110/258/720.mp4', backupUrls: [], width: 720, height: 1280, videoBitrate: 900000 }], h265: [], av1: [] } } } } } } } };
      return html(res, page('샤오홍슈 - 小红书', `<div class="card note-container">${vtag()}</div>`, `window.__INITIAL_STATE__ = ${JSON.stringify(state)};`));
    }
    res.writeHead(404);
    res.end();
  },
  'sns-video-bd.xhscdn.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://www.xiaohongshu.com/')) return;
    serveFile(req, res, u.pathname.includes('mockorigin') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4');
  },

  // ── Snapchat ──
  'www.snapchat.com': (req, res, u) => {
    if (u.pathname.startsWith('/spotlight/')) {
      const next = { props: { pageProps: { spotlightFeed: { spotlightStories: [{ story: { snapList: [{ snapId: { value: 'W7_mocksnap' }, snapMediaType: 1, snapUrls: { mediaUrl: 'https://cf-st.sc-cdn.net/d/mockSnapOriginal.mp4?mo=abc', mediaPreviewUrl: { value: 'https://cf-st.sc-cdn.net/d/preview.jpg' } } }] } }] } } } };
      return html(res, page('스냅챗 스포트라이트', `<div class="card"><video src="https://cf-st.sc-cdn.net/d/mockSnapOriginal.mp4?mo=abc" muted playsinline style="width:360px;height:640px;background:#000;display:block"></video></div>`, '', `<script id="__NEXT_DATA__" type="application/json">${esc(JSON.stringify(next))}</script>`));
    }
    res.writeHead(404);
    res.end();
  },
  'cf-st.sc-cdn.net': (req, res) => serveFile(req, res, 'progressive_1080x1920.mp4'),

  // ── Douyin ──
  'www.douyin.com': (req, res, u) => {
    const m = /^\/video\/(\d+)/.exec(u.pathname);
    if (m) {
      return html(res, page('도우인 - 抖音', `<div data-e2e="feed-active-video" data-e2e-vid="${m[1]}">${vtag()}</div>`,
        `fetch('/aweme/v1/web/aweme/detail/?aweme_id=${m[1]}&device_platform=webapp').then(r=>r.json());`));
    }
    if (u.pathname.startsWith('/aweme/v1/web/aweme/detail/')) {
      const id = u.searchParams.get('aweme_id');
      return json(req, res, { status_code: 0, aweme_detail: { aweme_id: id, desc: '도우인 테스트 영상', author: { nickname: '抖音作者' }, duration: 6000, video: {
        width: 720, height: 1280, duration: 6000,
        play_addr: { url_list: ['https://v26-web.douyinvod.com/mock/720/'], width: 720, height: 1280 },
        bit_rate: [
          { gear_name: 'normal_1080_0', bit_rate: 2800000, is_h265: 0, play_addr: { url_list: ['http://v26-web.douyinvod.com/mock/1080/', 'https://v3-web.douyinvod.com/mock/1080/'], width: 1080, height: 1920, data_size: 4596565 } },
          { gear_name: 'normal_540_0', bit_rate: 800000, is_h265: 1, play_addr: { url_list: ['https://v26-web.douyinvod.com/mock/540/'], width: 576, height: 1024 } },
        ],
      } } });
    }
    res.writeHead(404);
    res.end();
  },
  'v26-web.douyinvod.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://www.douyin.com/')) return;
    serveFile(req, res, u.pathname.includes('/1080/') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4');
  },

  // ── Kuaishou ──
  'www.kuaishou.com': (req, res, u) => {
    const m = /^\/short-video\/([\w-]+)/.exec(u.pathname);
    if (m) {
      const state = { defaultClient: { [`VisionVideoDetailPhoto:${m[1]}`]: { id: m[1], caption: '콰이쇼우 테스트 영상', duration: 6000, photoUrl: 'https://v2.kwaicdn.com/upic/mock/720.mp4', manifest: { type: 'json', json: { version: '1.0', adaptationSet: [{ id: 1, duration: 6000, representation: [
        { id: 1, url: 'https://v2.kwaicdn.com/ksc2/mock/1080.mp4', backupUrl: ['https://v1.kwaicdn.com/ksc2/mock/1080.mp4'], width: 1080, height: 1920, avgBitrate: 2500, maxBitrate: 3000, qualityType: '1080p' },
        { id: 2, url: 'https://v2.kwaicdn.com/ksc2/mock/720.mp4', width: 720, height: 1280, avgBitrate: 1200, qualityType: '720p' },
      ] }] } } } } };
      return html(res, page('콰이쇼우 - 快手', `<div class="card">${vtag()}</div>`, `window.__APOLLO_STATE__ = ${JSON.stringify(state)};`));
    }
    res.writeHead(404);
    res.end();
  },
  'v2.kwaicdn.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://www.kuaishou.com/')) return;
    serveFile(req, res, u.pathname.endsWith('1080.mp4') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4');
  },

  // ── Bilibili ──
  'www.bilibili.com': (req, res, u) => {
    const m = /^\/video\/(BV\w{10})/.exec(u.pathname);
    if (m) {
      const playinfo = { code: 0, data: { quality: 80, timelength: 6000, accept_description: ['高清 1080P', '高清 720P'], dash: { duration: 6, video: [
        { id: 80, baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/mock/1080-avc.m4s?e=1', backupUrl: ['https://upos-sz-mirrorali.bilivideo.com/upgcxcode/mock/1080-avc.m4s?e=1'], bandwidth: 3000000, mimeType: 'video/mp4', codecs: 'avc1.640032', width: 1920, height: 1080, frameRate: '30', codecid: 7 },
        { id: 64, baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/mock/720-vp9.m4s?e=1', bandwidth: 1200000, mimeType: 'video/mp4', codecs: 'hev1.1.6.L120.90', width: 1280, height: 720, frameRate: '30', codecid: 12 },
      ], audio: [
        { id: 30216, baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/mock/a64.m4s', bandwidth: 64000, codecs: 'mp4a.40.2' },
        { id: 30280, baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/mock/a192.m4s', bandwidth: 192000, codecs: 'mp4a.40.2' },
      ] } } };
      const state = { videoData: { bvid: m[1], aid: 1001, cid: 5550001, title: '빌리빌리 테스트 영상', owner: { name: 'UP主测试' }, pages: [{ cid: 5550001, page: 1 }] }, p: 1 };
      return html(res, page('빌리빌리 테스트 영상_哔哩哔哩_bilibili', `<div class="bpx-player-container">${vtag('', 854, 480)}</div>`, `window.__playinfo__ = ${JSON.stringify(playinfo)}; window.__INITIAL_STATE__ = ${JSON.stringify(state)};`));
    }
    res.writeHead(404);
    res.end();
  },
  'upos-sz-mirrorcos.bilivideo.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://www.bilibili.com/')) return;
    const f = path.basename(u.pathname);
    const map = { '1080-avc.m4s': 'dash_video_avc.mp4', '720-vp9.m4s': 'dash_video_vp9.webm', 'a64.m4s': 'dash_audio.m4a', 'a192.m4s': 'dash_audio.m4a' };
    serveFile(req, res, map[f] || 'missing', { type: 'video/mp4' });
  },

  // ── Weibo ──
  'weibo.com': (req, res, u) => {
    if (u.pathname === '/1234567890/MockWb123') {
      return html(res, page('웨이보', `<div class="card wbpro-feed"><a href="https://weibo.com/1234567890/MockWb123">게시물 시간</a>${vtag()}</div>`, `fetch('/ajax/statuses/show?id=MockWb123&locale=ko').then(r=>r.json());`));
    }
    if (u.pathname === '/ajax/statuses/show') {
      return json(req, res, { ok: 1, idstr: '5000000000000001', mblogid: 'MockWb123', text_raw: '웨이보 영상 테스트', user: { screen_name: '微博用户' }, page_info: { object_type: 'video', object_id: '1034:5000000000000001', media_info: { duration: 6, mp4_sd_url: 'https://f.video.weibocdn.com/o0/sd.mp4', playback_list: [
        { meta: { label: 'mp4_1080p', quality_label: '1080P' }, play_info: { url: '//f.video.weibocdn.com/o0/1080.mp4?label=mp4_1080p', width: 1080, height: 1920, bitrate: 2800 } },
        { meta: { label: 'mp4_720p' }, play_info: { url: '//f.video.weibocdn.com/o0/720.mp4?label=mp4_720p', width: 720, height: 1280, bitrate: 1200 } },
      ] } } });
    }
    res.writeHead(404);
    res.end();
  },
  'f.video.weibocdn.com': (req, res, u) => {
    if (!needReferer(req, res, 'https://weibo.com/')) return;
    serveFile(req, res, u.pathname.includes('1080') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4');
  },

  // ── Pinterest ──
  'www.pinterest.com': (req, res, u) => {
    if (u.pathname.startsWith('/pin/9876543210')) {
      const props = { initialReduxState: { pins: { 9876543210: { id: '9876543210', title: '핀터레스트 영상 핀', pinner: { username: 'pinner' }, videos: { id: 'v1', video_list: {
        V_720P: { url: 'https://v1.pinimg.com/videos/mc/720p/mock.mp4', width: 720, height: 1280, duration: 6000 },
        V_HLSV4: { url: 'https://v1.pinimg.com/videos/mc/hls/mock/master.m3u8', width: 1080, height: 1920, duration: 6000 },
      } } } } } };
      return html(res, page('Pinterest', `<div class="card"><a href="/pin/9876543210/">핀</a>${vtag()}</div>`, '', `<script id="__PWS_INITIAL_PROPS__" type="application/json">${esc(JSON.stringify(props))}</script>`));
    }
    res.writeHead(404);
    res.end();
  },
  'v1.pinimg.com': (req, res, u) => {
    if (u.pathname.endsWith('/720p/mock.mp4')) return serveFile(req, res, 'progressive_360p.mp4');
    const m = /\/hls\/mock\/(.+)$/.exec(u.pathname);
    if (m) return serveFile(req, res, `hls_fmp4/${m[1]}`);
    res.writeHead(404);
    res.end();
  },

  // ── Naver TV / 네이버 클립 ──
  'tv.naver.com': (req, res, u) => {
    if (u.pathname === '/v/12345678') {
      return html(res, page('네이버 TV 테스트 : 네이버 TV', `<div class="card webplayer-internal-source-wrapper">${vtag('', 854, 480)}</div>`,
        `fetch('https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/6A1F9D0C2B7E4F3A8C5D1E2F3A4B5C6D7E8F?key=V12mockInKeyNaver&sid=2003', { credentials: 'include' }).then(r=>r.json());`));
    }
    res.writeHead(404);
    res.end();
  },
  'm.naver.com': (req, res, u) => {
    if (u.pathname.startsWith('/shorts')) {
      return html(res, page('네이버 클립', `<div class="card shortform">${vtag()}</div>`,
        `fetch('https://apis.naver.com/neonplayer/vodplay/v2/playback/7B2E8A1C9D0F3E4A5B6C7D8E9F0A1B2C3D4E?key=V13mockClipKey', { credentials: 'include' }).then(r=>r.text());`));
    }
    res.writeHead(404);
    res.end();
  },
  'apis.naver.com': (req, res, u) => {
    if (u.pathname.startsWith('/rmcnmv/rmcnmv/vod/play/v2.0/')) {
      return json(req, res, { meta: { subject: '네이버 TV 테스트 클립', user: { name: '네이버 채널' } }, videos: { type: 'MP4', list: [
        { id: 'v360', duration: 6, encodingOption: { id: '360P', name: '360P', width: 640, height: 360 }, bitrate: { video: 600, audio: 128 }, size: 606571, source: 'https://b01-kr-naver-vod.pstatic.net/navertv/c/read/v2/VOD_ALPHA/mock/360.mp4?_lsu_sa_=x' },
        { id: 'v1080', duration: 6, encodingOption: { id: '1080P', name: '1080P', width: 1920, height: 1080 }, bitrate: { video: 4000, audio: 192 }, size: 4100625, source: 'https://b01-kr-naver-vod.pstatic.net/navertv/c/read/v2/VOD_ALPHA/mock/1080.mp4?_lsu_sa_=y' },
      ] }, streams: [] });
    }
    if (u.pathname.startsWith('/neonplayer/vodplay/v2/playback/')) {
      res.writeHead(200, { 'Content-Type': 'application/dash+xml', 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true' });
      return res.end(mpd({
        video: [{ id: 'v1080', codecs: 'avc1.640028', w: 1080, h: 1920, bw: 3000000, url: 'https://b01-kr-naver-vod.pstatic.net/clip/mock/v1080.mp4' }, { id: 'v480', codecs: 'avc1.4d401f', w: 480, h: 854, bw: 700000, url: 'https://b01-kr-naver-vod.pstatic.net/clip/mock/v480.mp4' }],
        audio: [{ id: 'a', bw: 128000, url: 'https://b01-kr-naver-vod.pstatic.net/clip/mock/audio.m4a' }],
      }));
    }
    res.writeHead(404);
    res.end();
  },
  'b01-kr-naver-vod.pstatic.net': (req, res, u) => {
    if (!needReferer(req, res, 'https://tv.naver.com/')) return;
    const f = path.basename(u.pathname);
    const map = { '360.mp4': 'progressive_360p.mp4', '1080.mp4': 'progressive_1080p_land.mp4', 'v1080.mp4': 'dash_video_vertical.mp4', 'v480.mp4': 'dash_video_avc.mp4', 'audio.m4a': 'dash_audio.m4a' };
    serveFile(req, res, map[f] || 'missing');
  },

  // ── Vimeo ──
  'vimeo.com': (req, res, u) => {
    if (u.pathname === '/76979871') {
      return html(res, page('비메오 테스트 영상 on Vimeo', `<div class="card"><iframe src="https://player.vimeo.com/video/76979871?h=8272103f6e" width="720" height="405" frameborder="0" allow="autoplay; fullscreen"></iframe></div>`));
    }
    res.writeHead(404);
    res.end();
  },
  'player.vimeo.com': (req, res, u) => {
    if (u.pathname === '/video/76979871') {
      const config = { video: { id: 76979871, title: '비메오 테스트 영상', duration: 6, owner: { name: 'Vimeo Creator' } }, request: { files: {
        progressive: [{ profile: 165, width: 960, height: 540, fps: 30, quality: '540p', url: 'https://vod-progressive.akamaized.vimeocdn.com/mock/540.mp4' }],
        hls: { default_cdn: 'akfire_interconnect_quic', cdns: { akfire_interconnect_quic: { url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1/mock/master.m3u8', avc_url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1/mock/master.m3u8' } } },
      } } };
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>player</title></head><body style="margin:0;background:#000">${vtag('', 720, 405)}<script>window.playerConfig = ${JSON.stringify(config)};</script></body></html>`);
    }
    res.writeHead(404);
    res.end();
  },
  'vod-adaptive-ak.vimeocdn.com': (req, res, u) => serveFile(req, res, `hls_fmp4/${path.basename(u.pathname)}`),
  'vod-progressive.akamaized.vimeocdn.com': (req, res) => serveFile(req, res, 'progressive_360p.mp4'),

  // ── Dailymotion ──
  'www.dailymotion.com': (req, res, u) => {
    if (u.pathname === '/video/x8mock1' || u.pathname === '/video/x8private') return html(res, page('데일리모션 테스트 - Dailymotion', `<div class="card">${vtag('', 854, 480)}</div>`));
    if (u.pathname === '/player/metadata/video/x8mock1') {
      return json(req, res, { id: 'x8mock1', title: '데일리모션 테스트 영상', owner: { screenname: 'DM Channel' }, qualities: { auto: [{ type: 'application/x-mpegURL', url: 'https://cdndirector.dailymotion.com/cdn/manifest/video/x8mock1.m3u8?sec=mock' }] } });
    }
    if (u.pathname === '/player/metadata/video/x8private') {
      return json(req, res, { error: { type: 'private', title: '비공개 영상입니다' } });
    }
    res.writeHead(404);
    res.end();
  },
  'cdndirector.dailymotion.com': (req, res) => {
    // 마스터 재생목록: 변형 재생목록은 다른 CDN(dmcdn.net)에 있다
    const text = fs.readFileSync(path.join(MEDIA, 'hls_ts/master.m3u8'), 'utf8').replace(/^(v\d\.m3u8)$/gm, 'https://proxy-21.dmcdn.net/sec(mock)/video/$1');
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' });
    res.end(text);
  },
  'proxy-21.dmcdn.net': (req, res, u) => serveFile(req, res, `hls_ts/${path.basename(u.pathname)}`),
};

export function start(port = 443) {
  const certs = path.join(here, 'certs');
  const server = https.createServer({ key: fs.readFileSync(path.join(certs, 'server.key')), cert: fs.readFileSync(path.join(certs, 'server.crt')) }, (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const u = new URL(req.url, `https://${host}`);
    log.push({ host, path: u.pathname, method: req.method, referer: req.headers.referer || '', ua: req.headers['user-agent'] || '', range: req.headers.range || u.searchParams.get('range') || '' });
    const h = handlers[host];
    if (!h) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end(`no mock for ${host}`);
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      return res.end();
    }
    try {
      h(req, res, u);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
