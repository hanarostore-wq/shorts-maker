// 네트워크가 필요한 원본 주소 확인 (서비스워커에서 실행). 결과는 builders.js 의 descriptor 형식.
import {
  buildYouTube,
  buildX,
  buildNaver,
  buildVimeo,
  buildDailymotion,
  buildDirect,
  dashToDescriptor,
  parseMpd,
  BuildError,
} from './builders.js';

export class ResolveError extends Error {
  constructor(reason, action, detail) {
    super(reason);
    this.step = '원본 주소 확인';
    this.reason = reason;
    this.action = action || '페이지를 새로고침한 뒤 다시 시도하세요.';
    this.detail = detail || '';
  }
}

async function getJson(url, init = {}, what = '정보') {
  let res;
  try {
    res = await fetch(url, { credentials: 'omit', cache: 'no-store', ...init });
  } catch (err) {
    throw new ResolveError(`${what} 서버에 연결하지 못했습니다 (${new URL(url).hostname}).`, '인터넷 연결을 확인한 뒤 다시 시도하세요.', String(err?.message || err));
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ResolveError(
      `${what} 요청이 HTTP ${res.status} 로 실패했습니다 (${new URL(url).hostname}).`,
      res.status === 403 || res.status === 401 ? '로그인 또는 지역 제한이 있는 영상인지 확인하세요.' : '잠시 후 다시 시도하세요.',
      text.slice(0, 300),
    );
  }
  try {
    return JSON.parse(text.replace(/^\)\]\}',?/, ''));
  } catch {
    if (/<MPD[\s>]/.test(text)) return { __mpd: text };
    throw new ResolveError(`${what} 응답을 해석하지 못했습니다 (JSON 아님).`, '잠시 후 다시 시도하세요.', text.slice(0, 200));
  }
}

