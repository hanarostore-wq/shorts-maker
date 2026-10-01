// 사이트 원본 데이터 → 다운로드 설명서(descriptor). 네트워크를 쓰지 않는 순수 함수만 둔다.
//
// descriptor 형식
//   { type: 'file',  url, ext, size?, fallbacks?, headers?, quality? }          원본 파일 그대로 저장
//   { type: 'merge', video: Stream, audio: Stream|null, ext:'mp4', ... }        영상·음성 따로 받아 MP4 로 합치기
//   { type: 'hls',   url, ext:'mp4', ... }                                       HLS 최고 화질 → MP4
//   Stream = { url } | { init, segments: [...] }  (+ size, rangeParam, credentials)
//   headers = { referer, origin, ua }  서비스워커가 declarativeNetRequest 로 붙인다.
import { parseMpd } from './mpd.js';

export class BuildError extends Error {
  constructor(reason, action) {
    super(reason);
    this.step = '화질 선택';
    this.reason = reason;
    this.action = action || '페이지를 새로고침한 뒤 다시 시도하세요.';
  }
}

export const normCodec = (s) => {
  const c = String(s || '').toLowerCase();
  if (/av01|av1/.test(c)) return 'av1';
  if (/vp0?9/.test(c)) return 'vp9';
  if (/hev|hvc|h265|265|bytevc1|hevc/.test(c)) return 'hevc';
  if (/avc|h264|264/.test(c)) return 'avc';
  if (/vp8/.test(c)) return 'vp8';
  return c ? c : '';
};

const CODEC_RANK_BEST = { av1: 4, vp9: 3, hevc: 2, avc: 1 };

export function qualityLabel(w, h, fps) {
  const W = Number(w) || 0;
  const H = Number(h) || 0;
  if (!W && !H) return '';
  const short = W && H ? Math.min(W, H) : H || W;
  const name = short >= 2160 ? '4K' : short >= 1440 ? '1440p' : `${short}p`;
  return fps && Number(fps) > 30 ? `${name}${Math.round(Number(fps))}` : name;
}

// 최고 화질 후보 고르기. prefer = 'best' (해상도 최우선) | 'compat' (H.264 우선)
export function rank(cands, prefer = 'best') {
  const list = cands.filter(Boolean).map((c) => ({ ...c, area: (Number(c.w) || 0) * (Number(c.h) || 0), codec: normCodec(c.codec) }));
  let pool = list;
  if (prefer === 'compat') {
    const avc = list.filter((c) => c.codec === 'avc' || !c.codec);
    if (avc.length) pool = avc;
  }
  return pool.sort(
    (a, b) =>
      b.area - a.area ||
      (Number(b.fps) || 0) - (Number(a.fps) || 0) ||
      (prefer === 'compat'
        ? (a.codec === 'avc' ? -1 : 0) - (b.codec === 'avc' ? -1 : 0)
        : (CODEC_RANK_BEST[b.codec] || 0) - (CODEC_RANK_BEST[a.codec] || 0)) ||
      (Number(b.br) || 0) - (Number(a.br) || 0) ||
      (a.prio || 0) - (b.prio || 0),
  );
}

export const httpsUrl = (u) => {
  if (!u || typeof u !== 'string') return '';
  let s = u.trim().replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  if (s.startsWith('//')) s = `https:${s}`;
  if (s.startsWith('http://')) s = `https://${s.slice(7)}`;
  return /^https:\/\//.test(s) ? s : '';
};

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function fileChain(cands, base) {
  // 각 후보의 여러 미러 주소를 순서대로 fallbacks 로 펼친다.
  const all = [];
  for (const c of cands) for (const u of uniq((c.urls || [c.url]).map(httpsUrl))) all.push({ ...c, url: u });
  if (!all.length) return null;
  const [first, ...rest] = all;
  const mk = (c) => ({
    type: 'file',
    url: c.url,
    ext: c.ext || base.ext || 'mp4',
    size: Number(c.size) || 0,
    quality: { w: c.w || 0, h: c.h || 0, label: c.label || qualityLabel(c.w, c.h, c.fps), codec: normCodec(c.codec) },
    headers: base.headers,
  });
  return { ...mk(first), fallbacks: rest.slice(0, 8).map(mk) };
}

