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
// 실제 X 처럼 게시물 ⋯ 메뉴: '@아이디 님 팔로우하기 / 언팔로우하기'. 누르면 X 페이지 코드가 보안 값(x-client-transaction-id)을 붙여 직접 요청한다.
// react_user 는 메뉴에 팔로우 항목이 없다(확장의 직접 요청 경로 시험용).
const XMENU = `
  window.__fol = Object.assign({ followed_user: true }, window.__fol || {});
  const XIDS = { followed_user: '1001', new_user: '2002', react_user: '3003', auto_user: '4004' };
  const xreq = (kind, sn) => fetch('/i/api/1.1/friendships/' + kind + '.json', { method: 'POST', credentials: 'include', headers: { authorization: 'Bearer PAGE-AUTH-TOKEN', 'x-csrf-token': 'mockcsrf123', 'x-client-transaction-id': 'PAGE-TX', 'content-type': 'application/x-www-form-urlencoded' }, body: 'user_id=' + (XIDS[sn] || '') + '&screen_name=' + sn });
  const closeX = () => document.querySelectorAll('.xmenu, .xsheet').forEach((e) => e.remove());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeX(); });
  document.addEventListener('click', (e) => {
    const c = e.target.closest && e.target.closest('[data-testid="caret"]');
    if (!c) return;
    closeX();
    const art = c.closest('article');
    const sn = (art.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href') || '/').slice(1);
    const m = document.createElement('div');
    m.className = 'xmenu'; m.setAttribute('role', 'menu');
    m.style.cssText = 'position:fixed;right:20px;top:60px;background:#222;padding:8px;z-index:50';
    const add = (t, fn) => { const i = document.createElement('div'); i.setAttribute('role', 'menuitem'); i.textContent = t; i.onclick = () => { closeX(); fn(); }; m.appendChild(i); };
    if (sn !== 'react_user') {
      if (window.__fol[sn]) add('@' + sn + ' 님 언팔로우하기', () => {
        const sh = document.createElement('div'); sh.className = 'xsheet';
        sh.innerHTML = '<button data-testid="confirmationSheetConfirm">언팔로우</button>';
        sh.querySelector('button').onclick = () => { closeX(); window.__fol[sn] = false; xreq('destroy', sn); };
        document.body.appendChild(sh);
      });
      else add('@' + sn + ' 님 팔로우하기', () => { window.__fol[sn] = true; xreq('create', sn); });
    }
    add('게시물 신고하기', () => {});
    document.body.appendChild(m);
  });
`;

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