// ───────────────────────────── YouTube ─────────────────────────────
// 서명 해독(JS 플레이어 실행)이 필요 없는 공식 앱 클라이언트로 재생 정보를 받는다.
export const YT_CLIENTS = [
  {
    key: 'android_vr',
    nameId: 28,
    ctx: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
    ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  {
    key: 'ios',
    nameId: 5,
    ctx: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
  {
    // 웹(사파리) 클라이언트는 서명 해독 없이 쓸 수 있는 HLS 재생목록(최대 1080p)을 준다.
    key: 'web_safari',
    nameId: 1,
    ctx: { clientName: 'WEB', clientVersion: '2.20250925.01.00' },
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)',
    hlsOnly: true,
  },
];

const YT_STATUS = {
  LOGIN_REQUIRED: ['로그인이 필요한 영상입니다(연령 제한·비공개·회원 전용).', '연령 제한/회원 전용 영상은 지원하지 않습니다. 공개 영상인지 확인하세요.'],
  AGE_CHECK_REQUIRED: ['연령 확인이 필요한 영상입니다.', '연령 제한 영상은 지원하지 않습니다.'],
  UNPLAYABLE: ['재생할 수 없는 영상입니다.', '영상이 지역 제한·저작권 차단 상태인지 확인하세요.'],
  ERROR: ['영상을 찾을 수 없습니다(삭제·비공개).', '주소를 확인하세요.'],
  LIVE_STREAM_OFFLINE: ['아직 시작하지 않은 라이브입니다.', '방송이 끝나 다시보기가 생긴 뒤 시도하세요.'],
};

export async function resolveYouTube(bg, ctx) {
  const errors = [];
  const found = [];
  let title = '';
  let author = '';
  let duration = 0;
  for (const client of YT_CLIENTS) {
    const body = {
      context: { client: { ...client.ctx, userAgent: client.ua, hl: 'ko', gl: 'KR', ...(bg.visitorData ? { visitorData: bg.visitorData } : {}) } },
      videoId: bg.id,
      contentCheckOk: true,
      racyCheckOk: true,
      playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
    };
    let pr;
    try {
      pr = await ctx.withHeaders(['youtube.com'], { ua: client.ua, origin: 'https://www.youtube.com', referer: 'https://www.youtube.com/' }, () =>
        getJson(
          `${ctx.ytBase || 'https://www.youtube.com'}/youtubei/v1/player?prettyPrint=false`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-YouTube-Client-Name': String(client.nameId),
              'X-YouTube-Client-Version': client.ctx.clientVersion,
              ...(bg.visitorData ? { 'X-Goog-Visitor-Id': bg.visitorData } : {}),
            },
            body: JSON.stringify(body),
          },
          '유튜브 재생 정보',
        ),
      );
    } catch (err) {
      errors.push(err);
      continue;
    }
    const st = pr?.playabilityStatus?.status;
    if (st && st !== 'OK') {
      const known = YT_STATUS[st];
      errors.push(new ResolveError(`${known?.[0] || `유튜브가 재생을 거부했습니다 (${st}).`} ${pr.playabilityStatus.reason ? `— ${pr.playabilityStatus.reason}` : ''}`.trim(), known?.[1]));
      if (st === 'ERROR') break;
      continue;
    }
    if (pr?.videoDetails?.isLive || pr?.videoDetails?.isLiveContent && !pr?.streamingData?.adaptiveFormats?.length) {
      throw new ResolveError('진행 중인 라이브 방송은 다운로드할 수 없습니다.', '방송이 끝나 다시보기로 올라온 뒤 시도하세요.');
    }
    const src = client.hlsOnly ? { ...pr, streamingData: { hlsManifestUrl: pr?.streamingData?.hlsManifestUrl } } : pr;
    const d = buildYouTube(src, ctx.prefer, client.ua);
    if (d) {
      title ||= pr?.videoDetails?.title || '';
      duration ||= Number(pr?.videoDetails?.lengthSeconds) || 0;
      author ||= pr?.videoDetails?.author || '';
      // 한 클라이언트의 주소가 막혀도(403) 다음 클라이언트 주소로 이어서 시도하도록 모두 모은다.
      found.push(d, ...(d.fallbacks || []));
      continue;
    }
    errors.push(new ResolveError(`유튜브(${client.key}) 응답에 바로 받을 수 있는 영상 주소가 없습니다.`));
  }
  if (bg.pagePlayer) {
    const d = buildYouTube(bg.pagePlayer, ctx.prefer, '');
    if (d) {
      if (d.type === 'merge') {
        d.video.credentials = 'include';
        if (d.audio) d.audio.credentials = 'include';
      }
      found.push(d, ...(d.fallbacks || []));
    }
  }
  if (found.length) {
    const chain = found.map((d) => {
      const { fallbacks, ...rest } = d;
      // googlevideo 는 확장프로그램 출처(Origin: chrome-extension://)를 싫어할 수 있어 Origin/Referer 를 지운다.
      return { ...rest, headers: { ...(rest.headers || {}), stripOrigin: true } };
    });
    return { ...chain[0], title, author, duration, fallbacks: chain.slice(1) };
  }
  const first = errors.find((e) => /로그인|연령|재생할 수 없는|찾을 수 없습니다|라이브/.test(e.reason || '')) || errors[0];
  throw first || new ResolveError('유튜브 재생 정보를 받지 못했습니다.');
}

// ───────────────────────────── Bluesky ─────────────────────────────
async function resolvePds(did) {
  let doc;
  if (did.startsWith('did:plc:')) doc = await getJson(`https://plc.directory/${did}`, {}, 'DID 문서');
  else if (did.startsWith('did:web:')) doc = await getJson(`https://${did.slice(8)}/.well-known/did.json`, {}, 'DID 문서');
  else throw new ResolveError(`알 수 없는 계정 형식입니다 (${did}).`);
  const svc = (doc.service || []).find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  if (!svc?.serviceEndpoint) throw new ResolveError('계정의 데이터 서버(PDS) 주소를 찾지 못했습니다.');
  return svc.serviceEndpoint.replace(/\/+$/, '');
}

const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/mpeg': 'mpg', 'video/x-matroska': 'mkv' };