function dashToDescriptor(mpd, prefer, headers) {
  const muxed = rank(mpd.muxed.map((r) => ({ ...r, w: r.width, h: r.height, br: r.bandwidth, codec: r.codecs })), prefer)[0];
  const v = rank(mpd.video.map((r) => ({ ...r, w: r.width, h: r.height, br: r.bandwidth, codec: r.codecs })), prefer)[0];
  const audios = [...mpd.audio].sort((a, b) => {
    const aac = (x) => (/mp4a/.test(x.codecs) ? 1 : 0);
    return (prefer === 'compat' ? aac(b) - aac(a) : 0) || b.bandwidth - a.bandwidth;
  });
  const a = audios[0];
  const stream = (r) => (r.url ? { url: r.url } : { init: r.init, segments: r.segments });
  if (v && (!muxed || v.area > muxed.area)) {
    return {
      type: 'merge',
      ext: 'mp4',
      video: stream(v),
      audio: a ? stream(a) : null,
      quality: { w: v.w, h: v.h, label: v.label && /\d/.test(v.label) ? v.label : qualityLabel(v.w, v.h), codec: normCodec(v.codecs) },
      headers,
    };
  }
  if (muxed) {
    if (muxed.url) return { type: 'file', url: muxed.url, ext: 'mp4', quality: { w: muxed.w, h: muxed.h, label: qualityLabel(muxed.w, muxed.h) }, headers };
    return { type: 'merge', ext: 'mp4', video: stream(muxed), audio: null, quality: { w: muxed.w, h: muxed.h, label: qualityLabel(muxed.w, muxed.h) }, headers };
  }
  return null;
}

const withFallback = (primary, ...others) => {
  const list = others.flat().filter(Boolean);
  if (!primary) {
    if (!list.length) return null;
    const [p, ...rest] = list;
    return { ...p, fallbacks: [...(p.fallbacks || []), ...rest] };
  }
  return { ...primary, fallbacks: [...(primary.fallbacks || []), ...list] };
};

// ── YouTube ──
export function ytCodec(mime) {
  const m = /codecs="([^"]+)"/.exec(mime || '');
  return normCodec(m ? m[1] : mime);
}

