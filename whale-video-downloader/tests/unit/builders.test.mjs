import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../extension/background/builders.js';
import { parseMpd, isoDuration } from '../../extension/background/mpd.js';
import { buildFilename, sanitizeFolder, sanitizePart, countryFlag, countryName } from '../../extension/shared/filename.js';
import { xToken } from '../../extension/background/resolvers.js';

const IG_MPD = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT6S"><Period><AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="1" codecs="avc1.640028" width="1080" height="1920" bandwidth="3000000" FBQualityLabel="1080p"><BaseURL>https://scontent.cdninstagram.com/v1080.mp4?a=1&amp;b=2</BaseURL><SegmentBase indexRange="800-1000"><Initialization range="0-799"/></SegmentBase></Representation>
<Representation id="2" codecs="avc1.4d401f" width="720" height="1280" bandwidth="1500000" FBQualityLabel="720p"><BaseURL>https://scontent.cdninstagram.com/v720.mp4</BaseURL></Representation>
</AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation id="a" codecs="mp4a.40.2" bandwidth="128000"><BaseURL>https://scontent.cdninstagram.com/a.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>`;

test('MPD: BaseURL 표현, &amp; 디코딩, 비디오/오디오 분리', () => {
  const m = parseMpd(IG_MPD);
  assert.equal(m.video.length, 2);
  assert.equal(m.audio.length, 1);
  assert.equal(m.video[0].url, 'https://scontent.cdninstagram.com/v1080.mp4?a=1&b=2');
  assert.equal(m.duration, 6);
});

test('MPD: SegmentTemplate $Number$ 과 SegmentTimeline 확장', () => {
  const xml = `<MPD mediaPresentationDuration="PT10S"><BaseURL>https://cdn.test/v/</BaseURL><Period>
  <AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number%03d$.m4s"/>
  <Representation id="hd" width="1920" height="1080" bandwidth="5000000" codecs="avc1.640028"/></AdaptationSet>
  <AdaptationSet mimeType="audio/mp4"><Representation id="aud" bandwidth="128000" codecs="mp4a.40.2"><SegmentTemplate timescale="48000" initialization="a/init.mp4" media="a/$Time$.m4s"><SegmentTimeline><S t="0" d="96000" r="2"/><S d="48000"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet>
  </Period></MPD>`;
  const m = parseMpd(xml);
  assert.equal(m.video[0].init, 'https://cdn.test/v/hd/init.mp4');
  assert.deepEqual(m.video[0].segments, ['https://cdn.test/v/hd/seg-001.m4s', 'https://cdn.test/v/hd/seg-002.m4s', 'https://cdn.test/v/hd/seg-003.m4s']);
  assert.deepEqual(m.audio[0].segments.map((u) => u.split('/').pop()), ['0.m4s', '96000.m4s', '192000.m4s', '288000.m4s']);
  assert.equal(isoDuration('PT1M2.5S'), 62.5);
});

test('rank: 최고화질은 해상도 우선, 호환성 모드는 H.264 우선', () => {
  const c = [
    { id: 'avc1080', w: 1920, h: 1080, codec: 'avc1' },
    { id: 'vp9-2160', w: 3840, h: 2160, codec: 'vp9' },
    { id: 'av1-2160', w: 3840, h: 2160, codec: 'av01' },
  ];
  assert.equal(B.rank(c, 'best')[0].id, 'av1-2160');
  assert.equal(B.rank(c, 'compat')[0].id, 'avc1080');
});