export async function resolveBluesky(bg, ctx) {
  let { did, cid } = bg;
  const api = ctx.bskyApi || 'https://public.api.bsky.app';
  if (!did || !cid) {
    let actor = bg.actor;
    if (!actor?.startsWith('did:')) {
      const r = await getJson(`${api}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`, {}, '블루스카이 계정');
      actor = r.did;
    }
    const uri = `at://${actor}/app.bsky.feed.post/${bg.rkey}`;
    const p = await getJson(`${api}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, {}, '블루스카이 게시물');
    const post = p.posts?.[0];
    const emb = post?.embed;
    const vid = /embed\.video/.test(emb?.$type || '') ? emb : /embed\.video/.test(emb?.media?.$type || '') ? emb.media : null;
    if (!vid) throw new ResolveError('이 블루스카이 게시물에는 영상이 없습니다.');
    did = post.author.did;
    cid = vid.cid;
  }
  const hls = {
    type: 'hls',
    url: `${ctx.bskyVideo || 'https://video.bsky.app'}/watch/${encodeURIComponent(did)}/${cid}/playlist.m3u8`,
    ext: 'mp4',
    quality: { label: 'HLS 최고화질' },
  };
  try {
    const pds = await resolvePds(did);
    const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${cid}`;
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, credentials: 'omit', cache: 'no-store' });
    if (probe.ok) {
      const ct = (probe.headers.get('content-type') || '').split(';')[0].trim();
      const size = Number(/\/(\d+)/.exec(probe.headers.get('content-range') || '')?.[1]) || 0;
      probe.body?.cancel().catch(() => {});
      if (/^video\//.test(ct) || ct === 'application/octet-stream') {
        return { type: 'file', url, ext: VIDEO_EXT[ct] || 'mp4', size, credentials: 'omit', quality: { label: '업로드 원본' }, fallbacks: [hls] };
      }
    }
  } catch {}
  return hls;
}

// ───────────────────────────── X (syndication) ─────────────────────────────
export const xToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

export async function resolveX(bg, ctx) {
  if (!bg.tweetId) throw new ResolveError('트윗 ID 를 찾지 못했습니다.', '게시물을 클릭해 상세 화면을 연 뒤 다시 시도하세요.');
  const base = ctx.xSyndication || 'https://cdn.syndication.twimg.com';
  const data = await getJson(`${base}/tweet-result?id=${bg.tweetId}&lang=ko&token=${xToken(bg.tweetId)}`, {}, 'X 게시물');
  const all = [...(data.mediaDetails || []), ...(data.quoted_tweet?.mediaDetails || [])].filter((m) => m.video_info);
  let media = all.find((m) => bg.mediaId && m.id_str === bg.mediaId) || all.find((m) => bg.duration && Math.abs((m.video_info.duration_millis || 0) / 1000 - bg.duration) < 1.5) || all[0];
  if (!media && data.video?.variants) media = { video_info: { variants: data.video.variants.map((v) => ({ content_type: v.type, url: v.src })) } };
  if (!media) throw new ResolveError('이 게시물에서 영상을 찾지 못했습니다 (삭제·보호 계정일 수 있습니다).', 'X 에 로그인한 상태로 타임라인을 새로고침한 뒤 다시 시도하세요.');
  const d = buildX(media);
  d.title = data.text || '';
  d.author = data.user?.screen_name || '';
  return d;
}

// ───────────────────────────── Naver ─────────────────────────────
export async function resolveNaver(bg, ctx) {
  const headers = { referer: 'https://tv.naver.com/' };
  if (bg.videoId && bg.inKey) {
    const base = ctx.naverApi || 'https://apis.naver.com';
    const json = await ctx.withHeaders(['naver.com'], headers, () =>
      getJson(`${base}/rmcnmv/rmcnmv/vod/play/v2.0/${bg.videoId}?key=${encodeURIComponent(bg.inKey)}`, {}, '네이버 재생 정보'),
    );
    if (json.__mpd) return buildNaver({ mpd: json.__mpd, base: `${base}/` }, ctx.prefer);
    return buildNaver({ play: json }, ctx.prefer);
  }
  const apis = ctx.sniffed().filter((s) => s.kind === 'naver-api');
  for (const s of apis) {
    try {
      const json = await ctx.withHeaders(['naver.com'], headers, () => getJson(s.url, {}, '네이버 재생 정보'));
      if (json.__mpd) return buildNaver({ mpd: json.__mpd, base: s.url }, ctx.prefer);
      return buildNaver({ play: json }, ctx.prefer);
    } catch {}
  }
  return resolveSniff(bg, ctx);
}