const videoTwimg = (req, res, u) => serveFile(req, res, u.pathname.endsWith('high.mp4') || u.pathname.endsWith('synd.mp4') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4');

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
    // 중복 막기 테스트 전용 주소(다른 시나리오와 겹치지 않게)
    if (u.pathname === '/dup_only.mp4') return serveFile(req, res, 'progressive_360p.mp4');
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
    if (u.pathname === '/afollow') {
      // 일반 사이트: 게시물 안 '팔로우' 버튼 + 다른 곳의 '팔로잉'(이미 팔로우) 버튼
      return html(res, page('팔로우 테스트', `<article style="width:520px"><div><b>작성자</b> <button id="fb" onclick="window.__followed = (window.__followed || 0) + 1; this.textContent = '팔로잉'">팔로우</button></div>
          <img id="pic" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover"></article>
        <article style="width:520px"><div><b>다른 사람</b> <button id="fb2" onclick="window.__unfollowed = true">팔로잉</button></div>
          <img id="pic2" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover"></article>`));
    }
    if (u.pathname === '/afollow-nav') {
      // 팔로우 버튼이 로그인 창을 띄우는 사이트(누르면 alert): 그래도 첫 클릭에 다운로드가 시작돼야 함
      return html(res, page('팔로우 테스트2', `<article style="width:520px"><div><b>작성자</b> <button id="fb" onclick="window.__followClicked = true; alert('로그인이 필요합니다')">팔로우</button></div>
          <img id="pic" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover"></article>`));
    }
    if (u.pathname === '/hover2') {
      return html(res, page('마우스 재생', `<video id="h1" src="https://cdn.example-videos.com/preview.webm" loop playsinline style="width:420px;height:236px;background:#000"></video>
        <video id="h2" src="https://cdn.example-videos.com/preview.webm" loop playsinline style="width:420px;height:236px;background:#000"></video>`));
    }
    if (u.pathname === '/rerender') {
      // X 처럼: 플레이어를 누르는 순간(pointerdown) 사이트가 영상 묶음을 새로 그린다 → 우리 버튼이 다시 붙으면서 click 이 사라질 수 있음
      return html(res, page('다시 그리는 플레이어', `<div id="wrap" style="position:relative;width:480px;height:270px"><div id="inner"><video src="https://cdn.example-videos.com/progressive_360p.mp4" muted style="width:480px;height:270px;background:#000"></video></div></div>`,
        `document.getElementById('wrap').addEventListener('pointerdown', () => {
           const inner = document.getElementById('inner');
           const clone = document.createElement('div'); clone.id = 'inner';
           while (inner.firstChild) clone.appendChild(inner.firstChild);
           inner.replaceWith(clone);
           window.__rerendered = (window.__rerendered || 0) + 1;
         }, true);`));
    }
    if (u.pathname === '/dupvideo') {
      return html(res, page('중복 테스트 영상', `<div class="card"><video src="https://cdn.example-videos.com/dup_only.mp4" muted style="width:480px;height:270px;background:#000"></video></div>`));
    }
    if (u.pathname === '/scrollpause') {
      // 긴 페이지 맨 위에 재생 중인 영상, 처음부터 숨어서 재생되는 영상(음악·광고용)
      return html(res, page('화면 밖 정지 테스트', `
        <video id="v1" src="https://cdn.example-videos.com/preview.webm" muted loop playsinline autoplay style="width:480px;height:270px;background:#000"></video>
        <video id="bgv" src="https://cdn.example-videos.com/preview.webm" muted loop playsinline autoplay style="display:none"></video>
        <div style="height:5000px"></div>`));
    }
    if (u.pathname === '/clicktoggle') {
      // 흔한 사이트 플레이어: 영상을 덮은 투명 막을 누르면 재생/정지(클릭), 두 번째는 누르는 순간(pointerdown) 정지, 막 안에 '좋아요' 버튼
      return html(res, page('클릭 정지 테스트', `
        <div style="position:relative;width:480px;height:270px"><video id="c1" src="https://cdn.example-videos.com/preview.webm" muted loop autoplay playsinline style="width:100%;height:100%;background:#000"></video>
          <div id="o1" style="position:absolute;inset:0" onclick="const v = document.getElementById('c1'); v.paused ? v.play() : v.pause()"><button id="like" onclick="event.stopPropagation(); window.__liked = true" style="position:absolute;right:8px;top:8px">좋아요</button></div></div>
        <div style="position:relative;width:480px;height:270px"><video id="c2" src="https://cdn.example-videos.com/preview.webm" muted loop autoplay playsinline style="width:100%;height:100%;background:#000"></video>
          <div id="o2" style="position:absolute;inset:0" onpointerdown="document.getElementById('c2').pause()"></div></div>`));
    }
    if (u.pathname === '/feedshot2') {
      // 인스타·유튜브처럼 작성자는 영상 위, 본문은 영상 아래에 있는 게시물
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>피드</title></head><body style="margin:0;background:#fff;color:#111">
        <article style="width:660px;margin:20px">
          <header style="display:flex;gap:8px;align-items:center;padding:6px 0"><span style="width:36px;height:36px;border-radius:50%;background:#e8a;display:inline-block"></span><b>민지</b> <span style="color:#888">@minji</span></header>
          <video src="https://cdn.example-videos.com/person_top.webm" muted style="width:640px;height:360px;background:#000;display:block"></video>
          <div class="desc" style="padding:6px 0">주말에 바다 보러 다녀왔어요. 날씨가 너무 좋았어요!</div>
        </article></body></html>`);
    }
    if (u.pathname === '/feedpost-en' || u.pathname === '/feedpost-fail') {
      const body = u.pathname.endsWith('fail') ? 'FAILTEST sunset walk on the beach today' : 'Took a sunset walk on the beach today. It was so beautiful!';
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>Home / X</title></head><body style="margin:0;background:#000;color:#eee">
        <article style="width:660px;margin:20px">
          <div style="display:flex;gap:8px;align-items:center"><div data-testid="Tweet-User-Avatar" style="width:40px;height:40px;border-radius:50%;background:#4a8"></div><div data-testid="User-Name"><b>Emma</b> <span style="color:#888">@emma_test · Jun 2</span></div></div>
          <div data-testid="tweetText" lang="en">${body}</div>
          <img src="https://cdn.example-videos.com/img/photo.jpg" style="width:640px;height:400px;object-fit:cover;display:block">
        </article></body></html>`);
    }
    if (u.pathname === '/stickyfeed') {
      // X 프로필처럼 맨 위에 고정 머리줄(빨강, 70px), 본문에 해시태그(초록)
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>(3) 키스 / X</title></head><body style="margin:0;background:#000;color:#eee">
        <div style="position:fixed;top:0;left:0;right:0;height:70px;background:#ff0000;color:#fff;z-index:10;font:700 20px sans-serif;padding:10px">프로필 이름 · 200 게시물</div>
        <div style="height:400px"></div>
        <article id="post" style="width:660px;margin:20px">
          <div style="display:flex;gap:8px;align-items:center"><div data-testid="Tweet-User-Avatar" style="width:40px;height:40px;border-radius:50%;background:#ff99cc"></div><div data-testid="User-Name"><b>키스</b> <span style="color:#888">@kiss · 9월 2일</span></div></div>
          <div data-testid="tweetText">장어 덮밥 먹고 힘내요 <a href="/hashtag/test" style="background:#00ff00;color:#00ff00">#초록해시태그</a></div>
          <img id="pic" src="https://cdn.example-videos.com/img/gray.jpg" style="width:640px;height:400px;object-fit:cover;display:block">
        </article><div style="height:1500px"></div></body></html>`);
    }
    if (u.pathname === '/jpfeed') {
      // 한국어 화면(탭 제목 '홈 / X')에 일본어 게시물
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>(2) 홈 / X</title></head><body style="margin:0;background:#000;color:#eee">
        <article style="width:660px;margin:20px">
          <div data-testid="User-Name"><b>さくら</b> <span style="color:#888">@sakura_jp · 9월 2일</span></div>
          <div data-testid="tweetText" lang="ja">今日は東京で美味しいラーメンを食べました</div>
          <img id="pic" src="https://cdn.example-videos.com/img/gray.jpg" style="width:640px;height:400px;object-fit:cover;display:block">
        </article></body></html>`);
    }
    if (u.pathname === '/feedpost') {
      // 탭 제목은 '(1) 이름 / X' 처럼 작성자·알림 수, 본문은 게시물 글 칸에 있다
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>(1) 하리니( ) / X</title></head><body style="margin:0;background:#111;color:#eee">
        <article style="width:660px;margin:20px">
          <div style="display:flex;gap:8px;align-items:center"><div data-testid="Tweet-User-Avatar" style="width:40px;height:40px;border-radius:50%;background:#e8a"></div><div data-testid="User-Name"><b>하리니</b> <span style="color:#888">@harin_test · 6월</span></div></div>
          <div data-testid="tweetText" lang="ko">오늘 한강에서 자전거 탔어요. 노을이 정말 예뻤어요!</div>
          <video src="https://cdn.example-videos.com/person_top.webm" muted style="width:640px;height:360px;background:#000"></video>
        </article></body></html>`);
    }
    if (u.pathname === '/watch-vp9') {
      return html(res, page('VP9 영상 게시물 오늘 공원에서 강아지와 산책했어요', `<div class="card"><video src="https://cdn.example-videos.com/preview.webm" muted style="width:640px;height:360px;background:#000"></video></div>`));
    }
    if (u.pathname === '/ai') {
      return html(res, page('AI 영상 모음', `<div class="card"><p>오늘 만든 영상 #sora #AI영상</p><video src="https://cdn.example-videos.com/progressive_360p.mp4" muted style="width:480px;height:270px;background:#000"></video></div>`));
    }
    if (u.pathname === '/long') {
      return html(res, page('긴 영상', `<div class="card"><video src="https://cdn.example-videos.com/long_95s.webm" muted preload="metadata" style="width:640px;height:360px;background:#000"></video></div>`));
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
    if (u.pathname === '/watch') {
      // 보기 화면: 구독 단추는 플레이어와 떨어진 곳(제목 아래)에 있다
      const sub = u.searchParams.get('v') === 'YTsubbed001' ? '구독중' : '구독';
      return html(res, ytPage(u.searchParams.get('v'), false).replace('</body>', `<div id="below" style="margin-top:40px"><ytd-channel-name>테스트 채널</ytd-channel-name> <ytd-subscribe-button-renderer><button id="subbtn" onclick="window.__subscribed = (window.__subscribed || 0) + 1; this.textContent = '구독중'">${sub}</button></ytd-subscribe-button-renderer></div></body>`));
    }
    if (u.pathname === '/adsfeed') {
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>YouTube</title></head><body>
        <ytd-rich-item-renderer id="vid1"><p>일반 영상</p></ytd-rich-item-renderer>
        <ytd-rich-item-renderer id="ad1"><ytd-ad-slot-renderer><p>광고 영상</p></ytd-ad-slot-renderer></ytd-rich-item-renderer>
        <div class="html5-video-player ad-showing" id="pl"><video id="v" src="https://cdn.example-videos.com/long_95s.webm" muted autoplay></video>
          <button class="ytp-skip-ad-button" onclick="window.__skipped = true; document.getElementById('pl').classList.remove('ad-showing')">건너뛰기</button></div></body></html>`);
    }
    if (u.pathname.startsWith('/shorts/')) return html(res, ytPage(u.pathname.split('/')[2], true));
    if (u.pathname === '/youtubei/v1/next') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const b = JSON.parse(body || '{}');
        log.push({ host: 'www.youtube.com', path: u.pathname, videoId: b.videoId, hl: b.context?.client?.hl });
        if (b.videoId === 'YTshortErr1') {
          res.writeHead(503);
          return res.end();
        }
        json(req, res, { contents: { twoColumnWatchNextResults: { results: { results: { contents: [
          { videoPrimaryInfoRenderer: { viewCount: { videoViewCountRenderer: { viewCount: { simpleText: '조회수 1,234,567회' }, shortViewCount: { simpleText: '조회수 123만회' } } } } },
          { videoSecondaryInfoRenderer: { owner: { videoOwnerRenderer: { subscriberCountText: { simpleText: '구독자 3.4만명' } } } } },
        ] } } } } });
      });
      return;
    }
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
    if (u.pathname === '/@spacestar' || u.pathname === '/@limited') {
      // 틱톡 프로필: '팔로워'를 누르면 목록 창. limited 는 누르면 'Try again later' 알림
      const lim = u.pathname === '/@limited';
      const row = (id) => `<div style="height:60px"><a href="/@${id}"><span>${id}</span></a><button data-e2e="follow-button" onclick="window.__ttClicks = (window.__ttClicks || []).concat('${id}'); ${lim ? `document.body.insertAdjacentHTML('beforeend', '<div role=&quot;alert&quot;>Too many requests. Try again later.</div>')` : `setTimeout(() => (this.textContent = 'Following'), 300)`}">Follow</button></div>`;
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>TikTok</title></head><body>
        <button id="openFollowers" onclick="document.getElementById('dlg').style.display = 'block'">팔로워</button>
        <div id="dlg" role="dialog" style="display:none;position:fixed;left:50px;top:50px;width:400px;height:300px;background:#fff;overflow-y:auto">${row('tt_a')}${row('tt_b')}</div></body></html>`);
    }
    if (/^\/@[^/]+\/video\/\d+/.test(u.pathname)) {
      const id = u.pathname.split('/').pop();
      const item = id.endsWith('9') ? tiktokItem(id, '만료된 영상', 'expired.mp4') : tiktokItem(id, '틱톡 상세 영상 테스트 #shorts', 'progressive_1080x1920.mp4');
      if (id.endsWith('5')) item.aigcLabelType = 1; // 틱톡이 붙이는 AI 생성 라벨
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
    if (u.pathname === '/spacestar/followers/') {
      // 인스타 팔로워 목록 창: 스크롤되는 창 안에 팔로우 버튼(누르면 0.3초 뒤 '팔로잉'), 이미 팔로잉·맞팔로우하기
      const row = (id, label) => `<div style="height:70px;display:flex;justify-content:space-between"><a href="/${id}/"><span>${id}</span></a><button onclick="window.__igClicks = (window.__igClicks || []).concat('${id}'); setTimeout(() => (this.textContent = '팔로잉'), 300)">${label}</button></div>`;
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>Instagram</title></head><body>
        <div role="dialog" style="position:fixed;left:50px;top:50px;width:400px;height:300px;background:#fff"><div id="sc" style="height:300px;overflow-y:auto">
        ${row('ig_a', '팔로우')}<div style="height:70px"><a href="/ig_old/"><span>ig_old</span></a><button>팔로잉</button></div>${row('ig_b', '맞팔로우하기')}<div style="height:400px"></div>${row('ig_c', '팔로우')}</div></div></body></html>`);
    }
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
    if (u.pathname === '/spacestar/following' || u.pathname === '/limited/following') {
      // X 팔로잉 목록: 셀마다 팔로우 버튼(누르면 0.3초 뒤 '팔로잉'), 비공개 계정은 '요청됨', 오른쪽 '팔로우 추천'은 목록 밖
      const limited = u.pathname.startsWith('/limited');
      const cell = (id, state = 'follow') => `<div data-testid="cellInnerDiv" style="height:260px"><div data-testid="UserCell"><a href="/${id}" role="link"><span>${id}</span></a>
        <button data-testid="${id}-${state}" onclick="window.__xClicks = (window.__xClicks || []).concat('${id}'); ${limited ? `document.body.insertAdjacentHTML('beforeend', '<div data-testid=&quot;toast&quot; role=&quot;alert&quot;>You are unable to follow more people at this time.</div>')` : `setTimeout(() => this.setAttribute('data-testid', '${id}-' + ('${id}' === 'locked_one' ? 'cancel' : 'unfollow')), 300)`}">팔로우</button></div></div>`;
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>X</title><script>document.cookie = 'twid=u%3D1; path=/';</script></head><body style="background:#000;color:#eee">
        <div data-testid="primaryColumn" style="width:600px">${cell('already', 'unfollow')}${cell('user_a')}${cell('user_b')}${cell('locked_one')}${cell('user_c')}${cell('user_d')}</div>
        <aside style="position:fixed;right:0;top:0"><div data-testid="UserCell"><button data-testid="suggest-follow" onclick="window.__suggestClicked = true">팔로우</button></div></aside></body></html>`);
    }
    if (u.pathname === '/tester/status/1790000000000000001') {
      return html(res, page('X 게시물', `<article data-testid="tweet"><a href="/tester/status/1790000000000000001"><time datetime="2026-09-30">9월 30일</time></a>
          ${vtag('poster="https://pbs.twimg.com/ext_tw_video_thumb/1790000000000000999/pu/img/thumb.jpg"')}</article>`,
        `fetch('/i/api/graphql/abc123/TweetDetail?variables=%7B%7D').then(r=>r.json());`));
    }
    if (u.pathname === '/tester/status/1790000000000000005') {
      // 실제 X 처럼: 게시물 → 사진 누르면 pushState 로 /photo/1 확대 창, 사진을 탭하면 X 가 스스로 history.back() 으로 닫는다
      return html(res, page('X 게시물', `<article data-testid="tweet"><div data-testid="tweetText">사진 게시물</div><a id="open" href="/tester/status/1790000000000000005/photo/1"><img alt="이미지" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=small" style="width:200px"></a></article>`, `
        const show = () => {
          document.getElementById('lb')?.remove();
          if (!/\\/photo\\//.test(location.pathname)) return;
          const d = document.createElement('div');
          d.id = 'lb'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
          d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);display:grid;place-items:center';
          d.innerHTML = '<div data-testid="swipe-to-dismiss"><img alt="이미지" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=large" style="max-width:60vw"></div>';
          d.querySelector('img').addEventListener('pointerup', () => { window.__xSelfClose = (window.__xSelfClose || 0) + 1; history.back(); });
          document.body.appendChild(d);
        };
        document.getElementById('open').addEventListener('click', (e) => { e.preventDefault(); history.pushState({}, '', e.currentTarget.getAttribute('href')); show(); });
        addEventListener('popstate', show);`));
    }
    if (u.pathname === '/tester/status/1790000000000000003/photo/1') {
      // X 사진 확대 보기(모달). 닫기 버튼을 누르면 window.__closed = true
      return html(res, page('X 사진 보기', `<div role="dialog" aria-modal="true" onclick="if (event.target === this || event.target.tagName === 'SMD-ANCHOR') { window.__bgClosed = true; this.remove(); }" style="position:fixed;inset:0;background:rgba(0,0,0,.9);display:grid;place-items:center">
          <button data-testid="app-bar-close" aria-label="Close" onclick="window.__closed = true" style="position:absolute;left:12px;top:12px">×</button>
          <img alt="이미지" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=large" style="max-width:80vw;max-height:80vh">
        </div>`));
    }
    if (u.pathname === '/autoplay') {
      // X 자동 재생이 꺼진 상태처럼 영상이 멈춰 있다
      // v1 은 X 가 스스로 자동 재생하는 영상(autoplay), v2 는 멈춰 있는 영상
      const v = (id, auto) => `<article style="height:330px"><div data-testid="videoPlayer"><video id="${id}" src="https://cdn.example-videos.com/preview.webm" muted loop playsinline ${auto ? 'autoplay' : ''} style="width:480px;height:270px;background:#000"></video></div></article>`;
      return html(res, page('X 자동 재생', `<div style="width:100%">${v('v1', true)}${v('v2', false)}<div style="height:1200px"></div></div>`));
    }
    if (u.pathname === '/hq') {
      return html(res, page('X 화질', '<p>화질 테스트</p>', `
        fetch('https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8').then((r) => r.text()).then((t) => (window.__fetchVariants = (t.match(/EXT-X-STREAM-INF/g) || []).length, window.__fetchText = t));
        const x = new XMLHttpRequest(); x.open('GET', 'https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8');
        x.onreadystatechange = () => { if (x.readyState === 4) window.__xhrVariants = (x.responseText.match(/EXT-X-STREAM-INF/g) || []).length; };
        x.send();`));
    }
    if (u.pathname === '/afollow') {
      // 다운로드 누르면 자동 팔로우: @auto_user 의 사진 게시물(팔로우 상태 모름 → 팔로우 요청)
      return html(res, page('홈 / X', `<article data-testid="tweet" style="width:560px"><div style="display:flex;justify-content:space-between"><div data-testid="User-Name"><a href="/auto_user"><span>자동 팔로우 대상</span></a> <a href="/auto_user">@auto_user</a> · <a href="/auto_user/status/1790000000000000077"><time>1시간</time></a></div><button data-testid="caret">⋯</button></div>
        <div data-testid="tweetText">사진 게시물</div><img id="pic" alt="이미지" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=large" style="width:480px;height:320px;object-fit:cover"></article>`, `document.cookie = 'ct0=mockcsrf123; path=/';${XMENU}`));
    }
    if (u.pathname === '/xtoggle') {
      // 영상 화면을 누르는 순간(pointerdown) 멈추는 플레이어 + 영상 상태를 보고 재생/정지를 바꾸는 재생 단추
      return html(res, page('X 토글', `<div data-testid="videoPlayer" style="position:relative;width:480px;height:270px">
          <video id="tv" src="https://cdn.example-videos.com/preview.webm" muted loop autoplay playsinline style="width:100%;height:100%;background:#000"></video>
          <div id="ta" style="position:absolute;left:0;top:0;width:300px;height:200px" onpointerdown="document.getElementById('tv').pause()"></div>
          <button id="tbtn" aria-label="재생" style="position:absolute;right:10px;bottom:10px" onclick="const v = document.getElementById('tv'); window.__toggles = (window.__toggles || 0) + 1; v.paused ? v.play() : v.pause()">▶</button></div>`));
    }
    if (u.pathname === '/xplay') {
      // X 처럼: 영상은 소리 없이 미리보기로 돌고 있고, 가운데에 role 없는 재생 단추(div)가 떠 있다. 단추를 누르면 X 가 소리와 함께 '진짜 재생'을 시작
      return html(res, page('X 재생 단추', `<div data-testid="videoPlayer" id="pl" style="position:relative;width:480px;height:270px">
          <video id="pv" src="https://cdn.example-videos.com/preview.webm" muted loop autoplay playsinline style="width:100%;height:100%;background:#000"></video>
          <div data-testid="playButton" id="pb" style="position:absolute;left:190px;top:85px;width:100px;height:100px;border-radius:50%;background:#1d9bf0"
            onclick="const v = document.getElementById('pv'); v.muted = false; v.play(); window.__started = (window.__started || 0) + 1; this.style.display = 'none'"></div></div>`));
    }
    if (u.pathname === '/controls') {
      // X 처럼(엄격하게): 진짜 마우스 움직임만 인정(가짜 이벤트 무시), 2초 동안 안 움직이면 재생바를 흐리게 숨김(opacity·visibility)
      // 진행 막대(2px)는 슬라이더 바깥(옆)에 있고, 슬라이더 안에는 손잡이(12px)만 있다
      return html(res, page('X 재생바', `<div data-testid="videoPlayer" id="pl" style="position:relative;width:360px;height:640px">
          <video src="https://cdn.example-videos.com/preview.webm" muted loop autoplay playsinline style="width:100%;height:100%;background:#000"></video>
          <div id="ctl" class="on" style="position:absolute;left:0;right:0;bottom:0;height:60px;background:rgba(0,0,0,.5);transition:opacity .2s">
            <div style="position:relative;margin:10px;height:16px">
              <div id="track" style="position:absolute;top:7px;left:0;width:320px;height:2px;background:#888"></div>
              <div id="played" style="position:absolute;top:7px;left:0;width:100px;height:2px;background:#1d9bf0"></div>
              <div role="slider" aria-label="Seek slider" style="position:absolute;inset:0">
                <div id="thumb" style="position:absolute;top:2px;left:94px;width:12px;height:12px;border-radius:9999px;background:#fff"></div>
              </div>
            </div></div></div>`,
        `let last = Date.now(); document.getElementById('pl').addEventListener('mousemove', (e) => { if (e.isTrusted) last = Date.now(); });
         setInterval(() => { const c = document.getElementById('ctl'); const hide = Date.now() - last > 2000; c.style.opacity = hide ? '0' : '1'; c.style.visibility = hide ? 'hidden' : 'visible'; }, 200);`));
    }
    if (u.pathname === '/ads') {
      // X 피드: 보통 게시물 / '프로모션' 라벨 / placementTracking 광고 + 광고 서버 요청
      const cell = (id, inner) => `<div data-testid="cellInnerDiv" id="${id}"><article data-testid="tweet"><p>${id} 게시물 본문입니다</p>${inner}</article></div>`;
      // bodyword: 본문에 '광고'라고만 쓴 일반 게시물(숨기면 안 됨)
      // recycle: X 처럼 광고였던 칸이 3초 뒤 일반 게시물로 다시 쓰임(다시 보여야 함)
      return html(res, page('홈 / X', cell('normal', '') + cell('promoted', '<div><span>프로모션</span></div>') + cell('tracked', '<div data-testid="placementTracking"><span>영상</span></div>')
        + `<div data-testid="cellInnerDiv" id="bodyword"><article data-testid="tweet"><div data-testid="tweetText"><span>광고</span></div></article></div>`
        + `<div data-testid="cellInnerDiv" id="recycle"><article data-testid="tweet"><p>재사용 칸</p><div><span>프로모션</span></div></article></div>`,
        `setTimeout(() => { document.querySelector('#recycle article').innerHTML = '<a href="/someone/status/1790000000000000088"><time>1분</time></a><p>재사용된 칸에 들어온 일반 게시물입니다</p>'; }, 3000);
        window.__adNet = 'pending'; setTimeout(() => fetch('https://googleads.g.doubleclick.net/pagead/ads?x=1').then((r) => (window.__adNet = 'loaded ' + r.status), () => (window.__adNet = 'blocked')), 300);`));
    }
    if (u.pathname === '/layout') {
      // 실제 X 구조: 왼쪽 메뉴(header, 남는 공간을 차지하고 메뉴는 오른쪽 정렬) / 가운데(primaryColumn 600px) / 오른쪽(sidebarColumn)
      // 피드 목록 안쪽에도 600px 너비 제한(클래스로 걸림)이 한 겹 더 있다
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>홈 / X</title><style>body{margin:0;background:#000;color:#eee;font-family:sans-serif}.r-600{max-width:600px}</style></head>
        <body><div style="display:flex;flex-direction:row;min-height:100vh">
        <header role="banner" style="flex-grow:1;display:flex;justify-content:flex-end"><div style="width:275px">왼쪽 메뉴</div></header>
        <main role="main" style="flex-grow:1;display:flex;align-items:flex-start"><div style="width:990px"><div style="display:flex;justify-content:space-between;width:990px">
          <div data-testid="primaryColumn" style="max-width:600px;width:100%;border:1px solid #333"><div><div><section role="region"><div class="r-600" style="margin:0 auto"><div>
            <div data-testid="cellInnerDiv" style="position:relative"><article data-testid="tweet" style="display:flex;padding:12px 16px"><div style="width:40px;height:40px;border-radius:50%;background:#555;flex:none"></div><div style="flex:1;margin-left:12px"><div>게시물 본문</div><div data-testid="videoPlayer"><video src="https://cdn.example-videos.com/preview.webm" muted style="width:100%;aspect-ratio:16/9;display:block;background:#111"></video></div></div></article></div>
          </div></div></section></div></div></div>
          <div data-testid="sidebarColumn" style="width:350px">Premium 구독하기 · 트렌드 · 팔로우 추천</div>
        </div></div></main></div></body></html>`);
    }
    if (u.pathname === '/explore') {
      // 탐색 피드: @followed_user(팔로우 중), @new_user(팔로우 안 함) 은 타임라인 GraphQL 로, @react_user 는 화면 React 데이터에만 있다
      // 실제 X 처럼 이름 칸은 한 줄로 잘리고(overflow:hidden), 오른쪽 끝에 ⋯(caret) 버튼이 있다
      const art = (sn, name, id, img = '') => `<article data-testid="tweet" id="t-${sn}" style="width:560px"><div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;min-width:0;flex-shrink:1;overflow:hidden"><div data-testid="User-Name" style="display:flex;flex-direction:row;overflow:hidden;min-width:0;white-space:nowrap"><div style="display:flex;align-items:center;gap:4px;overflow:hidden;max-width:200px"><a href="/${sn}"><span>${name}</span></a></div><div style="overflow:hidden;text-overflow:ellipsis;max-width:220px"><a href="/${sn}">@${sn}</a> · <a href="/${sn}/status/${id}"><time>1시간</time></a></div></div></div><div style="display:flex;align-items:center"><button data-testid="caret" aria-label="더 보기">⋯</button></div></div><p>게시물 본문</p>${img ? `<img alt="" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=small" style="width:40px;height:40px;border-radius:50%">${img}` : ''}</article>`;
      return html(res, page('탐색하기 / X', `<a data-testid="AppTabBar_Profile_Link" href="/me_account">프로필</a>
          <div style="display:flex;flex-direction:column;gap:12px;width:560px">${art('followed_user', '팔로우한 사람', '1801', '<img id="fpic" alt="이미지" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=large" style="width:480px;height:300px;object-fit:cover">')}${art('new_user', '처음 보는 사람', '1802')}${art('react_user', '리액트 사람 이름이 아주 길어서 한 줄에 다 안 들어가는 계정입니다', '1803')}${art('me_account', '나', '1804')}</div>
          <div data-testid="videoPlayer" style="position:relative;width:360px;height:200px"><video id="xv" src="https://cdn.example-videos.com/preview.webm" muted loop playsinline style="width:100%;height:100%"></video>
            <button data-testid="unmuteButton" aria-label="Unmute" onclick="document.getElementById('xv').muted=false; window.__unmuteClicked=true" style="position:absolute;right:4px;bottom:4px">🔇</button></div>`,
        `document.cookie = 'ct0=mockcsrf123; path=/';${XMENU}
         fetch('/i/api/graphql/q1/HomeTimeline?variables=%7B%7D', { headers: { authorization: 'Bearer PAGE-AUTH-TOKEN' } }).then((r) => r.json());
         const art = document.getElementById('t-react_user');
         art['__reactFiber$mockx2'] = { memoizedProps: { tweet: { core: { user_results: { result: { __typename: 'User', rest_id: '3003', core: { screen_name: 'react_user' }, legacy: { followers_count: 5 }, relationship_perspectives: { following: true } } } } } }, return: null };
         setTimeout(() => document.getElementById('xv').play(), 400);`));
    }
    if (u.pathname.startsWith('/i/api/graphql/q1/HomeTimeline')) {
      const user = (id, sn, following) => ({ __typename: 'User', rest_id: id, core: { screen_name: sn }, legacy: { screen_name: sn, followers_count: 10, ...(following ? { following: true } : {}) } });
      return json(req, res, { data: { home: { home_timeline_urt: { instructions: [{ entries: [
        { content: { itemContent: { tweet_results: { result: { rest_id: '1801', core: { user_results: { result: user('1001', 'followed_user', true) } }, legacy: { full_text: 'a' } } } } } },
        { content: { itemContent: { tweet_results: { result: { rest_id: '1802', core: { user_results: { result: user('2002', 'new_user', false) } }, legacy: { full_text: 'b', extended_entities: { media: [{ id_str: '9', type: 'video', video_info: { variants: [] } }] } } } } } } },
      ] }] } } } });
    }
    if (u.pathname === '/i/api/1.1/friendships/create.json' || u.pathname === '/i/api/1.1/friendships/destroy.json') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const p = new URLSearchParams(body);
        const ok = req.method === 'POST' && req.headers['x-csrf-token'] === 'mockcsrf123' && /ct0=mockcsrf123/.test(req.headers.cookie || '') && /^Bearer /.test(req.headers.authorization || '');
        log.push({ host: 'x.com', follow: u.pathname.includes('create') ? 'create' : 'destroy', user_id: p.get('user_id'), screen_name: p.get('screen_name'), auth: req.headers.authorization, tx: req.headers['x-client-transaction-id'] || null, ok });
        if (!ok) return json(req, res, { errors: [{ message: 'bad auth' }] }, 403);
        json(req, res, { id_str: p.get('user_id') || '0', screen_name: p.get('screen_name') || '', following: u.pathname.includes('create') });
      });
      return;
    }
    if (u.pathname === '/home') {
      // 타임라인: GraphQL 가로채기 데이터 없음 + 신디케이션 실패(404) → 화면 게시물의 React 데이터로 찾아야 한다.
      // 영상 위에는 실제 X 처럼 썸네일 <img> 가 겹쳐 있다(여기에 사진 버튼이 뜨면 안 됨).
      const tweet = { rest_id: '1790000000000000004', legacy: { id_str: '1790000000000000004', full_text: '타임라인 영상 게시물', extended_entities: { media: [{ id_str: '1790000000000000777', type: 'video', video_info: { duration_millis: 6000, variants: [
        { content_type: 'video/mp4', bitrate: 632000, url: 'https://video.twimg.com/ext_tw_video/1790000000000000777/pu/vid/avc1/320x568/low.mp4' },
        { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.com/ext_tw_video/1790000000000000777/pu/vid/avc1/1080x1920/high.mp4' },
      ] } }] } } };
      return html(res, page('홈 / X', `<article data-testid="tweet"><a href="/tester/status/1790000000000000004"><time>9월 30일</time></a>
          <div id="player" style="position:relative;width:360px;height:640px">
            <video src="https://cdn.example-videos.com/preview.webm" muted playsinline loop style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>
            <img alt="" src="https://pbs.twimg.com/media/MockPic?format=jpg&name=small" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
          </div></article>`,
        `const host = document.getElementById('player');
         const fiber = { memoizedProps: { className: 'x' }, return: { memoizedProps: { tweet: ${JSON.stringify(tweet)}, viewerId: 1 }, return: null } };
         host['__reactFiber$mockx1'] = fiber;
         document.querySelector('#player video')['__reactFiber$mockx1'] = { memoizedProps: {}, return: fiber };`));
    }
    if (u.pathname === '/tester/status/1790000000000000003') {
      // 실제 X 처럼: 배경 이미지 div 위에 투명도 0 인 <img> 를 겹쳐 둔다
      const pic = (id) => `<div style="position:relative;width:420px;height:315px;margin:8px 0"><div style="position:absolute;inset:0;background:url(https://pbs.twimg.com/media/${id}?format=jpg&name=small) center/cover"></div><img alt="이미지" src="https://pbs.twimg.com/media/${id}?format=jpg&name=small" style="position:absolute;inset:0;width:100%;height:100%;opacity:0"></div>`;
      return html(res, page('X 사진 게시물', `<article data-testid="tweet"><a href="/tester/status/1790000000000000003"><time>9월 30일</time></a>${pic('MockPic')}${pic('MockPic2')}</article>`));
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
  'googleads.g.doubleclick.net': (req, res) => json(req, res, { ad: true }),
  'video.twimg.com': (req, res, u) => {
    if (u.pathname.endsWith('/pl/master.m3u8')) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' });
      return res.end(['#EXTM3U', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=300000,BANDWIDTH=400000,RESOLUTION=320x568,CODECS="avc1.4d001e"', '/ext_tw_video/1/pu/pl/320x568/a.m3u8', '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2000000,BANDWIDTH=2500000,RESOLUTION=1080x1920,CODECS="avc1.640028"', '/ext_tw_video/1/pu/pl/1080x1920/c.m3u8', '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=900000,BANDWIDTH=1000000,RESOLUTION=720x1280,CODECS="avc1.4d001f"', '/ext_tw_video/1/pu/pl/720x1280/b.m3u8', ''].join('\n'));
    }
    return videoTwimg(req, res, u);
  },
  '__unused_video_twimg': (req, res, u) => serveFile(req, res, u.pathname.endsWith('high.mp4') || u.pathname.endsWith('synd.mp4') ? 'progressive_1080x1920.mp4' : 'progressive_360p.mp4'),
  'pbs.twimg.com': (req, res, u) => {
    if (u.pathname === '/media/MockPic' || u.pathname === '/media/MockPic2') return serveFile(req, res, u.searchParams.get('name') === 'orig' ? 'images/x_orig.jpg' : 'images/x_small.jpg');
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
    if (/^\/profile\/(spacestar|errlist)\.test\/follows$/.test(u.pathname)) {
      // 블루스카이 팔로잉 목록 화면(로그인 상태)
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>Bluesky</title><script>localStorage.setItem('BSKY_STORAGE', JSON.stringify({ session: { currentAccount: { did: 'did:plc:me', handle: 'me.test', service: 'https://bsky.social/', pdsUrl: 'https://bsky.social', accessJwt: 'TEST-ACCESS-JWT' }, accounts: [] } }));</script></head><body style="background:#111;color:#eee"><h1>팔로우 중</h1></body></html>`);
    }
    if (u.pathname === '/afollow') {
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>Bluesky</title><script>localStorage.setItem('BSKY_STORAGE', JSON.stringify({ session: { currentAccount: { did: 'did:plc:me', handle: 'me.test', service: 'https://bsky.social/', pdsUrl: 'https://bsky.social', accessJwt: 'TEST-ACCESS-JWT' }, accounts: [] } }));</script></head><body style="background:#111;color:#eee">
        <div data-testid="feedItem-by-alice.test" style="width:560px;padding:12px;margin:8px"><a href="/profile/alice.test">앨리스(이미 팔로우)</a><p>사진</p><img id="apic" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover"></div>
        <div data-testid="feedItem-by-carol.test" style="width:560px;padding:12px;margin:8px"><a href="/profile/carol.test">캐롤</a><p>사진</p><img id="pic" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover"></div></body></html>`);
    }
    if (u.pathname === '/feedfollow') {
      // 블루스카이 피드: 로그인 정보는 localStorage BSKY_STORAGE 에 있다
      const item = (h, name) => `<div data-testid="feedItem-by-${h}" id="b-${h.split('.')[0]}" style="width:560px;padding:12px;margin:8px;background:#1b1b24;border-radius:10px"><a href="/profile/${h}">${name}</a> <span>@${h}</span> · <a href="/profile/${h}/post/3kpost">3시간</a><p>게시물 본문</p><button data-testid="postDropdownBtn">⋯</button></div>`;
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>Bluesky</title><script>localStorage.setItem('BSKY_STORAGE', JSON.stringify({ session: { currentAccount: { did: 'did:plc:me', handle: 'me.test', service: 'https://bsky.social/', pdsUrl: 'https://bsky.social', accessJwt: 'TEST-ACCESS-JWT' }, accounts: [] } }));</script></head><body style="background:#111;color:#eee">
        ${item('alice.test', '앨리스')}${item('bob.test', '밥')}${item('expired.test', '만료 테스트')}${item('me.test', '나')}</body></html>`);
    }
    if (u.pathname === '/sound') {
      // 블루스카이 피드처럼 음소거 자동 재생 + 영상 옆 음소거 해제 버튼
      return html(res, page('Bluesky', `<div class="card"><div><div><video id="bv" src="https://cdn.example-videos.com/preview.webm" muted autoplay loop playsinline style="width:480px;height:270px;background:#000"></video></div>
        <button id="bm" aria-label="Unmute" onclick="window.__bskyUnmute = true; const v = document.getElementById('bv'); v.muted = !v.muted; this.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute')">🔇</button></div></div>`));
    }
    if (u.pathname === '/feedvideo') {
      // 블루스카이 피드(SPA): 탭 제목은 처음 연 페이지 것('ㅎㅊㅁㅃ')으로 남아 있고, 게시물에는 작성자 이름·본문이 있다
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>ㅎㅊㅁㅃ</title><meta property="og:title" content="ㅎㅊㅁㅃ"></head><body style="background:#111;color:#eee">
        <div data-testid="feedItem-by-dana.test" style="width:560px;padding:12px">
          <div><a href="/profile/dana.test" aria-label="다나"><img data-testid="userAvatarImage" src="https://cdn.example-videos.com/img/photo.jpg" style="width:40px;height:40px;border-radius:50%"></a>
          <a href="/profile/dana.test">다나</a> <a href="/profile/dana.test">@dana.test</a> · <a href="/profile/dana.test/post/3kdanapost">3시간</a></div>
          <div data-testid="postText">고양이랑 놀았어요</div>
          <video src="https://cdn.example-videos.com/preview.webm" poster="https://video.bsky.app/watch/did%3Aplc%3Amockalice/bafkreimockoriginal000000000000000000000000000000000001/thumbnail.jpg" muted style="width:480px;height:360px;background:#000"></video>
        </div></body></html>`);
    }
    if (u.pathname === '/feedphoto') {
      // 블루스카이 피드(SPA) 사진: 탭 제목은 'ㅎㅊㅁㅃ'로 남아 있음. 이름 링크 하나에 이름·@아이디가 같이 들어 있는 실제 구조.
      //   게시물 사진을 누르면 게시물 밖의 크게 보기 창(#lb)이 열린다. #lone 은 어느 게시물에도 속하지 않은 사진(오류 경로).
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>ㅎㅊㅁㅃ</title><meta property="og:title" content="ㅎㅊㅁㅃ"></head><body style="background:#111;color:#eee">
        <div data-testid="feedItem-by-erin.test" style="width:560px;padding:12px">
          <div><a href="/profile/erin.test"><span>에린</span>\n<span>@erin.test</span></a> · <a href="/profile/erin.test/post/3kerinpost">2시간</a></div>
          <div data-testid="postText">바다 사진이에요 #여행</div>
          <img id="ep" alt="" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover" onclick="document.getElementById('lb').style.display='flex'">
        </div>
        <div style="width:560px;padding:12px"><img id="lone" alt="" src="https://cdn.example-videos.com/img/photo.jpg" style="width:480px;height:320px;object-fit:cover"></div>
        <div id="lb" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);align-items:center;justify-content:center;z-index:50"><img id="lbimg" alt="" src="https://cdn.example-videos.com/img/photo.jpg" style="width:600px;height:400px;object-fit:cover"></div>
        </body></html>`);
    }
    if (u.pathname === '/profile/fran.test/post/3kthreadpost') {
      // 블루스카이 게시물 상세(스레드) 화면의 영상: 탭 제목이 이전 페이지 것으로 남아 있음
      return html(res, `<!doctype html><html><head><meta charset="utf-8"><title>ㅎㅊㅁㅃ</title><meta property="og:title" content="ㅎㅊㅁㅃ"></head><body style="background:#111;color:#eee">
        <div data-testid="postThreadItem-by-fran.test" style="width:560px;padding:12px">
          <div><a href="/profile/fran.test">프랜</a> <a href="/profile/fran.test">@fran.test</a></div>
          <div data-testid="postText">강아지 산책 영상</div>
          <video src="https://cdn.example-videos.com/preview.webm" poster="https://video.bsky.app/watch/did%3Aplc%3Amockalice/bafkreimockoriginal000000000000000000000000000000000001/thumbnail.jpg" muted style="width:480px;height:360px;background:#000"></video>
        </div></body></html>`);
    }
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
  // 구글 번역 공개 주소(gtx) 흉내: 'FAILTEST' 가 들어 있으면 서버 오류
  'translate.googleapis.com': (req, res, u) => {
    const q = u.searchParams.get('q') || '';
    log.push({ host: 'translate.googleapis.com', tl: u.searchParams.get('tl'), q });
    if (/FAILTEST/.test(q)) return json(req, res, { error: 'boom' }, 500);
    return json(req, res, [[['오늘 해변에서 노을을 보며 산책했어요. 정말 아름다웠어요!', q, null, null, 1]], null, 'en']);
  },
  'bsky.social': (req, res, u) => {
    // 팔로우 버튼용 (PDS → 앱뷰 프록시)
    const bskyAuth = () => req.headers.authorization === 'Bearer TEST-ACCESS-JWT' && req.headers['atproto-proxy'] === 'did:web:api.bsky.app#bsky_appview';
    if (u.pathname === '/xrpc/app.bsky.actor.getProfiles') {
      if (!bskyAuth()) return json(req, res, { error: 'AuthMissing' }, 401);
      const fol = { 'alice.test': 'at://did:plc:me/app.bsky.graph.follow/3kalice' };
      const profiles = u.searchParams.getAll('actors').map((h) => ({ did: `did:plc:${h.split('.')[0]}`, handle: h, viewer: fol[h] ? { following: fol[h] } : {} }));
      return json(req, res, { profiles });
    }
    if (u.pathname === '/xrpc/app.bsky.graph.getFollows') {
      if (!bskyAuth()) return json(req, res, { error: 'AuthMissing' }, 401);
      const P = (h, viewer = {}) => ({ did: `did:plc:${h}`, handle: `${h}.test`, viewer });
      const actor = u.searchParams.get('actor');
      if (actor === 'errlist.test') return json(req, res, { follows: [P('c1'), { did: 'did:plc:expired', handle: 'expired.test', viewer: {} }, P('c2')] });
      if (u.searchParams.get('cursor') === 'p2') return json(req, res, { follows: [P('b3'), P('blk', { blocking: 'at://x' })] });
      return json(req, res, { follows: [P('alice', { following: 'at://did:plc:me/app.bsky.graph.follow/3kalice' }), { did: 'did:plc:me', handle: 'me.test', viewer: {} }, P('b1'), P('b2')], cursor: 'p2' });
    }
    if (u.pathname === '/xrpc/com.atproto.repo.createRecord' || u.pathname === '/xrpc/com.atproto.repo.deleteRecord') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const b = JSON.parse(body || '{}');
        const kind = u.pathname.endsWith('createRecord') ? 'create' : 'delete';
        log.push({ host: 'bsky.social', bskyFollow: kind, subject: b.record?.subject, rkey: b.rkey, repo: b.repo, collection: b.collection, auth: req.headers.authorization === 'Bearer TEST-ACCESS-JWT' });
        if (b.record?.subject === 'did:plc:expired') return json(req, res, { error: 'ExpiredToken', message: 'Token has expired' }, 400);
        if (kind === 'create') return json(req, res, { uri: `at://did:plc:me/app.bsky.graph.follow/3knew${Date.now()}`, cid: 'bafy' });
        return json(req, res, {});
      });
      return;
    }
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
      res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
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