test('YouTube: 적응형 최고 화질 + AAC 오디오 병합, 서명 필요한 형식 제외', () => {
  const pr = {
    playabilityStatus: { status: 'OK' },
    streamingData: {
      formats: [{ itag: 18, url: 'https://rr1.googlevideo.com/18', mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', width: 640, height: 360 }],
      adaptiveFormats: [
        { itag: 137, url: 'https://rr1.googlevideo.com/137', mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, fps: 30, bitrate: 4e6, contentLength: '1000', qualityLabel: '1080p' },
        { itag: 313, url: 'https://rr1.googlevideo.com/313', mimeType: 'video/webm; codecs="vp9"', width: 3840, height: 2160, fps: 30, bitrate: 2e7, contentLength: '9000', qualityLabel: '2160p' },
        { itag: 401, signatureCipher: 's=abc&url=...', mimeType: 'video/mp4; codecs="av01.0.12M.08"', width: 3840, height: 2160 },
        { itag: 251, url: 'https://rr1.googlevideo.com/251', mimeType: 'audio/webm; codecs="opus"', bitrate: 160000 },
        { itag: 140, url: 'https://rr1.googlevideo.com/140', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '500' },
      ],
    },
  };
  const best = B.buildYouTube(pr, 'best', 'UA');
  assert.equal(best.type, 'merge');
  assert.match(best.video.url, /313$/);
  assert.match(best.audio.url, /140$/);
  assert.equal(best.video.rangeParam, true);
  assert.equal(best.headers.ua, 'UA');
  assert.equal(best.quality.label, '2160p');
  assert.equal(best.fallbacks.at(-1).type, 'file');
  const compat = B.buildYouTube(pr, 'compat');
  assert.match(compat.video.url, /137$/);
});

test('TikTok: bitrateInfo 중 최고 해상도, 미러 주소 fallback, Referer 지정', () => {
  const d = B.buildTikTok({
    video: {
      playAddr: 'https://v16.tiktok.com/play540',
      width: 576,
      height: 1024,
      downloadAddr: 'https://v16.tiktok.com/wm',
      bitrateInfo: [
        { Bitrate: 800000, CodecType: 'h264', PlayAddr: { Width: 720, Height: 1280, UrlList: ['https://v16.tiktok.com/720a'] } },
        { Bitrate: 2000000, CodecType: 'h264', PlayAddr: { Width: 1080, Height: 1920, UrlList: ['https://v16.tiktok.com/1080a', 'https://v19.tiktok.com/1080b'], DataSize: 123 } },
      ],
    },
  });
  assert.equal(d.url, 'https://v16.tiktok.com/1080a');
  assert.equal(d.fallbacks[0].url, 'https://v19.tiktok.com/1080b');
  assert.equal(d.fallbacks.at(-1).url, 'https://v16.tiktok.com/wm');
  assert.equal(d.headers.referer, 'https://www.tiktok.com/');
  assert.equal(d.quality.label, '1080p');
});

test('Instagram: DASH 가 더 높은 해상도면 영상+음성 병합, 아니면 프로그레시브', () => {
  const d = B.buildInstagram({ video_versions: [{ url: 'https://scontent.cdninstagram.com/p720.mp4', width: 720, height: 1280 }], video_dash_manifest: IG_MPD });
  assert.equal(d.type, 'merge');
  assert.match(d.video.url, /v1080/);
  assert.match(d.audio.url, /a\.m4a/);
  assert.equal(d.fallbacks[0].type, 'file');
  const p = B.buildInstagram({ video_versions: [{ url: 'https://scontent.cdninstagram.com/p1080.mp4', width: 1080, height: 1920 }] });
  assert.equal(p.type, 'file');
});

test('Facebook: prefetch 표현(base_url) 병합 우선, HD 프로그레시브 fallback', () => {
  const d = B.buildFacebook({
    browser_native_hd_url: 'https://video.xx.fbcdn.net/hd.mp4',
    browser_native_sd_url: 'https://video.xx.fbcdn.net/sd.mp4',
    prefetch: [{ representations: [
      { base_url: 'https://video.xx.fbcdn.net/v1080.mp4', mime_type: 'video/mp4', codecs: 'avc1.640028', width: 1080, height: 1920, bandwidth: 3e6 },
      { base_url: 'https://video.xx.fbcdn.net/a.mp4', mime_type: 'audio/mp4', codecs: 'mp4a.40.5', bandwidth: 1e5 },
    ] }],
  });
  assert.equal(d.type, 'merge');
  assert.match(d.video.url, /v1080/);
  assert.equal(d.fallbacks[0].url, 'https://video.xx.fbcdn.net/hd.mp4');
});

test('X: 비트레이트 최고 mp4', () => {
  const d = B.buildX({ video_info: { variants: [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/pl.m3u8' },
    { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/vid/480x852/a.mp4' },
    { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.com/vid/1080x1920/b.mp4' },
  ] } });
  assert.equal(d.url, 'https://video.twimg.com/vid/1080x1920/b.mp4');
  assert.equal(d.quality.label, '1080p');
});

test('Douyin/Kuaishou/XHS/Weibo/Bilibili/Pinterest/Naver/Vimeo/Dailymotion 빌더', () => {
  const dy = B.buildDouyin({ video: { play_addr: { url_list: ['//v26.douyinvod.com/def'], width: 720, height: 1280 }, bit_rate: [
    { bit_rate: 3e6, is_h265: 0, play_addr: { url_list: ['http://v26.douyinvod.com/1080'], width: 1080, height: 1920 } },
    { bit_rate: 1e6, is_h265: 1, play_addr: { url_list: ['https://v26.douyinvod.com/540'], width: 576, height: 1024 } },
  ] } });
  assert.equal(dy.url, 'https://v26.douyinvod.com/1080');
  assert.equal(dy.headers.referer, 'https://www.douyin.com/');

  const ks = B.buildKuaishou({ photoUrl: 'https://v2.kwaicdn.com/low.mp4', manifest: { adaptationSet: [{ representation: [{ url: 'https://v2.kwaicdn.com/720.mp4', width: 720, height: 1280 }, { url: 'https://v2.kwaicdn.com/1080.mp4', backupUrl: ['https://v1.kwaicdn.com/1080.mp4'], width: 1080, height: 1920 }] }] } });
  assert.equal(ks.url, 'https://v2.kwaicdn.com/1080.mp4');
  assert.equal(ks.fallbacks[0].url, 'https://v1.kwaicdn.com/1080.mp4');

  const xhs = B.buildXiaohongshu({ video: { consumer: { originVideoKey: 'pre_post/abc' }, media: { stream: { h264: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/s720.mp4', width: 720, height: 1280 }], h265: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/s1080.mp4', width: 1080, height: 1920 }] } } } });
  assert.equal(xhs.url, 'https://sns-video-bd.xhscdn.com/pre_post/abc');
  assert.equal(xhs.fallbacks.find((f) => /s1080/.test(f.url)).quality.label, '1080p');

  const wb = B.buildWeibo({ media: { mp4_sd_url: 'https://f.video.weibocdn.com/sd.mp4', playback_list: [{ play_info: { url: '//f.video.weibocdn.com/1080.mp4', width: 1080, height: 1920 } }, { play_info: { url: '//f.video.weibocdn.com/720.mp4', width: 720, height: 1280 } }] } });
  assert.equal(wb.url, 'https://f.video.weibocdn.com/1080.mp4');

  const bl = B.buildBilibili({ dash: { video: [
    { id: 80, baseUrl: 'https://upos.bilivideo.com/1080avc.m4s', backupUrl: ['https://upos2.bilivideo.com/1080avc.m4s'], width: 1920, height: 1080, codecid: 7, bandwidth: 3e6 },
    { id: 80, baseUrl: 'https://upos.bilivideo.com/1080hevc.m4s', width: 1920, height: 1080, codecid: 12, bandwidth: 2e6 },
    { id: 64, baseUrl: 'https://upos.bilivideo.com/720.m4s', width: 1280, height: 720, codecid: 7, bandwidth: 1e6 },
  ], audio: [{ id: 30216, baseUrl: 'https://upos.bilivideo.com/a64.m4s', bandwidth: 6e4 }, { id: 30280, baseUrl: 'https://upos.bilivideo.com/a192.m4s', bandwidth: 2e5 }] } }, 'compat');
  assert.equal(bl.type, 'merge');
  assert.match(bl.video.url, /1080avc/);
  assert.match(bl.audio.url, /a192/);
  assert.equal(bl.headers.referer, 'https://www.bilibili.com/');
  assert.match(bl.fallbacks[0].video.url, /upos2/);

  const pn = B.buildPinterest({ lists: [{ V_720P: { url: 'https://v1.pinimg.com/720.mp4', width: 720, height: 1280 }, V_HLSV4: { url: 'https://v1.pinimg.com/hls.m3u8', width: 1080, height: 1920 } }] });
  assert.equal(pn.type, 'hls');
  assert.equal(pn.fallbacks[0].type, 'file');

  const nv = B.buildNaver({ play: { videos: { list: [{ source: 'https://naver-vod.pstatic.net/360.mp4', encodingOption: { width: 640, height: 360, name: '360P' } }, { source: 'https://naver-vod.pstatic.net/1080.mp4', encodingOption: { width: 1920, height: 1080, name: '1080P' } }] } } });
  assert.equal(nv.url, 'https://naver-vod.pstatic.net/1080.mp4');

  const vm = B.buildVimeo({ request: { files: { progressive: [{ url: 'https://vod.vimeocdn.com/540.mp4', width: 960, height: 540 }], hls: { default_cdn: 'akfire', cdns: { akfire: { url: 'https://vod.vimeocdn.com/master.m3u8', avc_url: 'https://vod.vimeocdn.com/avc.m3u8' } } } } } });
  assert.equal(vm.type, 'hls');
  assert.equal(vm.url, 'https://vod.vimeocdn.com/master.m3u8');
  assert.equal(B.buildVimeo({ request: { files: { hls: { default_cdn: 'a', cdns: { a: { url: 'u1', avc_url: 'https://x/avc' } } } } } }, 'compat').url, 'https://x/avc');

  const dm = B.buildDailymotion({ qualities: { auto: [{ type: 'application/x-mpegURL', url: 'https://www.dailymotion.com/cdn/manifest.m3u8' }] } });
  assert.equal(dm.type, 'hls');
  assert.throws(() => B.buildDailymotion({ error: { title: '비공개 영상' } }), /비공개 영상/);
});

test('빌더 오류는 단계·원인·해결 방법을 담는다', () => {
  try {
    B.buildTikTok({ video: {} });
    assert.fail('should throw');
  } catch (err) {
    assert.equal(err.step, '화질 선택');
    assert.ok(err.reason.length > 10);
    assert.ok(err.action.length > 5);
  }
});

test('파일 이름: 금지 문자 제거, 템플릿, 길이, 하위 폴더', () => {
  assert.equal(buildFilename('{title} [{site}-{id}]', { title: 'a/b:c*d?"e"<f>|g', site: 'youtube', id: 'X1' }, 'mp4'), 'a b c d e f g [youtube-X1].mp4');
  assert.equal(buildFilename('{title}', { title: '', site: 'tiktok', siteName: '틱톡' }, 'mp4'), '틱톡 영상.mp4');
  assert.ok(buildFilename('{title}', { title: '가'.repeat(400) }, 'mp4').length < 160);
  assert.equal(buildFilename('{author} - {title}', { title: 'CON', flag: false }, 'mp4'), '_CON.mp4');
  assert.equal(buildFilename('{site}_{author}_{title}', { title: '브이로그', site: 'x', flag: false }, 'mp4'), 'x_브이로그.mp4');
  assert.equal(sanitizeFolder('../영상//쇼츠\\2024/..'), '영상/쇼츠/2024');
  assert.equal(sanitizePart('con'), '_con');
});

test('X 신디케이션 토큰 형식', () => {
  const t = xToken('1790000000000000000');
  assert.match(t, /^[0-9a-z]+$/);
  assert.ok(!/0/.test(t[t.length - 1]));
});

test('국적 깃발: 제목 글자로 추정, 사이트로 보완, 파일 이름 맨 앞에', () => {
  assert.equal(countryFlag('여름 바다 브이로그'), '🇰🇷');
  assert.equal(countryFlag('今日のおすすめ動画です'), '🇯🇵');
  assert.equal(countryFlag('今天的视频很好看'), '🇨🇳');
  assert.equal(countryFlag('Funny cat video'), '🇺🇸');
  assert.equal(countryFlag('', 'douyin'), '🇨🇳');
  assert.equal(countryFlag('สวัสดีครับ'), '🇹🇭');
  assert.equal(buildFilename('{title}', { title: '여름 바다 브이로그', site: 'youtube' }, 'mp4'), '[한국] 여름 바다 브이로그.mp4');
  assert.equal(buildFilename('{title}', { title: 'สวัสดีครับ วิดีโอ', site: 'tiktok' }, 'mp4'), '[태국] สวัสดีครับ วิดีโอ.mp4');
  assert.equal(buildFilename('{title}', { title: '今天的视频', site: 'x', flag: 'emoji' }, 'mp4'), '🇨🇳 今天的视频.mp4');
  assert.equal(countryName('', 'bilibili'), '중국');
  assert.equal(buildFilename('{title}', { title: '여름 바다', flag: false }, 'mp4'), '여름 바다.mp4');
});

test('AI 표시: 파일 이름 앞에 [AI] (국적 표시와 함께)', () => {
  assert.equal(buildFilename('{title}', { title: '여름 바다', ai: true }, 'mp4'), '[한국][AI] 여름 바다.mp4');
  assert.equal(buildFilename('{title}', { title: 'Funny cat', ai: true, flag: false }, 'mp4'), '[AI] Funny cat.mp4');
});