// ───────────────────────────── Vimeo ─────────────────────────────
export async function resolveVimeo(bg, ctx) {
  const url = bg.configUrl || `${ctx.vimeoPlayer || 'https://player.vimeo.com'}/video/${bg.id}/config`;
  const cfg = await ctx.withHeaders(['vimeo.com'], { referer: ctx.pageUrl || 'https://vimeo.com/' }, () => getJson(url, {}, '비메오 플레이어 설정'));
  const d = buildVimeo(cfg, ctx.prefer);
  d.title = cfg?.video?.title || '';
  d.author = cfg?.video?.owner?.name || '';
  return d;
}

// ───────────────────────────── Dailymotion ─────────────────────────────
export async function resolveDailymotion(bg, ctx) {
  const base = ctx.dailymotion || 'https://www.dailymotion.com';
  const meta = await getJson(
    `${base}/player/metadata/video/${bg.xid}?embedder=${encodeURIComponent(ctx.pageUrl || 'https://www.dailymotion.com/')}&locale=ko-KR&dmV1st=&dmTs=&is_native_app=0`,
    {},
    '데일리모션 메타데이터',
  );
  const d = buildDailymotion(meta);
  d.title = meta?.title || '';
  d.author = meta?.owner?.screenname || meta?.owner?.username || '';
  return d;
}

// ───────────────────────────── 네트워크 감지 기반(일반 사이트) ─────────────────────────────
export async function resolveSniff(bg, ctx) {
  const list = ctx.sniffed();
  const hls = list.filter((s) => s.kind === 'hls');
  for (const s of hls) {
    try {
      const res = await fetch(s.url, { credentials: 'include', cache: 'no-store' });
      const text = await res.text();
      if (/#EXT-X-STREAM-INF/.test(text)) return { ...buildDirect(s.url, ctx.pageUrl), quality: { label: 'HLS 최고화질' } };
    } catch {}
  }
  if (hls.length) return buildDirect(hls[0].url, ctx.pageUrl);
  const dash = list.find((s) => s.kind === 'dash');
  if (dash) {
    const res = await fetch(dash.url, { credentials: 'include', cache: 'no-store' });
    const d = dashToDescriptor(parseMpd(await res.text(), dash.url), ctx.prefer, undefined);
    if (d) return d;
  }
  const files = list.filter((s) => s.kind === 'file' && (s.size === 0 || s.size > 200 * 1024)).sort((a, b) => b.size - a.size || b.t - a.t);
  if (files.length) return buildDirect(files[0].url, ctx.pageUrl);
  throw new ResolveError(
    '이 영상의 실제 파일 주소를 감지하지 못했습니다 (암호화(DRM) 스트림이거나 아직 재생 전입니다).',
    '영상을 몇 초 재생한 뒤 다시 다운로드 버튼을 누르세요. 넷플릭스 같은 DRM 보호 영상은 저장할 수 없습니다.',
  );
}

export async function resolveBg(request, ctx) {
  const bg = request.bg || {};
  switch (bg.kind) {
    case 'youtube': return resolveYouTube(bg, ctx);
    case 'bluesky': return resolveBluesky(bg, ctx);
    case 'x': return resolveX(bg, ctx);
    case 'naver': return resolveNaver(bg, ctx);
    case 'vimeo': return resolveVimeo(bg, ctx);
    case 'dailymotion': return resolveDailymotion(bg, ctx);
    case 'sniff': return resolveSniff(bg, ctx);
    default: throw new BuildError(`알 수 없는 요청 종류입니다 (${bg.kind}).`);
  }
}