export function buildYouTube(pr, prefer = 'best', clientUa = '') {
  const sd = pr?.streamingData || {};
  const headers = clientUa ? { ua: clientUa } : undefined;
  const adaptive = (sd.adaptiveFormats || []).filter((f) => f.url);
  const videos = adaptive.filter((f) => /^video\//.test(f.mimeType || ''));
  let audios = adaptive.filter((f) => /^audio\//.test(f.mimeType || '') && !f.isDrc && !/drc/i.test(f.xtags || ''));
  if (audios.some((f) => f.audioTrack)) {
    const def = audios.filter((f) => f.audioTrack?.audioIsDefault);
    if (def.length) audios = def;
  }
  const v = rank(
    videos.map((f) => ({ f, w: f.width, h: f.height, fps: f.fps, br: f.bitrate, codec: ytCodec(f.mimeType) })),
    prefer,
  )[0];
  const a = [...audios].sort((x, y) => {
    const aac = (f) => (/mp4a/.test(f.mimeType || '') ? 1 : 0);
    return aac(y) - aac(x) || (y.bitrate || 0) - (x.bitrate || 0);
  })[0];
  const muxed = rank((sd.formats || []).filter((f) => f.url).map((f) => ({ f, w: f.width, h: f.height, br: f.bitrate, codec: ytCodec(f.mimeType) })), 'best')[0];
  const out = [];
  if (v && a) {
    out.push({
      type: 'merge',
      ext: 'mp4',
      video: { url: v.f.url, size: Number(v.f.contentLength) || 0, rangeParam: true, credentials: 'omit' },
      audio: { url: a.url, size: Number(a.contentLength) || 0, rangeParam: true, credentials: 'omit' },
      quality: { w: v.w, h: v.h, label: v.f.qualityLabel || qualityLabel(v.w, v.h, v.fps), codec: v.codec },
      headers,
    });
  }
  if (sd.hlsManifestUrl) out.push({ type: 'hls', url: sd.hlsManifestUrl, ext: 'mp4', quality: { label: 'HLS' }, headers, prefer });
  if (muxed) {
    out.push({
      type: 'file',
      url: muxed.f.url,
      ext: 'mp4',
      size: Number(muxed.f.contentLength) || 0,
      rangeParam: true,
      credentials: 'omit',
      quality: { w: muxed.w, h: muxed.h, label: muxed.f.qualityLabel || qualityLabel(muxed.w, muxed.h) },
      headers,
    });
  }
  return out.length ? withFallback(out[0], out.slice(1)) : null;
}

// ── TikTok ──
export function buildTikTok(item, prefer = 'best') {
  const v = item?.video || {};
  const cands = [];
  for (const b of v.bitrateInfo || []) {
    const pa = b.PlayAddr || b.playAddr || {};
    const urls = pa.UrlList || pa.urlList || [];
    if (urls.length) cands.push({ urls, w: pa.Width || pa.width, h: pa.Height || pa.height, br: b.Bitrate || b.bitrate, size: pa.DataSize || pa.dataSize, codec: b.CodecType || b.codecType || 'h264', label: '' });
  }
  if (v.PlayAddrStruct?.UrlList?.length) {
    const pa = v.PlayAddrStruct;
    cands.push({ urls: pa.UrlList, w: pa.Width, h: pa.Height, size: pa.DataSize, codec: v.codecType || 'h264', prio: 1 });
  }
  if (typeof v.playAddr === 'string' && v.playAddr) cands.push({ urls: [v.playAddr], w: v.width, h: v.height, br: v.bitrate, codec: v.codecType || 'h264', prio: 2 });
  const ranked = rank(cands, prefer);
  if (typeof v.downloadAddr === 'string' && v.downloadAddr) ranked.push({ urls: [v.downloadAddr], w: v.width, h: v.height, codec: 'avc', label: '워터마크' });
  const d = fileChain(ranked, { headers: { referer: 'https://www.tiktok.com/' } });
  if (!d) throw new BuildError('틱톡 응답에 재생 가능한 영상 주소가 없습니다 (사진 슬라이드 게시물일 수 있습니다).', '영상 게시물인지 확인한 뒤 새로고침하고 다시 시도하세요.');
  return d;
}

// ── Instagram ──
export function buildInstagram(media, prefer = 'best') {
  const prog = rank((media?.video_versions || []).map((v) => ({ url: v.url, w: v.width, h: v.height, codec: 'avc' })), 'best');
  const progDesc = prog.length ? fileChain(prog.slice(0, 3), {}) : null;
  let dashDesc = null;
  if (media?.video_dash_manifest) {
    const mpd = parseMpd(media.video_dash_manifest);
    dashDesc = dashToDescriptor(mpd, prefer, undefined);
    if (dashDesc?.type === 'merge' && !dashDesc.audio && progDesc) dashDesc = null; // 무음 DASH 보다 소리 있는 파일이 낫다
  }
  const progArea = prog[0] ? prog[0].area : 0;
  const dashArea = dashDesc ? (dashDesc.quality.w || 0) * (dashDesc.quality.h || 0) : 0;
  const d = dashDesc && dashArea > progArea ? withFallback(dashDesc, progDesc) : withFallback(progDesc, dashDesc);
  if (!d) throw new BuildError('인스타그램 응답에 영상 주소가 없습니다.', '게시물을 새로고침한 뒤 다시 시도하세요. 비공개 계정이면 로그인이 필요합니다.');
  return d;
}

// ── Facebook ──
export function buildFacebook(video, prefer = 'best') {
  const progs = [];
  const pushProg = (url, label, w, h, prio) => {
    const u = httpsUrl(url);
    if (u) progs.push({ url: u, label, w, h, prio, codec: 'avc' });
  };
  pushProg(video.browser_native_hd_url, 'HD', 1280, 720, 0);
  pushProg(video.playable_url_quality_hd, 'HD', 1280, 720, 1);
  pushProg(video.hd_src, 'HD', 1280, 720, 2);
  for (const p of video.progressive_urls || []) {
    const hd = /hd/i.test(p?.metadata?.quality || '');
    pushProg(p?.progressive_url, hd ? 'HD' : 'SD', hd ? 1280 : 640, hd ? 720 : 360, 3);
  }
  pushProg(video.browser_native_sd_url, 'SD', 640, 360, 4);
  pushProg(video.playable_url, 'SD', 640, 360, 5);
  pushProg(video.sd_src, 'SD', 640, 360, 6);
  const progDesc = progs.length ? fileChain(rank(progs, 'best'), {}) : null;

  const mpd = { video: [], audio: [], muxed: [] };
  for (const xml of [video.dash_manifest, video.dash_manifest_xml_string, video.manifest_xml, ...(video.dash_manifests || [])]) {
    if (typeof xml === 'string' && /<MPD/.test(xml)) {
      const p = parseMpd(xml);
      mpd.video.push(...p.video);
      mpd.audio.push(...p.audio);
      mpd.muxed.push(...p.muxed);
    }
  }
  for (const set of video.prefetch || []) {
    for (const r of set?.representations || []) {
      const url = httpsUrl(r.base_url);
      if (!url) continue;
      const rep = { url, mime: r.mime_type || '', codecs: r.codecs || '', bandwidth: Number(r.bandwidth) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0 };
      if (/^video/.test(rep.mime)) mpd.video.push(rep);
      else if (/^audio/.test(rep.mime)) mpd.audio.push(rep);
    }
  }
  const dashDesc = mpd.video.length ? dashToDescriptor(mpd, prefer, undefined) : null;
  const dashUsable = dashDesc && (dashDesc.type !== 'merge' || dashDesc.audio || !progDesc);
  const dashArea = dashDesc ? (dashDesc.quality.w || 0) * (dashDesc.quality.h || 0) : 0;
  const progArea = progDesc ? (progDesc.quality.w || 0) * (progDesc.quality.h || 0) : 0;
  const d = dashUsable && dashArea > progArea ? withFallback(dashDesc, progDesc) : withFallback(progDesc, dashUsable ? dashDesc : null);
  if (!d) throw new BuildError('페이스북 응답에 영상 주소가 없습니다.', '영상을 재생한 뒤 다시 시도하세요. 비공개 영상이면 로그인이 필요합니다.');
  return d;
}

// ── X ──
export function buildX(media) {
  const variants = media?.video_info?.variants || media?.variants || [];
  const mp4 = variants
    .filter((v) => /mp4/.test(v.content_type || v.type || '') && (v.url || v.src))
    .map((v) => {
      const url = v.url || v.src;
      const m = /\/(\d+)x(\d+)\//.exec(url);
      return { url, br: v.bitrate || 0, w: m ? Number(m[1]) : 0, h: m ? Number(m[2]) : 0, codec: 'avc' };
    })
    .sort((a, b) => b.br - a.br || b.w * b.h - a.w * a.h);
  if (mp4.length) return fileChain(mp4, {});
  const hls = variants.find((v) => /mpegurl/i.test(v.content_type || v.type || ''));
  if (hls) return { type: 'hls', url: hls.url || hls.src, ext: 'mp4', quality: { label: 'HLS' } };
  throw new BuildError('X 게시물에서 영상 주소를 찾지 못했습니다.', '게시물을 새로고침한 뒤 다시 시도하세요. 보호된 계정이면 로그인이 필요합니다.');
}

// ── Douyin ──
export function buildDouyin(aweme, prefer = 'best') {
  const v = aweme?.video || {};
  const cands = [];
  for (const b of v.bit_rate || v.bitRateList || []) {
    const pa = b.play_addr || b.playAddr || {};
    const urls = pa.url_list || (Array.isArray(pa) ? pa.map((x) => x.src) : []) || [];
    if (urls.length) cands.push({ urls, w: pa.width || b.width, h: pa.height || b.height, br: b.bit_rate || b.bitRate, size: pa.data_size || pa.dataSize, codec: b.is_h265 || b.isH265 ? 'hevc' : 'avc', label: '' });
  }
  const pa = v.play_addr || {};
  if (pa.url_list?.length) cands.push({ urls: pa.url_list, w: pa.width || v.width, h: pa.height || v.height, size: pa.data_size, codec: 'avc', prio: 1 });
  if (Array.isArray(v.playAddr) && v.playAddr.length) cands.push({ urls: v.playAddr.map((x) => x.src), w: v.width, h: v.height, codec: 'avc', prio: 2 });
  const d = fileChain(rank(cands, prefer), { headers: { referer: 'https://www.douyin.com/' } });
  if (!d) throw new BuildError('도우인 응답에 영상 주소가 없습니다 (이미지 게시물일 수 있습니다).', '영상 게시물인지 확인한 뒤 새로고침하고 다시 시도하세요.');
  return d;
}

// ── Kuaishou ──
const asObj = (x) => {
  if (!x) return null;
  if (typeof x === 'string') {
    try { return JSON.parse(x); } catch { return null; }
  }
  return x.json ? asObj(x.json) : x;
};
export function buildKuaishou(photo, prefer = 'best') {
  const cands = [];
  const addSets = (m, codecHint) => {
    const o = asObj(m);
    if (!o) return;
    const groups = o.adaptationSet ? [o] : [o.h264, o.hevc, o.h265, o.av1].filter(Boolean);
    for (const g of groups) {
      for (const set of g.adaptationSet || []) {
        for (const r of set.representation || []) {
          const urls = [r.url, ...(r.backupUrl || [])];
          cands.push({ urls, w: r.width, h: r.height, br: r.maxBitrate || r.avgBitrate, codec: r.codecs || (g === o.hevc || g === o.h265 ? 'hevc' : codecHint), label: r.qualityType || '' });
        }
      }
    }
  };
  addSets(photo?.videoResource, 'avc');
  addSets(photo?.manifest, 'avc');
  addSets(photo?.manifestH265, 'hevc');
  if (photo?.photoUrl) cands.push({ urls: [photo.photoUrl], codec: 'avc', prio: 3 });
  if (photo?.photoH265Url) cands.push({ urls: [photo.photoH265Url], codec: 'hevc', prio: 4 });
  const d = fileChain(rank(cands, prefer), { headers: { referer: 'https://www.kuaishou.com/' } });
  if (!d) throw new BuildError('콰이쇼우 응답에 영상 주소가 없습니다.', '영상 상세 화면을 새로고침한 뒤 다시 시도하세요.');
  return d;
}

// ── Xiaohongshu ──
export function buildXiaohongshu(note, prefer = 'best') {
  const video = note?.video || {};
  const key = video.consumer?.originVideoKey || video.consumer?.origin_video_key;
  const stream = video.media?.stream || {};
  const cands = [];
  for (const [codec, list] of Object.entries(stream)) {
    for (const s of list || []) {
      const url = s.masterUrl || s.master_url;
      if (!url) continue;
      cands.push({ urls: [url, ...(s.backupUrls || s.backup_urls || [])], w: s.width, h: s.height, br: s.videoBitrate || s.video_bitrate || s.avgBitrate, size: s.size, codec: s.videoCodec || s.video_codec || codec });
    }
  }
  const ranked = rank(cands, prefer);
  const headers = { referer: 'https://www.xiaohongshu.com/' };
  const streamDesc = fileChain(ranked, { headers });
  const top = ranked[0];
  const original = key
    ? fileChain([{ urls: [`https://sns-video-bd.xhscdn.com/${key}`, `https://sns-video-hw.xhscdn.com/${key}`], w: top?.w, h: top?.h, label: '원본', codec: 'avc' }], { headers })
    : null;
  const d = withFallback(original, streamDesc);
  if (!d) throw new BuildError('샤오홍슈 노트에 영상 주소가 없습니다 (이미지 노트일 수 있습니다).', '영상 노트인지 확인한 뒤 새로고침하고 다시 시도하세요.');
  return d;
}

// ── Weibo ──
export function buildWeibo(info, prefer = 'best') {
  const headers = { referer: 'https://weibo.com/' };
  const cands = [];
  const mi = info?.media || {};
  for (const p of mi.playback_list || []) {
    const pi = p.play_info || p;
    if (pi?.url) cands.push({ urls: [pi.url], w: pi.width, h: pi.height, br: pi.bitrate, codec: pi.video_codecs || 'avc', label: pi.quality_label || p.meta?.label || '', size: pi.size });
  }
  const named = [
    ['mp4_1080p_mp4', 1080], ['mp4_720p_mp4', 720], ['mp4_hd_url', 540], ['stream_url_hd', 540], ['mp4_sd_url', 360], ['stream_url', 360], ['h5_url', 360],
  ];
  for (const [k, h] of named) if (mi[k]) cands.push({ urls: [mi[k]], w: Math.round((h * 16) / 9), h, codec: 'avc', prio: 5 });
  for (const [label, url] of Object.entries(info?.urls || {})) {
    const h = Number(/(\d{3,4})[pP]/.exec(label)?.[1]) || 0;
    cands.push({ urls: [url], w: Math.round((h * 16) / 9), h, label, codec: 'avc', prio: 3 });
  }
  if (info?.direct) cands.push({ urls: [info.direct], codec: 'avc', prio: 9 });
  const d = fileChain(rank(cands, prefer), { headers });
  if (!d) throw new BuildError('웨이보 응답에 영상 주소가 없습니다.', '게시물을 새로고침한 뒤 다시 시도하세요. 로그인하면 고화질이 열리는 경우가 있습니다.');
  return d;
}

// ── Bilibili ──
const BILI_CODEC = { 7: 'avc', 12: 'hevc', 13: 'av1' };
export function buildBilibili(play, prefer = 'best') {
  const headers = { referer: 'https://www.bilibili.com/' };
  const dash = play?.dash;
  if (dash?.video?.length) {
    const vs = rank(
      dash.video.map((v) => ({
        v,
        w: v.width,
        h: v.height,
        fps: Number(v.frameRate || v.frame_rate) || 0,
        br: v.bandwidth,
        codec: BILI_CODEC[v.codecid] || v.codecs,
        q: v.id,
      })),
      prefer,
    );
    vs.sort((a, b) => b.area - a.area || b.q - a.q);
    const best = vs[0];
    const audios = [...(dash.audio || [])].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    const a = audios[0];
    const vUrls = uniq([best.v.baseUrl || best.v.base_url, ...(best.v.backupUrl || best.v.backup_url || [])].map(httpsUrl));
    const aUrls = a ? uniq([a.baseUrl || a.base_url, ...(a.backupUrl || a.backup_url || [])].map(httpsUrl)) : [];
    const label = qualityLabel(best.w, best.h, best.fps);
    const mk = (vu, au) => ({ type: 'merge', ext: 'mp4', video: { url: vu }, audio: au ? { url: au } : null, quality: { w: best.w, h: best.h, label, codec: best.codec }, headers });
    const primary = mk(vUrls[0], aUrls[0]);
    const fallbacks = [];
    for (let i = 1; i < Math.max(vUrls.length, aUrls.length); i++) fallbacks.push(mk(vUrls[i] || vUrls[0], aUrls[i] || aUrls[0]));
    return { ...primary, fallbacks };
  }
  if (play?.durl?.length === 1) {
    const u = play.durl[0];
    const url = httpsUrl(u.url);
    const ext = /\.flv/.test(url) ? 'flv' : 'mp4';
    return { type: 'file', url, ext, size: u.size || 0, quality: { label: '' }, headers, fallbacks: (u.backup_url || []).map((b) => ({ type: 'file', url: httpsUrl(b), ext, headers })) };
  }
  throw new BuildError('빌리빌리 재생 정보에 영상 스트림이 없습니다 (유료/회원 전용일 수 있습니다).', '빌리빌리에 로그인한 뒤 새로고침하고 다시 시도하세요.');
}

// ── Pinterest ──
export function buildPinterest(info) {
  const lists = info?.lists || [];
  let list = lists[0];
  if (lists.length > 1 && info.duration) {
    list = lists.find((l) => Object.values(l || {}).some((e) => Math.abs((Number(e?.duration) || 0) / 1000 - info.duration) < 1.5)) || list;
  }
  const entries = Object.entries(list || {})
    .map(([k, e]) => ({ key: k, url: httpsUrl(e?.url), w: Number(e?.width) || 0, h: Number(e?.height) || 0 }))
    .filter((e) => e.url);
  const mp4 = rank(entries.filter((e) => /\.mp4(\?|$)/.test(e.url)).map((e) => ({ ...e, codec: 'avc' })), 'best');
  const hls = rank(entries.filter((e) => /\.m3u8(\?|$)/.test(e.url)), 'best');
  const mp4Area = mp4[0]?.area || 0;
  const hlsArea = hls[0]?.area || 0;
  const mp4Desc = mp4.length ? fileChain(mp4, {}) : null;
  const hlsDesc = hls.length ? { type: 'hls', url: hls[0].url, ext: 'mp4', quality: { w: hls[0].w, h: hls[0].h, label: qualityLabel(hls[0].w, hls[0].h) || 'HLS' } } : null;
  const d = hlsDesc && hlsArea > mp4Area ? withFallback(hlsDesc, mp4Desc) : withFallback(mp4Desc, hlsDesc);
  if (!d) throw new BuildError('핀 데이터에 영상 주소가 없습니다.', '핀 상세 화면을 새로고침한 뒤 다시 시도하세요.');
  return d;
}

// ── Naver ──
export function buildNaver(info, prefer = 'best') {
  const headers = { referer: 'https://tv.naver.com/' };
  if (info?.play) {
    const list = info.play.videos?.list || [];
    const cands = list.map((v) => ({ urls: [v.source], w: v.encodingOption?.width, h: v.encodingOption?.height, br: (v.bitrate?.video || 0) + (v.bitrate?.audio || 0), size: v.size, codec: 'avc', label: v.encodingOption?.name || '' }));
    const prog = fileChain(rank(cands, prefer), { headers });
    let hls = null;
    for (const s of info.play.streams || []) {
      if (!/hls/i.test(s.type || '') || !s.source) continue;
      const u = new URL(httpsUrl(s.source));
      for (const k of s.keys || []) if (k?.name) u.searchParams.set(k.name, k.value);
      hls = { type: 'hls', url: u.href, ext: 'mp4', quality: { label: 'HLS' }, headers };
      break;
    }
    const d = withFallback(prog, hls);
    if (d) return d;
  }
  if (info?.mpd) {
    const d = dashToDescriptor(parseMpd(info.mpd, info.base), prefer, headers);
    if (d) return d;
  }
  throw new BuildError('네이버 재생 정보에 영상 주소가 없습니다.', '영상을 한 번 재생한 뒤 다시 시도하세요.');
}

// ── Vimeo ──
export function buildVimeo(config, prefer = 'best') {
  const files = config?.request?.files || {};
  const headers = { referer: 'https://vimeo.com/' };
  const prog = rank((files.progressive || []).map((p) => ({ urls: [p.url], w: p.width, h: p.height, fps: p.fps, codec: 'avc' })), 'best');
  const progDesc = prog.length ? fileChain(prog, { headers }) : null;
  let hlsDesc = null;
  const hls = files.hls;
  if (hls?.cdns) {
    const cdn = hls.cdns[hls.default_cdn] || Object.values(hls.cdns)[0];
    const url = prefer === 'compat' ? cdn?.avc_url || cdn?.url : cdn?.url || cdn?.avc_url;
    if (url) hlsDesc = { type: 'hls', url, ext: 'mp4', quality: { label: 'HLS 최고화질' }, headers, prefer };
  }
  // 프로그레시브가 1080p 이상이면 그것이 원본에 가깝다. 아니면 HLS(최대 4K)를 쓴다.
  const progShort = prog[0] ? Math.min(prog[0].w || 0, prog[0].h || 0) : 0;
  const d = progDesc && (progShort >= 1080 || !hlsDesc) ? withFallback(progDesc, hlsDesc) : withFallback(hlsDesc, progDesc);
  if (!d) throw new BuildError('비메오 설정에 재생 주소가 없습니다 (다운로드 제한 또는 비공개 영상일 수 있습니다).', '영상을 재생할 수 있는 상태인지 확인한 뒤 다시 시도하세요.');
  return d;
}

// ── Dailymotion ──
export function buildDailymotion(meta) {
  if (meta?.error) {
    throw new BuildError(`데일리모션이 재생을 거부했습니다: ${meta.error.title || meta.error.message || meta.error.type || '알 수 없는 이유'}`, '영상이 공개 상태인지, 지역 제한이 없는지 확인하세요.');
  }
  const q = meta?.qualities || {};
  const mp4 = [];
  for (const [k, arr] of Object.entries(q)) {
    if (k === 'auto') continue;
    for (const e of arr || []) if (/mp4/.test(e.type || '') && e.url) mp4.push({ url: e.url, h: Number(k) || 0, w: Math.round(((Number(k) || 0) * 16) / 9), codec: 'avc' });
  }
  const auto = (q.auto || []).find((e) => /mpegurl/i.test(e.type || '') && e.url);
  const hlsDesc = auto ? { type: 'hls', url: auto.url, ext: 'mp4', quality: { label: 'HLS 최고화질' } } : null;
  const mp4Desc = mp4.length ? fileChain(rank(mp4, 'best'), {}) : null;
  const d = withFallback(mp4Desc, hlsDesc);
  if (!d) throw new BuildError('데일리모션 메타데이터에 재생 주소가 없습니다.', '영상을 재생한 뒤 다시 시도하세요.');
  return d;
}

// ── 직접 주소 (스냅챗/일반) ──
export function buildDirect(url, pageUrl) {
  const u = httpsUrl(url) || url;
  let referer = '';
  try { referer = new URL(pageUrl).origin + '/'; } catch {}
  const headers = referer ? { referer } : undefined;
  if (/\.m3u8(\?|$)/i.test(u)) return { type: 'hls', url: u, ext: 'mp4', quality: { label: 'HLS 최고화질' }, headers };
  const ext = (/\.(mp4|webm|mov|m4v|mkv|flv)(\?|$)/i.exec(u)?.[1] || 'mp4').toLowerCase();
  return { type: 'file', url: u, ext: ext === 'm4v' ? 'mp4' : ext, quality: { label: '' }, headers };
}

export function buildFromInfo(site, info, prefer, pageUrl) {
  switch (site) {
    case 'tiktok': return buildTikTok(info.item, prefer);
    case 'instagram': return buildInstagram(info.media, prefer);
    case 'facebook': return buildFacebook(info.video, prefer);
    case 'x': return buildX(info.media);
    case 'douyin': return buildDouyin(info.aweme, prefer);
    case 'kuaishou': return buildKuaishou(info.photo, prefer);
    case 'xiaohongshu': return buildXiaohongshu(info.note, prefer);
    case 'weibo': return buildWeibo(info, prefer);
    case 'bilibili': return buildBilibili(info.play, prefer);
    case 'pinterest': return buildPinterest(info);
    case 'naver': return buildNaver(info, prefer);
    case 'vimeo': return buildVimeo(info.config, prefer);
    case 'dailymotion': return buildDailymotion(info.meta);
    case 'snapchat': return { ...buildDirect(info.url, pageUrl), headers: { referer: 'https://www.snapchat.com/' } };
    default:
      if (info?.url) return buildDirect(info.url, pageUrl);
      throw new BuildError('이 사이트의 영상 정보를 해석하지 못했습니다.', '영상을 재생한 뒤 다시 시도하세요.');
  }
}

export { parseMpd, dashToDescriptor };
