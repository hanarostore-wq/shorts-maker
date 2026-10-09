// 실제 Chromium 에 확장프로그램을 로드하고, 모의 사이트에서 다운로드 버튼을 눌러 실제 파일이 저장되는지 검증한다.
//   node tests/e2e/run.mjs            전체 실행
//   node tests/e2e/run.mjs youtube    이름에 youtube 가 들어간 시나리오만
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { start, log } from './mock-sites.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const EXT = process.env.EXT_DIR || path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'tests/.out');
const DL = path.join(OUT, 'downloads');
const SHOTS = path.join(OUT, 'screens');
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const only = process.argv[2] || '';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
process.env.E2E_OUT = OUT;

// 테스트 인증서·영상 픽스처는 저장소에 올리지 않고 필요할 때 만든다.
if (!fs.existsSync(path.join(ROOT, 'tests/e2e/certs/server.crt'))) execFileSync('bash', [path.join(ROOT, 'tests/e2e/make-certs.sh')], { stdio: 'inherit' });
if (!fs.existsSync(path.join(ROOT, 'tests/fixtures/media/hls_fmp4/master.m3u8'))) execFileSync('bash', [path.join(ROOT, 'tests/fixtures/make-media.sh')], { stdio: 'inherit' });

const server = await start(443);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-profile-'));
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'Default/Preferences'),
  JSON.stringify({ download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true }, savefile: { default_directory: DL } }),
);

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
  env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost',
    '--ignore-certificate-errors',
    '--no-proxy-server',
    '--autoplay-policy=no-user-gesture-required',
    '--lang=ko-KR',
  ],
});

let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
const extId = new URL(sw.url()).host;
const swLogs = [];
sw.on('console', (m) => swLogs.push(m.text()));

// Playwright 가 다운로드를 가로채지 않고 브라우저 설정(다운로드 폴더)을 따르게 한다.
{
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch((e) => console.log('setDownloadBehavior', e.message));
  await p.close();
}

const listFiles = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push(f);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
};

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height', '-show_entries', 'format=duration,format_name', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { vcodec: v?.codec_name, width: v?.width, height: v?.height, acodec: a?.codec_name || null, duration: Number(j.format.duration), format: j.format.format_name };
}

async function extPage(file = 'popup/popup.html') {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/${file}`);
  return p;
}

async function clearDownloaded() {
  const p = await extPage();
  await p.evaluate(() => chrome.storage.local.remove('downloadedKeys'));
  await p.close();
}

async function setSettings(patch) {
  const p = await extPage();
  await p.evaluate(async (patch) => {
    const r = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(r.settings || {}), ...patch } });
  }, patch);
  await p.close();
}

async function waitFile(before, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const now = listFiles(DL).filter((f) => !before.has(f) && !/\.crdownload$|\.tmp$/.test(f));
    if (now.length) {
      // 크기가 안정될 때까지 잠깐 기다림
      await new Promise((r) => setTimeout(r, 400));
      return now[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail.note ? ` — ${detail.note}` : ''}`);
}

async function buttonIn(target, index) {
  const loc = target.locator('smd-anchor .btn.show');
  await loc.nth(index).waitFor({ state: 'visible', timeout: 20000 });
  return loc.nth(index);
}

async function panelText(target) {
  const p = target.locator('smd-anchor .panel');
  return (await p.count()) ? (await p.first().innerText()).replace(/\s+/g, ' ') : '';
}

// 다운로드 시나리오
async function scenario(s) {
  if (only && !s.name.includes(only)) return;
  const page = await ctx.newPage();
  const t0 = Date.now();
  const logStart = log.length;
  try {
    await page.goto(s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(s.settle ?? 1500);
    const target = s.frame ? page.frameLocator(s.frame) : page;
    const btn = await buttonIn(target, s.index || 0);
    if (s.shot) await page.screenshot({ path: path.join(SHOTS, `${s.shot}.png`) });
    const before = new Set(listFiles(DL));
    await btn.click();
    if (s.expectError) {
      await target.locator('smd-anchor .panel.e').waitFor({ timeout: 60000 });
      await page.waitForTimeout(400); // 패널 페이드인이 끝난 뒤 캡처
      const text = await panelText(target);
      if (s.shot) await page.screenshot({ path: path.join(SHOTS, `${s.shot}-error.png`) });
      const ok = s.expectError.every((needle) => text.includes(needle));
      return record(s.name, ok, { note: text.slice(0, 220), ms: Date.now() - t0 });
    }
    const done = target.locator('smd-anchor .btn.done, smd-anchor .panel.e').first();
    const file = await Promise.race([waitFile(before), done.waitFor({ timeout: 90000 }).then(() => null).catch(() => null)]);
    let saved = file || (await waitFile(before, 8000));
    const errText = await panelText(target);
    if (!saved) return record(s.name, false, { note: `파일이 저장되지 않음. 화면: ${errText}`, ms: Date.now() - t0 });
    const info = probe(saved);
    const e = s.expect;
    const problems = [];
    if (e.ext && !saved.endsWith(`.${e.ext}`)) problems.push(`확장자 ${path.extname(saved)} ≠ .${e.ext}`);
    if (e.width && info.width !== e.width) problems.push(`가로 ${info.width} ≠ ${e.width}`);
    if (e.height && info.height !== e.height) problems.push(`세로 ${info.height} ≠ ${e.height}`);
    if (e.vcodec && info.vcodec !== e.vcodec) problems.push(`코덱 ${info.vcodec} ≠ ${e.vcodec}`);
    if (e.audio && !info.acodec) problems.push('오디오 없음');
    // 종류 폴더 안에 나라별 하위 폴더(한국/미국/…/기타)가 한 단계 더 있다
    if (e.dir && !path.dirname(path.dirname(saved)).endsWith(e.dir)) problems.push(`저장 폴더 ${path.dirname(saved)} (기대: …/${e.dir}/나라)`);
    if (e.country && path.basename(path.dirname(saved)) !== e.country) problems.push(`나라 폴더 ${path.basename(path.dirname(saved))} (기대: ${e.country})`);
    if (!(info.duration > 5)) problems.push(`길이 ${info.duration}s`);
    if (e.minDuration && !(info.duration >= e.minDuration)) problems.push(`길이 ${info.duration}s < ${e.minDuration}`);
    await page.waitForTimeout(300);
    const okText = await panelText(target);
    if (e.noSuccessPanel && okText) problems.push(`완료 창이 떴음: ${okText}`);
    const reqs = log.slice(logStart).filter((l) => s.cdn && l.host === s.cdn && l.method);
    const via = reqs.length ? (reqs.some((r) => r.range) ? '확장 엔진' : '브라우저 다운로드') : '';
    if (process.env.DEBUG_E2E) console.log(reqs.map((r) => `${r.path} range=${r.range} ref=${r.referer}`).join('\n'));
    record(s.name, problems.length === 0, {
      file: path.relative(OUT, saved),
      probe: info,
      note: `${path.relative(DL, saved)} · ${info.width}x${info.height} ${info.vcodec}${info.acodec ? `+${info.acodec}` : ''} · ${info.duration.toFixed(1)}s${via ? ` · ${via}` : ''}${problems.length ? ` · 문제: ${problems.join(', ')}` : ''}`,
      ms: Date.now() - t0,
    });
  } catch (err) {
    const text = await panelText(s.frame ? page.frameLocator(s.frame) : page).catch(() => '');
    record(s.name, false, { note: `${err.message.split('\n')[0]} ${text}`, ms: Date.now() - t0 });
  } finally {
    await page.close();
  }
}

const SUB = 'downloads/영상 1분30초 이하';
const scenarios = [
  { name: '일반 사이트(직접 mp4)', url: 'https://www.example-videos.com/watch', expect: { width: 1920, height: 1080, audio: true, dir: SUB, country: '한국', noSuccessPanel: true }, cdn: 'cdn.example-videos.com', shot: 'generic' },
  { name: '유튜브 일반 영상', url: 'https://www.youtube.com/watch?v=YTwatch0001', expect: { width: 1920, height: 1080, vcodec: 'h264', audio: true }, cdn: 'rr1---sn-mock.googlevideo.com', shot: 'youtube' },
  { name: '유튜브 쇼츠', url: 'https://www.youtube.com/shorts/YTshort0001', expect: { width: 1080, height: 1920, vcodec: 'h264', audio: true }, shot: 'shorts' },
  { name: '틱톡 상세(SSR 데이터)', url: 'https://www.tiktok.com/@creator/video/7300000000000000001', expect: { width: 1080, height: 1920, audio: true }, cdn: 'v16-webapp-prime.tiktok.com', shot: 'tiktok' },
  { name: '틱톡 피드(API 가로채기)', url: 'https://www.tiktok.com/@creator/video/7300000000000000001', index: 1, settle: 2500, expect: { width: 1080, height: 1920, audio: true }, cdn: 'v16-webapp-prime.tiktok.com' },
  { name: '인스타그램 릴스(DASH 1080p 병합)', url: 'https://www.instagram.com/reel/CmockReel01/', expect: { width: 1080, height: 1920, audio: true }, shot: 'instagram' },
  { name: '인스타그램 게시물(API 조회)', url: 'https://www.instagram.com/reel/CmockReel01/', index: 1, expect: { width: 1080, height: 1920, audio: true } },
  { name: '페이스북 릴스(DASH 병합)', url: 'https://www.facebook.com/reel/1234567890123', expect: { width: 1080, height: 1920, audio: true } },
  { name: 'X 게시물(GraphQL 가로채기)', url: 'https://x.com/tester/status/1790000000000000001', expect: { width: 1080, height: 1920, audio: true } },
  { name: 'X 게시물(신디케이션 조회)', url: 'https://x.com/tester/status/1790000000000000002', expect: { width: 1080, height: 1920, audio: true } },
  { name: '블루스카이(업로드 원본 파일)', url: 'https://bsky.app/profile/alice.test/post/3kmockpost1', expect: { ext: 'mov', width: 1280, height: 720, audio: true } },
  { name: '블루스카이(HLS 대체)', url: 'https://bsky.app/profile/alice.test/post/3kmockpost2', expect: { ext: 'mp4', width: 1280, height: 720, audio: true } },
  { name: '샤오홍슈(originVideoKey 원본)', url: 'https://www.xiaohongshu.com/explore/66aa00000000000000000001', expect: { width: 1080, height: 1920, audio: true } },
  { name: '스냅챗 스포트라이트', url: 'https://www.snapchat.com/spotlight/W7_mocksnap', expect: { width: 1080, height: 1920, audio: true } },
  { name: '도우인(bit_rate 최고)', url: 'https://www.douyin.com/video/7400000000000000001', expect: { width: 1080, height: 1920, audio: true } },
  { name: '콰이쇼우(Apollo manifest)', url: 'https://www.kuaishou.com/short-video/3xmockphoto01', expect: { width: 1080, height: 1920, audio: true } },
  { name: '빌리빌리(DASH 병합 + Referer)', url: 'https://www.bilibili.com/video/BV1mock12345', expect: { width: 1920, height: 1080, audio: true } },
  { name: '웨이보(playback_list)', url: 'https://weibo.com/1234567890/MockWb123', expect: { width: 1080, height: 1920, audio: true } },
  { name: '핀터레스트(HLS 1080p)', url: 'https://www.pinterest.com/pin/9876543210/', expect: { width: 1920, height: 1080, audio: true } },
  { name: '네이버 TV(재생정보 API)', url: 'https://tv.naver.com/v/12345678', expect: { width: 1920, height: 1080, audio: true } },
  { name: '네이버 클립(MPD 병합)', url: 'https://m.naver.com/shorts/?mediaId=mock', expect: { width: 1080, height: 1920, audio: true } },
  { name: '비메오(iframe 플레이어, HLS)', url: 'https://vimeo.com/76979871', frame: 'iframe', expect: { width: 1920, height: 1080, audio: true } },
  { name: '데일리모션(메타데이터 → HLS)', url: 'https://www.dailymotion.com/video/x8mock1', expect: { width: 1280, height: 720, audio: true } },
  { name: '유튜브(앱 클라이언트 실패 → 페이지 플레이어 대체)', url: 'https://www.youtube.com/watch?v=YTpage00001', expect: { width: 1920, height: 1080, audio: true } },
  { name: '일반 사이트(Range 미지원 서버 → 스트리밍 저장)', url: 'https://www.example-videos.com/norange', expect: { width: 1080, height: 1920, audio: true } },
  { name: 'X 타임라인(게시물 안 열고, React 데이터)', url: 'https://x.com/home', expect: { width: 1080, height: 1920, audio: true } },
  { name: '[폴더 분류] 1분30초 초과 영상 → 영상 1분30초 초과 폴더', url: 'https://www.example-videos.com/long', settle: 2500, expect: { ext: 'webm', width: 320, height: 180, audio: true, minDuration: 90, dir: 'downloads/영상 1분30초 초과' } },
  // 오류 경로
  { name: '[오류] 진행 중 라이브(HLS)', url: 'https://www.example-videos.com/live', expectError: ['라이브', '해결'] },
  { name: '[오류] 틱톡 만료 주소(403)', url: 'https://www.tiktok.com/@creator/video/7300000000000000009', expectError: ['단계', '영상 데이터 받기', '403', '해결'], shot: 'tiktok-expired' },
  { name: '[오류] 유튜브 로그인 필요 영상', url: 'https://www.youtube.com/watch?v=YTlogin0001', expectError: ['원본 주소 확인', '로그인이 필요한 영상'] },
  { name: '[오류] 데일리모션 비공개', url: 'https://www.dailymotion.com/video/x8private', expectError: ['비공개 영상입니다'] },
];

console.log(`확장프로그램 ID: ${extId}\n`);
// 일반 시나리오는 원본 그대로 저장되는지 보므로 요약 글자 넣기는 끄고, 아래 전용 테스트에서 켠다.
await setSettings({ hideTextPosts: false, subfolder: '', subfolderV: 2, forceH264Aac: false, captionOnMedia: false, preventDuplicates: false, siteFolders: false, noAutoplay: false, alwaysShowButtons: false, siteSettings: {}, siteSettingsV: 3, siteFolderV: 2 }); // 사이트별 기능 설정은 전용 테스트에서 확인. 저장 버튼 항상 표시는 전용 테스트에서 확인(다른 테스트는 마우스를 올린 사진의 버튼을 누름). 자동재생 끄기는 전용 테스트에서 확인. 사이트별 폴더는 전용 테스트에서 확인. 같은 페이지를 여러 번 받는 시나리오가 많아 중복 막기는 전용 테스트에서만 켠다
for (const s of scenarios) await scenario(s);

// ── 저장 위치: 하위 폴더 설정 반영 ──
if (!only || only === 'folder') {
  await setSettings({ subfolder: '쇼츠 소스/2026' });
  await scenario({ name: '[저장 위치] 하위 폴더 설정 반영', url: 'https://www.example-videos.com/watch', expect: { width: 1920, height: 1080, audio: true, dir: '쇼츠 소스/2026/영상 1분30초 이하' } });
  await setSettings({ subfolder: '' });
}

// ── 인스타그램처럼 사진·영상 위에 투명 막이 덮여 있어도 저장 버튼이 눌리고 사이트 동작(확대·열기)은 안 일어남 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ alwaysShowButtons: true, captionOnMedia: false, autoFollow: false });
    await page.goto('https://www.instagram.com/igoverlay', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const centerOf = async (i) => page.evaluate((idx) => {
      // 사진(첫 번째)·영상(두 번째) 각각에 붙은 버튼
      const el = document.querySelectorAll('img[id], video[id]')[idx];
      const b = el?.parentElement.querySelector('smd-anchor')?.shadowRoot.querySelector('.btn.show');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id || '' };
    }, i);
    const p1 = await centerOf(0);
    const before = new Set(listFiles(DL));
    await page.mouse.click(p1.x, p1.y);
    const saved = await waitFile(before, 30000);
    const opened = await page.evaluate(() => window.__igOpened || 0);
    record('[인스타] 사진 위 투명 막이 있어도 저장 버튼으로 저장(게시물 안 열림)', !!saved && opened === 0 && p1.top === 'ov1', { note: `${saved ? path.basename(saved) : '저장 안 됨'} · 맨 위 요소 ${p1.top} · 게시물 열림 ${opened}` });
    await page.locator('#igvid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const p2 = await centerOf(1);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(1200);
    const r2 = await page.evaluate(() => ({ expanded: window.__igExpanded || 0, txt: [...document.querySelectorAll('smd-anchor')].map((h) => h.shadowRoot.querySelector('.btn .txt')?.textContent || '').join('|'), panel: [...document.querySelectorAll('smd-anchor')].some((h) => h.shadowRoot.querySelector('.panel')) }));
    record('[인스타] 영상 위 투명 막이 있어도 버튼이 반응(영상 확대 안 됨)', r2.expanded === 0 && (/분석|준비|%|저장|원본/.test(r2.txt) || r2.panel), { note: JSON.stringify({ 맨위: p2.top, ...r2 }) });
  } catch (err) {
    record('[인스타] 투명 막', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false, autoFollow: true });
    await page.close();
  }
}

// ── 사진이 카드보다 커서 잘려 보여도 저장 버튼은 보이는 영역 안에 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ alwaysShowButtons: true });
    await page.goto('https://www.example-videos.com/clipcard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => {
      const b = document.querySelector('smd-anchor')?.shadowRoot.querySelector('.btn.show');
      if (!b) return null;
      const br = b.getBoundingClientRect();
      const cr = document.getElementById('card').getBoundingClientRect();
      return { inside: br.left >= cr.left && br.right <= cr.right && br.top >= cr.top && br.bottom <= cr.bottom, btn: [Math.round(br.left), Math.round(br.right)], card: [Math.round(cr.left), Math.round(cr.right)] };
    });
    record('[버튼] 사진이 카드보다 커서 잘려도 버튼은 보이는 영역 안(가려지지 않음)', !!r?.inside, { note: JSON.stringify(r) });
  } catch (err) {
    record('[버튼] 잘린 카드', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false });
    await page.close();
  }
}

// ── 인스타 재생바: 영상 아래 재생바를 누르면 그 위치로 이동(사이트 투명 막·클릭 처리에 안 가려짐) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {} });
    await page.goto('https://www.instagram.com/igoverlay', { waitUntil: 'domcontentloaded' });
    await page.locator('#igvid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    const box = await page.evaluate(() => {
      const v = document.getElementById('igvid');
      for (const h of document.querySelectorAll('smd-seek')) {
        const w = h.shadowRoot.querySelector('.w');
        if (w.hidden) continue;
        const b = h.shadowRoot.querySelector('.bar').getBoundingClientRect();
        const vr = v.getBoundingClientRect();
        if (b.top >= vr.top && b.bottom <= vr.bottom + 2) return { x: b.left + b.width * 0.75, y: b.top + b.height / 2, dur: v.duration, txt: h.shadowRoot.querySelector('.t').textContent };
      }
      return null;
    });
    if (!box) throw new Error('재생바가 보이지 않음');
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ t: document.getElementById('igvid').currentTime, expanded: window.__igExpanded || 0 }));
    record('[인스타] 재생바: 75% 지점을 누르면 그 위치로 이동(영상 확대 안 됨)', Math.abs(r.t - box.dur * 0.75) < 0.7 && r.expanded === 0 && /\d+:\d\d \/ \d+:\d\d/.test(box.txt), { note: `이동 ${r.t.toFixed(2)}초 / 길이 ${box.dur.toFixed(2)}초 · 확대 ${r.expanded} · 표시 ${box.txt}` });
    await setSettings({ siteSettings: { instagram: { seekBar: false } } });
    await page.waitForTimeout(800);
    const hidden = await page.evaluate(() => [...document.querySelectorAll('smd-seek')].every((h) => h.shadowRoot.querySelector('.w').hidden));
    record('[인스타] 재생바 끄면 숨김', hidden, { note: hidden ? '숨김' : '보임' });
  } catch (err) {
    record('[인스타] 재생바', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {} });
    await page.close();
  }
}

// 사진·영상 버튼 아래 팔로우·차단·좋아요 줄에서 하나 누르기(그 요소 근처에 뜬 줄)
const clickAct = (page, sel, cls) => page.evaluate(([sel, cls]) => {
  const el = document.querySelector(sel);
  if (!el) return 'no-el';
  const r = el.getBoundingClientRect();
  for (const h of document.querySelectorAll('smd-anchor')) {
    const a = h.shadowRoot?.querySelector('.acts.show');
    if (!a) continue;
    const ar = a.getBoundingClientRect();
    // 그 사진·영상과 겹치거나 바로 위·아래(40px 안)에 있는 줄
    if (ar.width && ar.right > r.left && ar.left < r.right && ar.top >= r.top - 40 && ar.bottom <= r.bottom + 40) {
      a.querySelector(`.act.${cls}`).click();
      return 'ok';
    }
  }
  return 'no-acts';
}, [sel, cls]);
const toastHist = (page) => page.evaluate(() => document.querySelector('smd-toast')?.dataset.history || '');

// ── 모든 사이트: 사진·영상 아래 팔로우 · 차단 · 좋아요 버튼 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, autoFollow: false, alwaysShowButtons: true, postActions: true });
    await page.goto('https://www.example-videos.com/float', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.getElementById('fp2').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(2000);
    const floats = await page.evaluate(() => document.querySelectorAll('smd-float').length);
    const c1 = await clickAct(page, '#fp2', 'l');
    await page.waitForTimeout(1300);
    const like = await page.evaluate(() => ({ lk1: window.__lk1 || 0, lk2: window.__lk2 || 0, clk: window.__clk || 0, label: document.getElementById('lk2').getAttribute('aria-label') }));
    record('[팔로우·차단·좋아요] 좋아요: 그 게시물 좋아요만 눌림(댓글 하트·다른 게시물 안 눌림), 떠 있는 버튼 없음', c1 === 'ok' && like.lk2 === 1 && like.lk1 === 0 && like.clk === 0 && like.label === '좋아요 취소' && floats === 0, { note: JSON.stringify({ c1, floats, ...like }) });
    const c2 = await clickAct(page, '#fp2', 'f');
    await page.waitForTimeout(5200);
    const f = await page.evaluate(() => ({ f1: window.__fol1 || 0, f2: window.__fol2 || 0 }));
    const t2 = await toastHist(page);
    record('[팔로우·차단·좋아요] 팔로우: 그 게시물 작성자만 팔로우 + 결과 알림', c2 === 'ok' && f.f2 === 1 && f.f1 === 0 && /팔로우했습니다/.test(t2), { note: JSON.stringify({ c2, ...f, toast: t2.slice(-80) }) });
    await clickAct(page, '#fp2', 'b');
    await page.waitForTimeout(600);
    const t3 = await toastHist(page);
    record('[팔로우·차단·좋아요] (오류 경로) 차단 미지원 사이트는 단계·원인·조치 안내', /차단 실패/.test(t3) && /단계: 차단 지원 확인/.test(t3) && /조치:/.test(t3), { note: t3.slice(-160) });
    await page.goto('https://www.example-videos.com/float?stuck=1', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.getElementById('fp2').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(2000);
    await clickAct(page, '#fp2', 'l');
    await page.waitForTimeout(1300);
    const t4 = await toastHist(page);
    record('[팔로우·차단·좋아요] (오류 경로) 좋아요가 안 바뀌면 단계·원인·조치', /좋아요 실패/.test(t4) && /단계: 좋아요 누르기/.test(t4), { note: t4.slice(-160) });
    await setSettings({ postActions: false });
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => [...document.querySelectorAll('smd-anchor')].some((h) => h.shadowRoot?.querySelector('.acts.show')));
    record('[팔로우·차단·좋아요] 끄면 숨김', !shown, { note: shown ? '보임' : '숨김' });
  } catch (err) {
    record('[팔로우·차단·좋아요]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {}, autoFollow: true, alwaysShowButtons: false, postActions: true });
    await page.close();
  }
}

// ── 성능 진단(팝업 '이 사이트'): 기능별 시간·페이지 멈춤 표시 ──
{
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.example-videos.com/float', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const pp = await extPage();
    const tabId = await pp.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.example-videos.com/float*' }))[0]?.id);
    await pp.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    await pp.click('.tab[data-tab="site"]');
    await pp.waitForTimeout(600);
    await pp.click('.sp-perf-run');
    await pp.waitForTimeout(800);
    const out = await pp.evaluate(() => document.querySelector('.sp-perf-out').textContent);
    // 오류 경로: 연결할 수 없는 탭
    await page.goto('about:blank');
    await pp.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    await pp.click('.tab[data-tab="site"]');
    await pp.waitForTimeout(600);
    await pp.click('.sp-perf-run');
    await pp.waitForTimeout(800);
    const out2 = await pp.evaluate(() => document.querySelector('.sp-perf-out').textContent);
    await pp.close();
    record('[성능 진단] 기능별 시간·페이지 멈춤·판단 표시', /확장 기능이 쓴 시간/.test(out) && /다운로드 버튼 찾기/.test(out) && /페이지가 멈춘 시간/.test(out) && /판단/.test(out), { note: out.replace(/\n/g, ' / ').slice(0, 300) });
    record('[성능 진단] (오류 경로) 탭과 연결 못 하면 단계·원인·조치', /진단 실패/.test(out2) && /단계:/.test(out2) && /조치:/.test(out2), { note: out2.replace(/\n/g, ' / ') });
  } catch (err) {
    record('[성능 진단]', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close().catch(() => {});
  }
}

// ── 모든 사이트: 재생바(기본 재생 막대가 있는 영상은 건너뜀) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {} });
    await page.goto('https://www.example-videos.com/seek', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => {
      const out = {};
      for (const id of ['sv', 'sc']) {
        const vr = document.getElementById(id).getBoundingClientRect();
        out[id] = [...document.querySelectorAll('smd-seek')].some((h) => {
          const w = h.shadowRoot.querySelector('.w');
          if (w.hidden) return false;
          const b = w.getBoundingClientRect();
          return b.top >= vr.top && b.bottom <= vr.bottom + 2 && Math.abs(b.left - vr.left) < 2;
        });
      }
      return out;
    });
    record('[모든 사이트] 재생바: 재생바 없는 영상에만 표시', r.sv && !r.sc, { note: JSON.stringify(r) });
  } catch (err) {
    record('[모든 사이트] 재생바', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── '받은 적 있음' 표시: 받은 영상에만(같은 음악 링크·같은 피드 주소를 쓰는 다른 영상은 아님) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, alwaysShowButtons: true, downloadedMark: true });
    const p0 = await extPage();
    // A 는 받은 것, 예전 방식의 잘못된 키(음악 링크·피드 주소)도 남아 있는 상태
    await p0.evaluate(() => chrome.storage.local.set({ downloadedKeys: ['instagram:AAAAAAA1', 'instagram:/reels/audio/999000111', 'instagram:/igfeedmark'] }));
    await p0.close();
    await page.goto('https://www.instagram.com/igfeedmark', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const out = {};
      for (const id of ['va', 'vb', 'vc']) {
        const vr = document.getElementById(id).getBoundingClientRect();
        const btn = [...document.querySelectorAll('smd-anchor')].map((h) => h.shadowRoot?.querySelector('.btn')).filter(Boolean).find((b) => {
          const br = b.getBoundingClientRect();
          return br.width && br.left >= vr.left - 2 && br.right <= vr.right + 2 && br.top >= vr.top - 2 && br.bottom <= vr.bottom + 2;
        });
        out[id] = btn ? (btn.classList.contains('downloaded') ? '받은 적 있음' : '다운로드') : '버튼 없음';
      }
      return out;
    });
    record("[받은 적 있음] 받은 영상(A)만 표시, 같은 음악 링크·피드 주소의 다른 영상(B·C)은 아님", r.va === '받은 적 있음' && r.vb === '다운로드' && r.vc === '다운로드', { note: JSON.stringify(r) });
  } catch (err) {
    record('[받은 적 있음] 표시', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false });
    const p1 = await extPage();
    await p1.evaluate(() => chrome.storage.local.set({ downloadedKeys: [] }));
    await p1.close();
    await page.close();
  }
}

// ── 글만 있는 피드 숨기기(켜고 끄기, 늦게 뜬 사진은 다시 보임) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, hideTextPosts: true });
    await page.goto('https://x.com/xtextfeed', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const vis = () => page.evaluate(() => Object.fromEntries(['t1', 'p1', 'v1', 'late'].map((id) => [id, getComputedStyle(document.getElementById(id)).display !== 'none'])));
    const a = await vis();
    await page.waitForTimeout(2500); // 3초에 사진이 생긴 게시물
    const b = await vis();
    await setSettings({ siteSettings: { x: { hideTextPosts: false } } });
    await page.waitForTimeout(800);
    const c = await vis();
    record('[글만 있는 피드] 글만 숨김·사진/영상은 보임·늦게 뜬 사진은 다시 보임·끄면 모두 보임', !a.t1 && a.p1 && a.v1 && !a.late && b.late && !b.t1 && c.t1, { note: JSON.stringify({ 처음: a, 사진생긴뒤: b, 끈뒤: c }) });
  } catch (err) {
    record('[글만 있는 피드]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {}, hideTextPosts: false });
    await page.close();
  }
}

// ── X: 재생 전(표지 사진만 있을 때)에도 영상 다운로드 버튼 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, alwaysShowButtons: true });
    await page.goto('https://x.com/xposter', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const vr = document.getElementById('vp').getBoundingClientRect();
      const btns = [...document.querySelectorAll('smd-anchor')].map((h) => h.shadowRoot?.querySelector('.btn.show')).filter(Boolean);
      const inside = btns.filter((b) => {
        const br = b.getBoundingClientRect();
        return br.left >= vr.left - 2 && br.right <= vr.right + 2 && br.top >= vr.top - 2 && br.bottom <= vr.bottom + 2;
      });
      return { n: inside.length, txt: inside.map((b) => b.textContent.trim()).join('|'), photo: inside.some((b) => /사진/.test(b.title || '')) };
    });
    record('[X] 재생 전(표지 사진만)에도 영상 다운로드 버튼 1개', r.n === 1 && /다운로드/.test(r.txt) && !r.photo, { note: JSON.stringify(r) });
  } catch (err) {
    record('[X] 재생 전 버튼', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false });
    await page.close();
  }
}

// ── 재생바 하나만: 스크롤 상자 밖으로 잘린 위·아래 영상, 뒤에 깔린 배경 영상에는 안 띄움 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {} });
    await page.goto('https://www.instagram.com/igreels', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('smd-seek')].map((h) => h.shadowRoot.querySelector('.w')).filter((w) => !w.hidden).map((w) => w.getBoundingClientRect());
      const m = document.getElementById('main').getBoundingClientRect();
      return { n: shown.length, onMain: shown.length === 1 && shown[0].left >= m.left - 2 && shown[0].right <= m.right + 2 && shown[0].bottom <= m.bottom + 2 && shown[0].top >= m.bottom - 40 };
    });
    record('[재생바] 인스타 릴스: 재생바 1개만(잘린 위·아래 영상·배경 복사본 제외), 보고 있는 영상 아래', r.n === 1 && r.onMain, { note: JSON.stringify(r) });
  } catch (err) {
    record('[재생바] 하나만', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 틱톡·샤오홍슈처럼 사이트가 window 에서 클릭을 먼저 가로채도 저장 버튼이 반응 ──
for (const [SITE, URL_] of [['틱톡', 'https://www.tiktok.com/ttguard'], ['샤오홍슈', 'https://www.xiaohongshu.com/ttguard']]) {
  const page = await ctx.newPage();
  try {
    await setSettings({ alwaysShowButtons: true, captionOnMedia: false, autoFollow: false });
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const centerOf = async (i) => page.evaluate((idx) => {
      // 사진(첫 번째)·영상(두 번째) 각각에 붙은 버튼
      const el = document.querySelectorAll('img[id], video[id]')[idx];
      const b = el?.parentElement.querySelector('smd-anchor')?.shadowRoot.querySelector('.btn.show');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, i);
    const p1 = await centerOf(0);
    const before = new Set(listFiles(DL));
    await page.mouse.click(p1.x, p1.y);
    const saved = await waitFile(before, 30000);
    const site1 = await page.evaluate(() => window.__ttSite || 0);
    record(`[${SITE}] 사이트가 클릭을 먼저 가로채도 사진 저장 버튼 동작(사이트로 클릭 안 넘어감)`, !!saved && site1 === 0, { note: `${saved ? path.basename(saved) : '저장 안 됨'} · 사이트가 받은 클릭 ${site1}` });
    await page.locator('#ttvid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const p2 = await centerOf(1);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(1200);
    const r2 = await page.evaluate(() => ({ site: window.__ttSite || 0, txt: [...document.querySelectorAll('smd-anchor')].map((h) => h.shadowRoot.querySelector('.btn .txt')?.textContent || '').join('|'), panel: [...document.querySelectorAll('smd-anchor')].some((h) => h.shadowRoot.querySelector('.panel')) }));
    record(`[${SITE}] 영상 저장 버튼도 반응`, r2.site === 0 && (/분석|준비|%|저장|원본/.test(r2.txt) || r2.panel), { note: JSON.stringify(r2) });
  } catch (err) {
    record(`[${SITE}] 클릭 가로채기`, false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false, autoFollow: true });
    await page.close();
  }
}

// ── 본문 사진·영상에만 버튼: 댓글 칸 그림·넘김 사진의 옆 장·흐린 배경 사진에는 버튼 없음 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ alwaysShowButtons: true });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('https://www.tiktok.com/ttmedia', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const n = (id) => [...document.getElementById(id).querySelectorAll(':scope > smd-anchor')].filter((h) => h.shadowRoot.querySelector('.btn.show')).length;
      return { 본문: n('mainBox'), 댓글: n('cBox'), 넘김사진: n('carBox'), 배경겹침: n('bgBox'), 전체: [...document.querySelectorAll('smd-anchor')].filter((h) => h.shadowRoot.querySelector('.btn.show')).length };
    });
    record('[버튼] 본문 사진에만: 댓글 그림·넘김 사진 옆 장·흐린 배경 사진 제외', r.본문 === 1 && r.댓글 === 0 && r.넘김사진 === 1 && r.배경겹침 === 1 && r.전체 === 3, { note: JSON.stringify(r) });
  } catch (err) {
    record('[버튼] 본문 사진에만', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false });
    await page.close();
  }
}

// ── 인스타 자동 팔로우(인스타 웹 요청) · 샤오홍슈 자동 팔로우(깊은 구조의 关注 단추) ──
{
  const page = await ctx.newPage();
  // 가장 최근 알림(이미 사라졌어도 기록에서)
  const toast = () => page.evaluate(() => {
    const h = document.querySelector('smd-toast');
    try {
      return JSON.parse(h?.dataset.history || '[]').pop() || '';
    } catch {
      return '';
    }
  });
  const save = async (sel) => {
    await page.locator(sel).hover();
    await page.waitForTimeout(500);
    const before = new Set(listFiles(DL));
    const p = await page.evaluate((s) => {
      const b = document.querySelector(s).parentElement.querySelector('smd-anchor')?.shadowRoot.querySelector('.btn.show');
      const r = b?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, sel);
    await page.mouse.click(p.x, p.y);
    await waitFile(before, 30000);
    await page.waitForTimeout(5500); // 화면 단추 방식은 4.5초 뒤 최종 상태로 확인
  };
  try {
    await setSettings({ autoFollow: true, captionOnMedia: false, preventDuplicates: false });
    let l = log.length;
    await page.goto('https://www.instagram.com/igfollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#igf');
    const ig = log.slice(l).find((e) => e.igFollow);
    const t1 = await toast();
    record('[자동 팔로우] 인스타: 다운로드하면 인스타 웹 요청으로 작성자 팔로우(보안 값 포함)', ig?.path === '/api/v1/friendships/create/777/' && ig.csrf === 'TESTCSRF' && ig.app === '936619743392459' && /@igauthor 팔로우했습니다/.test(t1), { note: `${JSON.stringify(ig || '요청 없음')} · ${t1}` });
    l = log.length;
    await page.goto('https://www.instagram.com/igfollow-err', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#igf');
    const t2 = await toast();
    record('[자동 팔로우] (오류 경로) 인스타 작성자 정보를 못 받으면 단계·원인·조치 알림', !log.slice(l).some((e) => e.igFollow) && /단계: 작성자 정보 확인/.test(t2) && /HTTP 404/.test(t2), { note: t2 || '알림 없음' });
    // 인스타가 계정 번호 요청을 429 로 막으면: 원인(HTTP 429)과 조치 안내
    l = log.length;
    await page.goto('https://www.instagram.com/igfollow-429', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#igf');
    const t4 = await toast();
    record('[자동 팔로우] (오류 경로) 인스타가 429 로 막으면 원인·조치 안내', /HTTP 429/.test(t4) && /몇 분 뒤/.test(t4) && !log.slice(l).some((e) => e.igFollow), { note: t4 || '알림 없음' });
    // 페이지 데이터에 계정 번호가 있으면 따로 묻지 않고 바로 팔로우(429 를 피함)
    l = log.length;
    await page.goto('https://www.instagram.com/igfollow-cached', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#igf');
    const c = log.slice(l);
    const t5 = await toast();
    record('[자동 팔로우] 인스타: 페이지 데이터의 계정 번호로 바로 팔로우(작성자 정보 요청 안 함)', c.some((e) => e.igFollow && e.path === '/api/v1/friendships/create/888/') && !c.some((e) => e.igLookup) && /@igcached 팔로우했습니다/.test(t5), { note: `${JSON.stringify(c.filter((e) => e.igFollow || e.igLookup))} · ${t5}` });
    // 틱톡: 추천 계정 단추가 아니라 작성자 프로필 옆 팔로우를 누르고, 서버가 되돌리면 실패로 알림
    await page.goto('https://www.tiktok.com/@ttauthor/photo/7300000000000000777', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#ttp');
    const tt = await page.evaluate(() => ({ author: window.__ttFollow || 0, rec: window.__recFollow || 0, txt: document.getElementById('tfb').textContent }));
    const t6 = await toast();
    record('[자동 팔로우] 틱톡: 추천 계정 말고 작성자 팔로우 단추를 누르고 결과 확인', tt.author === 1 && tt.rec === 0 && /@ttauthor 팔로우했습니다/.test(t6), { note: `${JSON.stringify(tt)} · ${t6}` });
    await page.goto('https://www.tiktok.com/@ttauthor/photo/7300000000000000778', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#ttp');
    const t7 = await toast();
    record('[자동 팔로우] (오류 경로) 틱톡이 팔로우를 되돌리면 "팔로우했습니다" 대신 실패 안내', /단계: 팔로우 확인/.test(t7) && /직접 눌러/.test(t7) && !/팔로우했습니다/.test(t7), { note: t7 || '알림 없음' });
    await page.goto('https://www.xiaohongshu.com/xhsfollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await save('#xp');
    const x = await page.evaluate(() => ({ n: window.__xhsFollow || 0, txt: document.getElementById('xf').textContent }));
    const t3 = await toast();
    record('[자동 팔로우] 샤오홍슈: 노트 창의 关注 단추를 눌러 팔로우하고 결과 알림', x.n === 1 && x.txt === '已关注' && /팔로우했습니다/.test(t3), { note: `${JSON.stringify(x)} · ${t3}` });
  } catch (err) {
    record('[자동 팔로우] 인스타·샤오홍슈', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 영상 화면 크기 줄이기(모든 사이트, 켜기·끄기·사이트별 %) ──
{
  const page = await ctx.newPage();
  try {
    // 처음 설치 값: 유튜브만 70% 로 켬(마이그레이션)
    await setSettings({ siteSettingsV: 2, siteSettings: {} });
    const mig = await (async () => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${extId}/popup/popup.html`);
      await p.waitForTimeout(800);
      const r = await p.evaluate(async () => (await chrome.storage.local.get('settings')).settings.siteSettings.youtube);
      await p.close();
      return r;
    })();
    await page.goto('https://www.youtube.com/watch?v=YTwatch0001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const f = document.createElement('ytd-watch-flexy');
      f.innerHTML = '<div id="primary-inner"><div id="player" style="width:800px;height:450px"><video src="https://cdn.example-videos.com/preview.webm" muted style="width:800px;height:450px"></video></div></div>';
      document.body.prepend(f);
    });
    await page.waitForTimeout(1500);
    const zy = () => page.evaluate(() => getComputedStyle(document.querySelector('ytd-watch-flexy #player')).zoom);
    const z70 = await zy();
    // 그 밖의 사이트: 기본값은 끔 → 이 사이트만 50% 로 켬 → 끔
    await page.goto('https://www.example-videos.com/seek', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const w = () => page.evaluate(() => Math.round(document.getElementById('sv').getBoundingClientRect().width));
    const g0 = await w();
    await setSettings({ siteSettings: { generic: { videoSmall: true, videoScale: 50 } } });
    await page.waitForTimeout(1600);
    const g50 = await w();
    await setSettings({ siteSettings: { generic: { videoSmall: false } } });
    await page.waitForTimeout(800);
    const goff = await w();
    record('[모든 사이트] 영상 화면 크기: 유튜브 70% 기본·다른 사이트 50% 켜기/끄기', mig?.videoSmall === true && mig?.videoScale === 70 && z70 === '0.7' && g0 === 640 && g50 === 320 && goff === 640, { note: JSON.stringify({ 유튜브기본: mig, z70, 일반끔: g0, 일반50: g50, 다시끔: goff }) });
  } catch (err) {
    record('[모든 사이트] 영상 화면 크기', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {}, siteSettingsV: 3 });
    await page.close();
  }
}

// ── 유튜브: 영상 아래 좋아요 버튼(팔로우·차단·좋아요 줄) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, postActions: true, autoFollow: false });
    await page.goto('https://www.youtube.com/watch?v=YTlike00001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const c = await clickAct(page, 'video', 'l');
    await page.waitForTimeout(1300);
    const r = await page.evaluate(() => ({ liked: window.__liked || 0, pressed: document.getElementById('ytlike').getAttribute('aria-pressed') }));
    record('[유튜브] 영상 아래 좋아요 → 유튜브 좋아요가 눌림', c === 'ok' && r.liked === 1 && r.pressed === 'true', { note: JSON.stringify({ c, ...r }) });
    await page.goto('https://www.youtube.com/watch?v=YTwatch0001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await clickAct(page, 'video', 'l');
    await page.waitForTimeout(600);
    const m = await toastHist(page);
    record('[유튜브] (오류 경로) 좋아요 단추가 없으면 단계·원인·조치', /좋아요 실패/.test(m) && /단계: 좋아요 단추 찾기/.test(m) && /조치:/.test(m), { note: m.slice(-160) });
  } catch (err) {
    record('[유튜브] 영상 아래 좋아요', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {}, autoFollow: true });
    await page.close();
  }
}
// ── 저장 버튼 항상 표시: 마우스를 올리거나 재생하지 않아도 사진·영상 버튼이 보임 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ alwaysShowButtons: true });
    await page.goto('https://www.example-videos.com/photos', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const n = await page.locator('smd-anchor .btn.show').count();
    record('[버튼] 저장 버튼 항상 표시: 마우스를 안 올려도 사진 버튼이 보임', n >= 3, { note: `보이는 버튼 ${n}개` });
    await setSettings({ alwaysShowButtons: false });
    await page.waitForTimeout(800);
    const n2 = await page.locator('smd-anchor .btn.show').count();
    record('[버튼] 항상 표시를 끄면 사진 버튼은 마우스를 올렸을 때만', n2 === 0, { note: `보이는 버튼 ${n2}개` });
  } catch (err) {
    record('[버튼] 항상 표시', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false });
    await page.close();
  }
}

// ── 사진 저장 ──
if (!only || only === 'image' || '사진'.includes(only)) {
  for (const [label, idx, ext, w, h] of [['WEBP → PNG 변환', 0, 'png', 1200, 800], ['JPG 원본 그대로', 1, 'jpg', 1600, 1000], ['X 사진 name=orig 원본', 2, 'jpg', 2000, 1500]]) {
    const page = await ctx.newPage();
    const t0 = Date.now();
    try {
      await page.goto('https://www.example-videos.com/photos', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      const img = page.locator('img.photo').nth(idx);
      await img.scrollIntoViewIfNeeded();
      await img.hover();
      await page.waitForTimeout(400);
      const btn = page.locator(`smd-anchor .btn.show`).first();
      await btn.waitFor({ timeout: 10000 });
      const before = new Set(listFiles(DL));
      await btn.click();
      const saved = await waitFile(before, 30000);
      const out = saved ? execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', saved]).toString().trim() : '';
      const ok = !!saved && saved.endsWith(`.${ext}`) && out.includes(`${w},${h}`) && path.basename(path.dirname(saved)) === '사진'; // 사진은 한 폴더(다운로드/사진)
      record(`[사진] ${label}`, ok, { note: saved ? `${path.relative(DL, saved)} · ${out}` : '파일 없음', ms: Date.now() - t0 });
    } catch (err) {
      record(`[사진] ${label}`, false, { note: err.message.split('\n')[0] });
    } finally {
      await page.close();
    }
  }
}

// ── X 사진(투명 img 겹침) 인식 + 사진 모두 저장 ──
if (!only || only === 'image' || '사진'.includes(only)) {
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto('https://x.com/tester/status/1790000000000000003', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const pic = page.locator('img[alt="이미지"]').first();
    const box = await pic.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const btn = page.locator('smd-anchor .btn.show').first();
    await btn.waitFor({ timeout: 8000 });
    const before = new Set(listFiles(DL));
    await btn.click();
    const saved = await waitFile(before, 30000);
    const out = saved ? execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', saved]).toString().trim() : '';
    record('[사진] X 사진(투명 img 겹침) 버튼 표시 + 원본 저장', out === '2000,1500', { note: saved ? `${path.relative(DL, saved)} · ${out}` : '파일 없음', ms: Date.now() - t0 });

    // 팝업 → 이 페이지 사진 모두 저장
    const pp = await extPage();
    const tabId = await pp.evaluate(async () => (await chrome.tabs.query({ url: 'https://x.com/tester/status/1790000000000000003' }))[0]?.id);
    await pp.setViewportSize({ width: 392, height: 600 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    const all = pp.locator('#saveAllImages');
    await all.waitFor({ state: 'visible', timeout: 8000 });
    const label = await all.innerText();
    const before2 = new Set(listFiles(DL));
    await all.click();
    const t1 = Date.now();
    let added = [];
    while (Date.now() - t1 < 30000) {
      added = listFiles(DL).filter((f) => !before2.has(f) && !/\.crdownload$/.test(f));
      if (added.length >= 2) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    await pp.waitForTimeout(500);
    await pp.screenshot({ path: path.join(SHOTS, 'popup-save-all.png') });
    record('[사진] 팝업 → 이 페이지 사진 모두 저장', added.length === 2 && /2장/.test(label), { note: `${label} → ${added.map((f) => path.basename(f)).join(', ')}` });
    await pp.close();
  } catch (err) {
    record('[사진] X 사진 / 모두 저장', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 영상 위 썸네일에는 사진 버튼이 뜨지 않아야 한다 ──
if (!only || only === 'image' || '사진'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await clearDownloaded();
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const vb = await page.locator('video').boundingBox();
    await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 3);
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => [...document.querySelectorAll('smd-anchor')].filter((h) => h.shadowRoot.querySelector('.btn.show')).length);
    const label = await page.locator('smd-anchor .btn.show').first().getAttribute('title');
    record('[사진] 영상 위 썸네일에는 사진 버튼 없음(영상 다운로드 버튼만)', n === 1 && /원본 화질/.test(label || ''), { note: `보이는 버튼 ${n}개 · ${label}` });
  } catch (err) {
    record('[사진] 영상 위 썸네일 제외', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 사진 버튼: 기본 위치(영상 버튼 자리보다 아래) + 직접 배치 ──
if (!only || only === 'place' || '배치'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.example-videos.com/photos', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const img = page.locator('img.photo').nth(1);
    const geom = () => page.evaluate(() => {
      const im = document.querySelectorAll('img.photo')[1];
      const host = [...document.querySelectorAll('smd-anchor')].find((h) => h.parentElement.contains(im));
      const b = host.shadowRoot.querySelector('.btn');
      const r = im.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return { fx: (br.left + br.width / 2 - r.left) / r.width, fy: (br.top + br.height / 2 - r.top) / r.height };
    });
    const ib = await img.boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.waitForTimeout(400);
    const g0 = await geom();
    record('[사진] 기본 버튼 위치 = 오른쪽, 영상 버튼 자리보다 아래', g0.fx > 0.85 && g0.fy > 0.55 && g0.fy < 0.8, { note: `가로 ${(g0.fx * 100).toFixed(0)}% · 세로 ${(g0.fy * 100).toFixed(0)}%` });

    const tabId = await (async () => { const pp = await extPage(); const id = await pp.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.example-videos.com/photos' }))[0]?.id); await pp.close(); return id; })();
    const pp = await extPage(`popup/popup.html?tabId=${tabId}`);
    await pp.click('.tab[data-tab="settings"]');
    await pp.click('#placeButton');
    await pp.close().catch(() => {});
    await page.locator('smd-toolbar').waitFor({ timeout: 5000 });
    const host = page.locator('smd-anchor').filter({ has: page.locator('.btn.edit') });
    const btnBox = await page.evaluate(() => {
      const im = document.querySelectorAll('img.photo')[1];
      const h = [...document.querySelectorAll('smd-anchor')].find((x) => x.parentElement.contains(im));
      const r = h.shadowRoot.querySelector('.btn').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(btnBox.x, btnBox.y);
    await page.mouse.down();
    await page.mouse.move(ib.x + ib.width * 0.2, ib.y + ib.height * 0.2, { steps: 8 });
    await page.mouse.up();
    await page.locator('smd-toolbar').evaluate((t) => t.shadowRoot.querySelector('[data-a="save"]').click());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const ib2 = await page.locator('img.photo').nth(1).boundingBox();
    await page.mouse.move(ib2.x + ib2.width / 2, ib2.y + ib2.height / 2);
    await page.waitForTimeout(400);
    const g1 = await geom();
    record('[사진] 사진 버튼 직접 배치 → 저장 → 새로고침 후 유지', Math.abs(g1.fx - 0.2) < 0.06 && Math.abs(g1.fy - 0.2) < 0.06, { note: `가로 ${(g1.fx * 100).toFixed(0)}% · 세로 ${(g1.fy * 100).toFixed(0)}%` });
    await setSettings({ imagePlacements: {} });
  } catch (err) {
    record('[사진] 사진 버튼 배치', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 모든 사이트: 사진 확대 창에서 사진을 누르면 닫힘(켠 사이트만) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: { generic: { xPhotoTapClose: true } }, alwaysShowButtons: false });
    await page.goto('https://www.example-videos.com/photomodal', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.locator('[role="dialog"] img').click();
    await page.waitForTimeout(800);
    const ok = await page.evaluate(() => window.__mclosed === true);
    await page.goto('https://www.example-videos.com/photomodal?noclose=1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.locator('[role="dialog"] img').click();
    await page.waitForTimeout(1200);
    const err = await page.evaluate(() => document.querySelector('smd-toast')?.dataset.history || '');
    await setSettings({ siteSettings: {} });
    await page.goto('https://www.example-videos.com/photomodal', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.locator('[role="dialog"] img').click();
    await page.waitForTimeout(800);
    const offKept = await page.evaluate(() => window.__mclosed !== true);
    record('[모든 사이트] 사진 확대 창: 사진 누르면 닫힘 / 끈 사이트는 그대로', ok && offKept, { note: JSON.stringify({ 닫힘: ok, 끔: offKept }) });
    record('[모든 사이트] (오류 경로) 확대 창이 안 닫히면 단계·원인·조치', /단계: 사진 확대 창 닫기/.test(err) && /조치:/.test(err), { note: err.slice(0, 160) });
  } catch (err) {
    record('[모든 사이트] 사진 확대 창 닫기', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {} });
    await page.close();
  }
}

// ── X 사진 확대 보기: 사진을 누르면 닫힘 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: { x: { xPhotoTapClose: true } } });
    await page.goto('https://x.com/tester/status/1790000000000000003/photo/1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const ib = await page.locator('[role="dialog"] img').boundingBox();
    await page.mouse.click(ib.x + ib.width * 0.3, ib.y + ib.height * 0.3);
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => window.__closed === true);
    record('[X] 사진 확대 보기에서 사진 클릭 → 닫힘', closed, { note: closed ? '닫기 버튼이 눌림' : '닫히지 않음' });
  } catch (err) {
    record('[X] 사진 확대 보기 닫기', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── X 가 사진 탭으로 스스로 닫을 때 뒤로가기가 두 번 되지 않음 ──
{
  const page = await ctx.newPage();
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.goto('https://x.com/tester/status/1790000000000000005', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.click('#open');
    await page.waitForTimeout(500);
    const ib = await page.locator('#lb img').boundingBox();
    await page.mouse.click(ib.x + ib.width * 0.3, ib.y + ib.height * 0.3);
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => ({ path: location.pathname, open: !!document.getElementById('lb'), self: window.__xSelfClose || 0 }));
    record('[X] 사진 확대 창 탭 → 한 번만 닫히고 게시물에 머묾(이전 페이지로 안 감)', st.path === '/tester/status/1790000000000000005' && !st.open, { note: JSON.stringify(st) });
  } catch (err) {
    record('[X] 확대 창 탭 닫기(이중 뒤로가기)', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── X 사진 확대 보기에서 저장 버튼 → 창이 닫히지 않고 저장됨 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false });
    await clearDownloaded();
    await page.goto('https://x.com/tester/status/1790000000000000003/photo/1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const ib = await page.locator('[role="dialog"] img').boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.waitForTimeout(500);
    const before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn.show').first().click();
    const saved = await waitFile(before, 30000);
    const st = await page.evaluate(() => ({ closed: window.__closed === true, bg: window.__bgClosed === true, dialog: !!document.querySelector('[role="dialog"] img') }));
    record('[X] 사진 확대 보기에서 저장 버튼 → 창 안 닫히고 사진 저장', !!saved && !st.closed && !st.bg && st.dialog, { note: `${saved ? path.basename(saved) : '저장 안 됨'} · 확대 창 ${st.dialog && !st.closed && !st.bg ? '유지' : '닫힘'}` });
  } catch (err) {
    record('[X] 확대 보기 사진 저장', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 누르는 순간 사이트가 플레이어를 다시 그려도 한 번 클릭에 다운로드 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false });
    await clearDownloaded();
    await page.goto('https://www.example-videos.com/rerender', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn.show').first().click();
    const saved = await waitFile(before, 30000);
    const re = await page.evaluate(() => window.__rerendered || 0);
    record('[다운로드] 누르는 순간 사이트가 플레이어를 다시 그려도 한 번 클릭에 다운로드', !!saved, { note: `${saved ? path.basename(saved) : '저장 안 됨'} · 사이트 다시 그림 ${re}회` });
  } catch (err) {
    record('[다운로드] 한 번 클릭', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 사이트가 누르는 순간 멈춘 뒤, 재생 단추 한 번에 다시 재생(상태 어긋남으로 두 번 눌러야 하던 문제) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ noClickPause: true });
    await page.goto('https://x.com/xtoggle', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const area = await page.locator('#ta').boundingBox();
    await page.mouse.click(area.x + 40, area.y + 40); // 영상 화면 누름 → 사이트가 누르는 순간 멈춤
    await page.waitForTimeout(600);
    const mid = await page.evaluate(() => document.getElementById('tv').paused);
    const pb = await page.locator('#tbtn').boundingBox();
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2); // 재생 단추 한 번
    await page.waitForTimeout(700);
    const end = await page.evaluate(() => ({ paused: document.getElementById('tv').paused, toggles: window.__toggles || 0 }));
    record('[X] 영상 누른 뒤 재생 단추 한 번에 다시 재생(두 번 안 눌러도 됨)', mid === true && end.paused === false && end.toggles === 1, { note: `누른 뒤 멈춤 ${mid} · 재생 단추 후 ${JSON.stringify(end)}` });
  } catch (err) {
    record('[X] 재생 단추 한 번', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── X 재생 단추를 한 번 누르면 바로 재생(영상 눌러도 정지 안 되게 기능과 충돌 없음) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ noClickPause: true });
    await page.goto('https://x.com/xplay', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const b = await page.locator('#pb').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({ started: window.__started || 0, paused: document.getElementById('pv').paused, muted: document.getElementById('pv').muted }));
    record('[X] 재생 단추 한 번 누르면 바로 재생(두 번 안 눌러도 됨)', st.started === 1 && !st.paused && !st.muted, { note: JSON.stringify(st) });
  } catch (err) {
    record('[X] 재생 단추', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 블루스카이: 사진 아래 차단 버튼 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, postActions: true, alwaysShowButtons: true, autoFollow: false });
    await page.goto('https://bsky.app/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const feedBtns = await page.evaluate(() => document.querySelectorAll('smd-bfollow').length);
    const l = log.length;
    const c = await clickAct(page, '#pic', 'b');
    await page.waitForTimeout(1500);
    const r = log.slice(l).find((x) => x.bskyFollow === 'create');
    const t = await toastHist(page);
    record('[블루스카이] 사진 아래 차단 → 차단 기록(app.bsky.graph.block) + 알림, 피드 팔로우 버튼 없음', c === 'ok' && r?.collection === 'app.bsky.graph.block' && /carol/.test(r.subject || '') && r.auth && /차단: @carol\.test 완료/.test(t) && feedBtns === 0, { note: JSON.stringify({ c, feedBtns, r, t: t.slice(-80) }) });
  } catch (err) {
    record('[블루스카이] 차단', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ alwaysShowButtons: false, autoFollow: true });
    await page.close();
  }
}

// ── 다운로드 누르면 작성자 자동 팔로우 ──
{
  // 그 사진의 버튼만 누른다(사진 바로 위 부모에 붙은 smd-anchor)
  const clickSave = async (page, sel) => {
    await page.locator(sel).hover();
    await page.waitForTimeout(500);
    await page.locator(sel).locator('xpath=..').locator('smd-anchor .btn.show').first().click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1500);
  };
  const toast = (page) => page.evaluate(() => {
    const h = document.querySelector('smd-toast');
    return h && h.style.display !== 'none' ? h.shadowRoot.querySelector('.t').textContent : '';
  });
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false, autoFollow: true });
    let l = log.length;
    await page.goto('https://x.com/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickSave(page, '#pic');
    const xr = log.slice(l).find((e) => e.follow === 'create');
    const xt = await toast(page);
    record('[자동 팔로우] X: 결과를 화면 아래에 알림', /자동 팔로우: @auto_user 팔로우했습니다/.test(xt), { note: xt || '알림 없음' });
    record('[자동 팔로우] X: 사진 다운로드 누르면 X ⋯ 메뉴로 작성자 팔로우(X 보안 값 포함 요청)', xr?.screen_name === 'auto_user' && xr.ok && xr.tx === 'PAGE-TX', { note: JSON.stringify(xr || '요청 없음') });

    l = log.length;
    await page.goto('https://bsky.app/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await clickSave(page, '#apic');
    const already = log.slice(l).filter((e) => e.bskyFollow);
    const at = await toast(page);
    record('[자동 팔로우] 블루스카이: 이미 팔로우 중이면 그렇다고 알림', /이미 팔로우 중/.test(at), { note: at || '알림 없음' });
    record('[자동 팔로우] 블루스카이: 이미 팔로우 중이면 아무 요청도 안 함', already.length === 0, { note: already.length ? JSON.stringify(already) : '요청 없음' });
    l = log.length;
    await clickSave(page, '#pic');
    const br = log.slice(l).find((e) => e.bskyFollow === 'create');
    record('[자동 팔로우] 블루스카이: 다운로드 누르면 작성자 팔로우', br?.subject === 'did:plc:carol' && br.repo === 'did:plc:me', { note: JSON.stringify(br || '요청 없음') });
    // 블루스카이 사진 크게 보기 창(게시물 밖): 방금 누른 게시물 작성자를 팔로우
    l = log.length;
    await page.goto('https://bsky.app/feedphoto', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.locator('#ep').click();
    await page.waitForTimeout(400);
    await page.locator('#lbimg').hover();
    await page.waitForTimeout(500);
    await page.locator('smd-anchor .btn.show').last().click();
    await page.waitForTimeout(2000);
    const lb = log.slice(l).find((e) => e.bskyFollow === 'create');
    const lt = await toast(page);
    record('[자동 팔로우] 블루스카이: 사진 크게 보기 창에서 받아도 그 게시물 작성자 팔로우', lb?.subject === 'did:plc:erin' && /@erin\.test 팔로우했습니다/.test(lt), { note: `${JSON.stringify(lb || '요청 없음')} · ${lt}` });
    // 오류 경로: 어느 게시물에도 속하지 않은 사진 → 작성자 찾기 실패를 단계·원인·조치로 알림
    await page.goto('https://bsky.app/feedphoto', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.locator('#lone').hover();
    await page.waitForTimeout(500);
    await page.locator('smd-anchor .btn.show').last().click();
    await page.waitForTimeout(1500);
    const et = await toast(page);
    record('[자동 팔로우] (오류 경로) 작성자를 못 찾으면 단계·원인·조치 알림', /자동 팔로우 실패/.test(et) && /단계: 작성자 찾기/.test(et) && /조치:/.test(et), { note: et || '알림 없음' });

    await page.goto('https://www.example-videos.com/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickSave(page, '#pic');
    await clickSave(page, '#pic2');
    const g = await page.evaluate(() => ({ followed: window.__followed || 0, unfollowed: !!window.__unfollowed, label: document.getElementById('fb').textContent }));
    record('[자동 팔로우] 일반 사이트: 가까운 팔로우 버튼만 누름(이미 팔로잉은 그대로)', g.followed === 1 && !g.unfollowed && g.label === '팔로잉', { note: JSON.stringify(g) });

    // 유튜브 보기 화면: 플레이어와 떨어진 구독 단추를 누름 / 이미 구독 중이면 안 누름
    {
      await page.goto('https://www.youtube.com/watch?v=YTwatch0001', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.locator('smd-anchor .btn.show').first().click();
      await page.waitForTimeout(1500);
      const sub = await page.evaluate(() => ({ n: window.__subscribed || 0, label: document.getElementById('subbtn').textContent }));
      await page.goto('https://www.youtube.com/watch?v=YTsubbed001', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.locator('smd-anchor .btn.show').first().click();
      await page.waitForTimeout(1500);
      const sub2 = await page.evaluate(() => window.__subscribed || 0);
      record('[자동 팔로우] 유튜브: 다운로드 누르면 떨어진 구독 단추도 눌러 구독(이미 구독 중이면 안 누름)', sub.n === 1 && sub.label === '구독중' && sub2 === 0, { note: `구독 ${sub.n}회(${sub.label}) · 이미 구독 중 페이지 ${sub2}회` });
    }

    // 유튜브: 재생목록에 다른 채널 링크가 있어도 지금 영상 채널(@realowner)을 작성자로
    {
      await page.goto('https://www.youtube.com/watch?v=YTplist0001', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.locator('smd-anchor .btn.show').first().click();
      await page.waitForTimeout(2500);
      const t = await page.evaluate(() => document.querySelector('smd-toast')?.dataset.history || '');
      record('[자동 팔로우] 유튜브 재생목록 화면: 재생목록의 다른 채널 말고 지금 영상 채널을 팔로우 대상으로', /@realowner/.test(t) && !/newstudio_mini/.test(t), { note: t.slice(0, 160) });
    }

    // 유튜브: 화면에 구독 단추가 없으면 유튜브 구독 요청으로(로그인 없으면 단계·원인·조치)
    {
      const reqs = () => log.filter((x) => /resolve_url|subscription/.test(x.path || ''));
      const n0 = reqs().length;
      await page.goto('https://www.youtube.com/watch?v=YTnosub0001', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.locator('smd-anchor .btn.show').first().click();
      await page.waitForTimeout(2500);
      const errToast = await page.evaluate(() => document.querySelector('smd-toast')?.dataset.history || '');
      await ctx.addCookies([{ name: 'SAPISID', value: 'testsapisid', domain: '.youtube.com', path: '/', secure: true }]);
      await page.goto('https://www.youtube.com/watch?v=YTnosub0001', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.locator('smd-anchor .btn.show').first().click();
      await page.waitForTimeout(2500);
      const okToast = await page.evaluate(() => document.querySelector('smd-toast')?.dataset.history || '');
      const sent = reqs().slice(n0);
      await ctx.clearCookies({ name: 'SAPISID' });
      record('[자동 팔로우] (오류 경로) 유튜브 구독 단추 없음 + 로그인 없음 → 로그인 확인 안내', /단계: 로그인 확인/.test(errToast) && /조치:/.test(errToast), { note: errToast.slice(0, 160) });
      record('[자동 팔로우] 유튜브: 구독 단추가 없으면 @아이디로 채널을 찾아 구독 요청', sent.some((x) => /resolve_url/.test(x.path) && /@Jackson-xxz$/.test(x.url) && x.auth) && sent.some((x) => /subscribe/.test(x.path) && x.channelIds?.[0] === 'UCabcdefghijklmnopqrstuv' && x.auth) && /@Jackson-xxz 팔로우했습니다/.test(okToast), { note: `${JSON.stringify(sent)} · ${okToast.slice(-80)}` });
    }

    // 첫 클릭에 바로 다운로드(팔로우 버튼이 로그인 창을 띄워도)
    {
      page.once('dialog', (d) => d.dismiss());
      await clearDownloaded();
      const before = new Set(listFiles(DL));
      await page.goto('https://www.example-videos.com/afollow-nav', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.locator('#pic').hover();
      await page.waitForTimeout(500);
      await page.locator('#pic').locator('xpath=..').locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 20000);
      const fc = await page.evaluate(() => !!window.__followClicked);
      record('[자동 팔로우] 한 번 누르면 바로 다운로드 + 그다음 팔로우(사이트가 로그인 창을 띄워도)', !!saved && fc, { note: `${saved ? path.basename(saved) : '저장 안 됨'} · 팔로우 버튼 ${fc ? '눌림' : '안 눌림'}` });
    }

    await setSettings({ autoFollow: false });
    l = log.length;
    await page.goto('https://x.com/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickSave(page, '#pic');
    const off = log.slice(l).find((e) => e.follow === 'create');
    record('[자동 팔로우] 설정 끄면 팔로우 안 함', !off, { note: off ? '요청됨' : '요청 없음' });
  } catch (err) {
    record('[자동 팔로우]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ autoFollow: true });
    await page.close();
  }
}

// ── 블루스카이 사진·스레드 영상 제목: 고정된 탭 제목('ㅎㅊㅁㅃ')을 쓰지 않는다 ──
{
  const shoot = async (page, sel) => {
    const el = page.locator(sel);
    await el.scrollIntoViewIfNeeded();
    await el.hover();
    await page.waitForTimeout(500);
    const before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn.show').last().click();
    const saved = await waitFile(before, 30000);
    return saved ? path.basename(saved) : '';
  };
  const cases = [
    ['피드 사진 = 작성자 이름 - 본문', async (page) => shoot(page, '#ep'), (n) => /에린 - 바다 사진이에요/.test(n) && !/@erin/.test(n)],
    ['크게 보기 창 사진 = 방금 누른 게시물 제목', async (page) => {
      await page.locator('#ep').click();
      await page.waitForTimeout(400);
      return shoot(page, '#lbimg');
    }, (n) => /에린 - 바다 사진이에요/.test(n)],
    ['(오류 경로) 게시물 밖 사진 = 블루스카이 사진', async (page) => shoot(page, '#lone'), (n) => /블루스카이 사진/.test(n)],
  ];
  for (const [label, act, check] of cases) {
    const page = await ctx.newPage();
    try {
      await setSettings({ captionOnMedia: false, preventDuplicates: false });
      await page.goto('https://bsky.app/feedphoto', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const name = await act(page);
      record(`[블루스카이] ${label}`, !!name && check(name) && !/ㅎㅊㅁㅃ/.test(name), { note: name || '저장 안 됨' });
    } catch (err) {
      record(`[블루스카이] ${label}`, false, { note: err.message.split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  const page = await ctx.newPage();
  try {
    await page.goto('https://bsky.app/profile/fran.test/post/3kthreadpost', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn.show').first().click();
    const saved = await waitFile(before, 60000);
    const name = saved ? path.basename(saved) : '';
    record('[블루스카이] 게시물 상세 화면 영상 = 작성자 이름 - 본문', /프랜 - 강아지 산책 영상/.test(name) && !/ㅎㅊㅁㅃ/.test(name), { note: name || '저장 안 됨' });
  } catch (err) {
    record('[블루스카이] 게시물 상세 영상 제목', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 블루스카이 제목: 누른 게시물의 작성자 이름·본문(탭 제목이 처음 것으로 남아 있어도) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false });
    await clearDownloaded();
    await page.goto('https://bsky.app/feedvideo', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn.show').first().click();
    const saved = await waitFile(before, 60000);
    const name = saved ? path.basename(saved) : '';
    record('[블루스카이] 파일 제목 = 작성자 이름 - 본문(고정된 탭 제목 안 씀)', /다나 - 고양이랑 놀았어요/.test(name) && !/ㅎㅊㅁㅃ/.test(name), { note: name || '저장 안 됨' });
  } catch (err) {
    record('[블루스카이] 제목', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 나라 구분: 원문 언어로(한국어 화면의 일본어 게시물 → 일본) ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false, countryFolders: true, flagPrefix: true, flagStyle: 'name' });
    await clearDownloaded();
    await page.goto('https://www.example-videos.com/jpfeed', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.locator('#pic').hover();
    await page.waitForTimeout(500);
    const before = new Set(listFiles(DL));
    await page.locator('article smd-anchor .btn.show').first().click();
    const saved = await waitFile(before, 30000);
    const folder = saved ? path.basename(path.dirname(saved)) : '';
    const name = saved ? path.basename(saved) : '';
    record('[나라 구분] 한국어 화면이어도 원문이 일본어면 [일본] 표시(사진은 한 폴더 "사진")', folder === '사진' && /^\[일본\]/.test(name), { note: saved ? `${folder}/${name}` : '저장 안 됨' });
  } catch (err) {
    record('[나라 구분]', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 사이트별 가장 위 폴더 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false, siteFolders: true, sortFolders: true, countryFolders: true });
    await clearDownloaded();
    const got = {};
    for (const [key, url] of [['유튜브', 'https://www.youtube.com/watch?v=YTwatch0001'], ['example-videos.com', 'https://www.example-videos.com/rerender']]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 60000);
      got[key] = saved ? path.relative(DL, saved).split(path.sep).slice(0, -1).join('/') : '저장 안 됨';
    }
    record('[폴더] 가장 위에 사이트별 폴더 → 그 안에 종류 → 나라', got['유튜브'] === '유튜브/영상 1분30초 이하/한국' && got['example-videos.com'] === 'example-videos.com/영상 1분30초 이하/한국', { note: JSON.stringify(got) });
  } catch (err) {
    record('[폴더] 사이트별', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteFolders: false });
    await page.close();
  }
}

// ── 사이트마다 따로 폴더(지원 사이트 탭 스위치): 같은 이름이면 합쳐지고, 끈 사이트는 기본 다운로드 폴더 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false, siteFolders: false, sortFolders: true, countryFolders: true, siteFolderMap: { youtube: '유튜브', x: 'SNS', bluesky: 'SNS' } });
    await clearDownloaded();
    const got = {};
    for (const [key, url] of [['유튜브', 'https://www.youtube.com/watch?v=YTwatch0001'], ['X', 'https://x.com/tester/status/1790000000000000001'], ['일반', 'https://www.example-videos.com/rerender']]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 60000);
      got[key] = saved ? path.relative(DL, saved).split(path.sep).slice(0, -1).join('/') : '저장 안 됨';
    }
    record('[폴더] 사이트마다 따로 폴더: 유튜브=유튜브, X·블루스카이=SNS(합침), 끈 사이트=기본 폴더', got['유튜브'] === '유튜브/영상 1분30초 이하/한국' && /^SNS\/영상 1분30초 (이하|초과)\//.test(got.X) && got['일반'] === '영상 1분30초 이하/한국', { note: JSON.stringify(got) });
    // 팝업 '지원 사이트': 내 폴더 만들기 → 사이트마다 드롭다운으로 고르기(같은 폴더끼리 묶임) → 새 폴더 바로 만들기 → 폴더 지우기
    const pp = await extPage();
    await pp.setViewportSize({ width: 392, height: 760 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html`);
    await pp.click('.tab[data-tab="sites"]');
    await pp.waitForTimeout(300);
    const st = () => pp.evaluate(async () => {
      const s = (await chrome.storage.local.get('settings')).settings;
      return { map: s.siteFolderMap || {}, list: s.folderList || [] };
    });
    // 오류 경로: 빈 이름
    await pp.fill('#mfName', '  / : ');
    await pp.click('#mfAdd');
    await pp.waitForTimeout(300);
    const errMsg = await pp.textContent('#mfMsg');
    await pp.fill('#mfName', 'SNS');
    await pp.click('#mfAdd');
    await pp.waitForTimeout(400);
    const pick = async (site, value) => {
      await pp.locator('#siteList > li', { hasText: site }).locator('.sfsel').selectOption(value);
      await pp.waitForTimeout(400);
    };
    await pick('틱톡', 'SNS');
    await pick('인스타그램', 'SNS');
    const s1 = await st();
    // 드롭다운에서 새 폴더 바로 만들기
    await pick('핀터레스트', '__new');
    const li = pp.locator('#siteList > li', { hasText: '핀터레스트' });
    await li.locator('.sfin').fill('사진모음');
    await li.locator('.sfmk').click();
    await pp.waitForTimeout(400);
    const s2 = await st();
    await pp.screenshot({ path: path.join(SHOTS, 'popup-site-folders.png'), fullPage: true });
    // 폴더 지우기 → 그 폴더를 고른 사이트는 기본으로
    await pp.locator('.mf-chip', { hasText: '사진모음' }).locator('button').click();
    await pp.waitForTimeout(400);
    await pick('틱톡', '');
    const s3 = await st();
    await pp.close();
    record('[폴더] 지원 사이트 드롭다운: 내 폴더 만들기·고르기(틱톡·인스타=SNS 묶음)·새 폴더 바로 만들기·지우기', s1.map.tiktok === 'SNS' && s1.map.instagram === 'SNS' && s2.map.pinterest === '사진모음' && s2.list.includes('사진모음') && !('pinterest' in s3.map) && !s3.list.includes('사진모음') && !('tiktok' in s3.map) && s3.map.instagram === 'SNS', { note: JSON.stringify({ 묶음: s1.map, 새폴더: s2.map.pinterest, 지운뒤: s3 }) });
    record('[폴더] (오류 경로) 빈·쓸 수 없는 폴더 이름이면 단계·원인·조치', /실패/.test(errMsg) && /단계:/.test(errMsg) && /조치:/.test(errMsg), { note: errMsg });
  } catch (err) {
    record('[폴더] 사이트마다 따로 폴더', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteFolderMap: {}, folderList: [] });
    await page.close();
  }
}

// ── 최상위 폴더 '다운로드': 모든 파일이 다운로드/(사이트 폴더)/(종류)/(나라) 안에 ──
{
  const page = await ctx.newPage();
  try {
    // 예전 버전 사용자(최상위 폴더 비어 있음) → 업데이트 후 '다운로드' 로 한 번 바뀜
    await setSettings({ subfolder: '', subfolderV: 1, captionOnMedia: false, siteFolders: false, sortFolders: true, countryFolders: true, siteFolderMap: { youtube: '유튜브' } });
    const pp = await extPage();
    await pp.waitForTimeout(500);
    const top = await pp.evaluate(async () => (await chrome.storage.local.get('settings')).settings.subfolder);
    await pp.close();
    await clearDownloaded();
    const got = {};
    for (const [key, url] of [['유튜브', 'https://www.youtube.com/watch?v=YTwatch0001'], ['일반', 'https://www.example-videos.com/rerender']]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 60000);
      got[key] = saved ? path.relative(DL, saved).split(path.sep).slice(0, -1).join('/') : '저장 안 됨';
    }
    // 사진: 사이트·나라로 나누지 않고 다운로드/사진 한 곳(끄면 예전처럼 나눔)
    const photoDir = async () => {
      await page.goto('https://www.example-videos.com/photos', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const before = new Set(listFiles(DL));
      await page.locator('img.photo').first().hover();
      await page.waitForTimeout(500);
      await page.locator('img.photo').first().locator('xpath=..').locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 60000);
      return saved ? path.relative(DL, saved).split(path.sep).slice(0, -1).join('/') : '저장 안 됨';
    };
    await setSettings({ siteFolderMap: { generic: '일반' } });
    got['사진'] = await photoDir();
    await setSettings({ photosOneFolder: false });
    got['사진(끔)'] = await photoDir();
    await setSettings({ photosOneFolder: true });
    record("[폴더] 사진은 한 폴더(다운로드/사진) — 사이트 폴더·나라로 안 나눔, 끄면 예전처럼", got['사진'] === '다운로드/사진' && /^다운로드\/일반\/사진\//.test(got['사진(끔)']), { note: JSON.stringify({ 사진: got['사진'], 끔: got['사진(끔)'] }) });
    record("[폴더] 최상위 폴더 '다운로드'(업데이트 시 자동): 다운로드/유튜브/…, 다운로드/영상 1분30초 이하/…", top === '다운로드' && got['유튜브'] === '다운로드/유튜브/영상 1분30초 이하/한국' && got['일반'] === '다운로드/영상 1분30초 이하/한국', { note: JSON.stringify({ 최상위: top, ...got }) });
  } catch (err) {
    record('[폴더] 최상위 폴더', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ subfolder: '', subfolderV: 2, siteFolderMap: {} });
    await page.close();
  }
}

// ── 같은 파일 중복 다운로드 막기 ──
{
  const page = await ctx.newPage();
  const panelText = () => page.evaluate(() => [...document.querySelectorAll('smd-anchor')].map((a) => a.shadowRoot.querySelector('.panel')?.textContent || '').join(' '));
  try {
    await setSettings({ captionOnMedia: false, preventDuplicates: true });
    await clearDownloaded();
    await page.goto('https://www.example-videos.com/dupvideo', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const btn = () => page.locator('smd-anchor .btn.show').first();
    let before = new Set(listFiles(DL));
    await btn().click();
    const first = await waitFile(before, 30000);
    await page.waitForTimeout(3500);
    // 두 번째: 막혀야 함
    before = new Set(listFiles(DL));
    await btn().click();
    await page.waitForTimeout(3000);
    const second = listFiles(DL).filter((f) => !before.has(f) && !/\.crdownload$/.test(f));
    const p2 = await panelText();
    record('[중복 막기] 같은 영상 다시 누르면 받지 않고 "이미 받은 파일" + 위치 안내', !!first && second.length === 0 && /이미 받은 파일/.test(p2) && /다시 받기/.test(p2), { note: `처음 ${first ? path.basename(first) : '없음'} · 두 번째 새 파일 ${second.length}개 · 안내: ${p2.slice(0, 80)}` });
    // 다시 받기
    before = new Set(listFiles(DL));
    await page.locator('smd-anchor .panel button[data-a="force"]').first().click();
    const forced = await waitFile(before, 30000);
    record('[중복 막기] "다시 받기" 누르면 또 받음', !!forced, { note: forced ? path.basename(forced) : '저장 안 됨' });
    await page.waitForTimeout(3500);
    // 받은 파일을 모두 지우면 다시 받음
    for (const f of [first, forced]) if (f) fs.unlinkSync(f);
    await page.waitForTimeout(500);
    // 웨일(크롬)은 파일이 지워졌는지 묻는 순간 확인을 시작하고 결과가 늦게 올 수 있다 → 사용자가 몇 번 다시 누르는 상황으로 확인
    let again = null;
    let tries = 0;
    while (!again && tries < 3) {
      tries++;
      before = new Set(listFiles(DL));
      await btn().click();
      again = await waitFile(before, 8000);
      if (!again) await page.waitForTimeout(3000);
    }
    record('[중복 막기] 받은 파일을 지웠으면 그냥 다시 받음', !!again, { note: again ? `${path.basename(again)} (${tries}번째 누름)` : `저장 안 됨 · 안내: ${(await panelText()).slice(0, 80)}` });
  } catch (err) {
    record('[중복 막기]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ preventDuplicates: false });
    await page.close();
  }
}

// ── 폴더에 새 버전 파일이 받아지면 팝업에 [업데이트] 단추 ──
{
  const mf = path.join(EXT, 'manifest.json');
  const orig = fs.readFileSync(mf, 'utf8');
  try {
    const p0 = await extPage();
    const before = await p0.evaluate(() => !document.getElementById('updateBar').hidden);
    await p0.close();
    fs.writeFileSync(mf, orig.replace(/"version": "[^"]+"/, '"version": "99.0.0"'));
    const p1 = await extPage();
    await p1.waitForTimeout(500);
    const bar = await p1.evaluate(() => ({ shown: !document.getElementById('updateBar').hidden, ver: document.getElementById('newVer').textContent }));
    await p1.close();
    record('[업데이트] 폴더에 새 버전이 있으면 팝업에 [업데이트] 단추(같은 버전이면 안 보임)', !before && bar.shown && bar.ver === 'v99.0.0', { note: `평소 ${before ? '보임' : '안 보임'} · 새 버전 ${JSON.stringify(bar)}` });
  } catch (err) {
    record('[업데이트] 단추', false, { note: err.message.split('\n')[0] });
  } finally {
    fs.writeFileSync(mf, orig);
  }
}

// ── 화면 밖 영상 정지: 재생 중 스크롤로 화면에서 벗어나면 멈춤 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ pauseOffscreen: true });
    await page.goto('https://www.example-videos.com/scrollpause', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const st = () => page.evaluate(() => ({ v1: !document.getElementById('v1').paused, bg: !document.getElementById('bgv').paused }));
    const s0 = await st();
    await page.evaluate(() => scrollTo(0, 3000));
    await page.waitForTimeout(800);
    const s1 = await st();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(800);
    const s2 = await st();
    record('[화면 밖 정지] 스크롤로 벗어나면 멈춤, 다시 보여도 저절로 재생 안 함', s0.v1 && !s1.v1 && !s2.v1, { note: JSON.stringify({ 처음: s0.v1, 벗어난후: s1.v1, 돌아온후: s2.v1 }) });
    record('[화면 밖 정지] (예외 경로) 처음부터 숨은 영상(음악·광고용)은 건드리지 않음', s0.bg && s1.bg, { note: JSON.stringify({ 숨은영상재생중: s1.bg }) });
    // 설정을 끄면 화면에서 벗어나도 계속 재생
    await setSettings({ pauseOffscreen: false });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('v1').play());
    await page.waitForTimeout(500);
    await page.evaluate(() => scrollTo(0, 3000));
    await page.waitForTimeout(800);
    const s3 = await st();
    record('[화면 밖 정지] 설정 끄면 벗어나도 계속 재생', s3.v1, { note: `벗어난 뒤 재생 중=${s3.v1}` });
  } catch (err) {
    record('[화면 밖 정지]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ pauseOffscreen: true });
    await page.close();
  }
}

// ── 팝업 최근 다운로드: 대기 중인 작업이 많아도 전부 표시 ──
{
  const pp = await extPage();
  try {
    await pp.setViewportSize({ width: 392, height: 600 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html`);
    const now = Date.now();
    const mk = (i, state, phase) => ({ id: `t${state}${phase}${i}`, title: `${phase || state} 작업 ${i}`, site: 'generic', state, phase, created: now - 100000 + i, percent: null });
    const saved = await pp.evaluate(async () => (await chrome.storage.session.get('jobs')).jobs || []);
    const fake = [...Array.from({ length: 3 }, (_, i) => mk(i, 'running', 'download')), ...Array.from({ length: 42 }, (_, i) => mk(i, 'running', 'queue')), ...Array.from({ length: 30 }, (_, i) => mk(i, 'done', ''))];
    await pp.evaluate(async (jobs) => chrome.storage.session.set({ jobs }), fake);
    await pp.waitForTimeout(600);
    const r = await pp.evaluate(() => ({
      items: document.querySelectorAll('#jobList > li').length,
      queued: [...document.querySelectorAll('#jobList > li')].filter((li) => /대기 중/.test(li.textContent)).length,
      sum: document.getElementById('jobSummary').textContent,
      cancel: getComputedStyle(document.getElementById('cancelQueued')).display !== 'none' ? document.getElementById('cancelQueued').textContent : '',
      firstQueued: [...document.querySelectorAll('#jobList > li')].find((li) => /대기 중/.test(li.textContent))?.textContent.replace(/\s+/g, ' ') || '',
    }));
    await pp.screenshot({ path: path.join(SHOTS, 'popup-queue.png') });
    record('[팝업] 대기 중 작업이 많아도 전부 표시(받는 중 3 + 대기 42 + 끝난 것 최근 25)', r.items === 70 && r.queued === 42 && r.sum === '받는 중 3개 · 대기 중 42개' && /대기 42개 모두 취소/.test(r.cancel) && /1번째/.test(r.firstQueued), { note: JSON.stringify(r) });
    // 대기·받는 중이 없으면 개수 줄과 '모두 취소' 버튼을 숨김
    await pp.evaluate(async (jobs) => chrome.storage.session.set({ jobs }), fake.filter((j) => j.state === 'done'));
    await pp.waitForTimeout(500);
    const hidden = await pp.evaluate(() => getComputedStyle(document.getElementById('jobSummary')).display === 'none' && getComputedStyle(document.getElementById('cancelQueued')).display === 'none');
    record('[팝업] 대기 없으면 개수 줄·모두 취소 숨김', hidden, { note: hidden ? '숨김' : '보임' });
    await pp.evaluate(async (jobs) => chrome.storage.session.set({ jobs }), saved);
  } catch (err) {
    record('[팝업] 대기 목록', false, { note: err.message.split('\n')[0] });
  } finally {
    await pp.close();
  }
}

// ── 설정 기억: 확장 ID 고정 + 동기화 저장소 백업 ──
{
  try {
    await setSettings({ xWideLayout: false, aiLabel: false });
    await new Promise((r) => setTimeout(r, 800));
    const b = await sw.evaluate(async () => (await chrome.storage.sync.get('settingsBackup')).settingsBackup || null);
    record('[설정 기억] 확장 ID 고정 + 켜고 끈 설정이 동기화 저장소에 자동 백업', extId === 'epjgkfpjaemapmbokgmojcbbadknhnbd' && b?.xWideLayout === false && b?.aiLabel === false, { note: `ID ${extId} · 백업 ${b ? `xWideLayout=${b.xWideLayout}, aiLabel=${b.aiLabel}` : '없음'}` });
  } catch (err) {
    record('[설정 기억]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ xWideLayout: true, aiLabel: true });
  }
}

// ── X·블루스카이 자동재생 끄기 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: { x: { noAutoplay: true } } });
    await page.goto('https://x.com/autoplaytest', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const a = await page.evaluate(() => ({ paused: document.getElementById('av').paused, err: window.__apErr || '' }));
    await page.locator('#cover').click();
    await page.waitForTimeout(800);
    const b = await page.evaluate(() => !document.getElementById('av').paused);
    record('[자동재생 끄기] X: 사이트 자동재생은 막고(재생 버튼 표시용 오류), 직접 누르면 재생', a.paused && a.err === 'NotAllowedError' && b, { note: JSON.stringify({ 자동재생후멈춤: a.paused, 오류: a.err, 직접누른뒤재생: b }) });
    await setSettings({ siteSettings: { x: { noAutoplay: false } } });
    await page.goto('https://x.com/autoplaytest', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const c = await page.evaluate(() => !document.getElementById('av').paused);
    record('[자동재생 끄기] 설정 끄면 사이트 자동재생 그대로', c, { note: `자동재생됨=${c}` });
  } catch (err) {
    record('[자동재생 끄기]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ noAutoplay: false, siteSettings: {} });
    await page.close();
  }
}

// ── 팝업 '이 사이트': 지금 사이트 기능만 보이고, 바꾸면 그 사이트에만 적용 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ siteSettings: {}, noAutoplay: false });
    await page.goto('https://bsky.app/feedvideo', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const pp = await extPage();
    const tabId = await pp.evaluate(async () => (await chrome.tabs.query({ url: 'https://bsky.app/*' }))[0]?.id);
    await pp.setViewportSize({ width: 392, height: 700 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    await pp.click('.tab[data-tab="site"]');
    await pp.waitForTimeout(800);
    const info = await pp.evaluate(() => ({ title: document.getElementById('spTitle').textContent, items: [...document.querySelectorAll('#spList .row-toggle b')].map((b) => b.textContent) }));
    await pp.screenshot({ path: path.join(SHOTS, 'popup-site-bluesky.png'), fullPage: true });
    const hasBsky = !info.items.some((t) => /피드 게시물 팔로우 버튼/.test(t)); // 피드 팔로우 버튼은 없앰
    const hasX = info.items.some((t) => /피드 작성자 옆/.test(t));
    const hasYt = info.items.some((t) => /쇼츠/.test(t));
    const shared = ['팔로우 · 차단 · 좋아요', '영상 재생바', '사진 확대 보기에서 누르면 닫기', '영상 화면 크기'].every((k) => info.items.some((t) => t.includes(k)));
    record('[팝업] 이 사이트: 블루스카이에서 열면 공용 기능 + 블루스카이 기능(X·유튜브 데이터 전용 기능 없음)', /블루스카이 기능/.test(info.title) && hasBsky && shared && !hasX && !hasYt, { note: `${info.title} · ${info.items.length}개 · 공용 ${shared}` });
    await pp.locator('#spList .row-toggle', { hasText: '자동재생 끄기' }).click();
    await pp.waitForTimeout(500);
    const st = await pp.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    const mark = await pp.locator('#spList .row-toggle', { hasText: '자동재생 끄기' }).locator('em.mine').count();
    record('[팝업] 이 사이트에서 바꾸면 그 사이트에만 적용(전체 기본값·다른 사이트 그대로)', st.siteSettings?.bluesky?.noAutoplay === true && st.noAutoplay === false && !st.siteSettings?.x && mark === 1, { note: JSON.stringify({ 블루스카이: st.siteSettings?.bluesky, 전체: st.noAutoplay, X: st.siteSettings?.x ?? '(없음)', 표시: mark }) });
    // 실제로 그 사이트 페이지에 적용되는지(블루스카이에는 켜짐, X 에는 꺼짐)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const bOn = await page.evaluate(() => document.documentElement.dataset.smdNoautoplay);
    const xp = await ctx.newPage();
    await xp.goto('https://x.com/autoplaytest', { waitUntil: 'domcontentloaded' });
    await xp.waitForTimeout(1200);
    const xOn = await xp.evaluate(() => document.documentElement.dataset.smdNoautoplay);
    await xp.close();
    record('[팝업] 사이트별 설정이 그 사이트 페이지에만 적용', bOn === '1' && xOn === '0', { note: JSON.stringify({ 블루스카이: bOn, X: xOn }) });
    await pp.click('.tab[data-tab="sites"]');
    await pp.locator('#siteList > li', { hasText: '유튜브' }).locator('.sfeat').click();
    await pp.waitForTimeout(400);
    const yt = await pp.evaluate(() => ({ title: document.getElementById('spTitle').textContent, on: document.querySelector('.pane[data-pane="site"]').classList.contains('on'), shorts: [...document.querySelectorAll('#spList .row-toggle b')].some((b) => /쇼츠/.test(b.textContent)) }));
    record('[팝업] 지원 사이트에서 사이트를 누르면 그 사이트 기능 화면', yt.on && /유튜브/.test(yt.title) && yt.shorts, { note: JSON.stringify(yt) });
    await pp.locator('#spSelect').selectOption('bluesky');
    await pp.click('#spReset');
    await pp.waitForTimeout(400);
    const st2 = await pp.evaluate(async () => (await chrome.storage.local.get('settings')).settings.siteSettings || {});
    record('[팝업] 이 사이트 기본값으로 되돌리기', !st2.bluesky, { note: JSON.stringify(st2) });
    await pp.close();
  } catch (err) {
    record('[팝업] 이 사이트', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ siteSettings: {} });
    await page.close();
  }
}

// ── X 재생 버튼 → 팟플레이어로 재생 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ potPlayer: true, noAutoplay: true });
    const ep = await extPage();
    await ep.evaluate(() => chrome.storage.session.remove('lastExternalPlay'));
    await page.goto('https://x.com/tester/status/1790000000000000001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    // X 플레이어처럼 영상을 누르면 play()
    await page.evaluate(() => document.querySelector('video').addEventListener('click', (e) => e.currentTarget.play().catch(() => {})));
    await page.locator('video').first().click({ position: { x: 40, y: 40 } });
    await page.waitForTimeout(3000);
    const r = await ep.evaluate(async () => (await chrome.storage.session.get('lastExternalPlay')).lastExternalPlay || null);
    const paused = await page.evaluate(() => document.querySelector('video')?.paused ?? true).catch(() => true);
    record('[팟플레이어] X: 재생 버튼 누르면 브라우저 재생 대신 원본 주소를 팟플레이어로 넘김', !!r && /^https:\/\//.test(r.url) && paused, { note: `${r ? r.url : '넘기지 않음'} · 브라우저 재생 멈춤=${paused}` });
    // 오류 경로: 게시물 정보가 없는 영상 → 단계·원인·조치 알림
    const p2 = await ctx.newPage();
    await p2.goto('https://x.com/autoplaytest', { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(1500);
    await p2.locator('#cover').click();
    await p2.waitForTimeout(2500);
    const t = await p2.evaluate(() => document.querySelector('smd-toast')?.shadowRoot.querySelector('.t')?.textContent || '');
    record('[팟플레이어] (오류 경로) 원본을 못 찾으면 단계·원인·조치 알림', /단계: 영상 정보 찾기/.test(t) && /조치:/.test(t), { note: t || '알림 없음' });
    await p2.close();
    await ep.close();
  } catch (err) {
    record('[팟플레이어]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ potPlayer: false, noAutoplay: false });
    await page.close().catch(() => {});
  }
}

// ── 팟플레이어: 틱톡처럼 로그인 쿠키·Referer 가 필요한 영상은 먼저 받아서 연다 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ potPlayer: true, captionOnMedia: true });
    const ep = await extPage();
    await ep.evaluate(() => chrome.storage.session.remove('lastExternalPlay'));
    await page.goto('https://www.tiktok.com/@creator/video/7300000000000000001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.querySelector('video').addEventListener('click', (e) => e.currentTarget.play().catch(() => {})));
    const before = new Set(listFiles(DL));
    await page.locator('video').first().click({ position: { x: 40, y: 40 }, force: true });
    await page.waitForTimeout(1200);
    const t1 = await page.evaluate(() => document.querySelector('smd-toast')?.shadowRoot.querySelector('.t')?.textContent || '');
    const saved = await waitFile(before, 60000);
    await page.waitForTimeout(1500);
    const t2 = await page.evaluate(() => document.querySelector('smd-toast')?.shadowRoot.querySelector('.t')?.textContent || '');
    const last = await ep.evaluate(async () => (await chrome.storage.session.get('lastExternalPlay')).lastExternalPlay || null);
    const rel = saved ? path.relative(DL, saved) : '';
    const hist = await page.evaluate(() => JSON.parse(document.querySelector('smd-toast')?.dataset.history || '[]').join(' | '));
    record('[팟플레이어] 틱톡(쿠키 필요): 주소를 넘기지 않고 원본을 먼저 받아 재생용 폴더에 저장 후 안내', !last && /팟플레이어 재생[\\/]tiktok-7300000000000000001\.m4v$/.test(rel) && /먼저 받는 중/.test(hist) && /(팟플레이어로 열었습니다|팟플레이어용 파일을 받았습니다)/.test(t2), { note: `${rel || '저장 안 됨'} · 처음: ${t1.split('\n')[0]} · 끝: ${t2.split('\n')[0]}` });
    await ep.close();
  } catch (err) {
    record('[팟플레이어] 틱톡 먼저 받기', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ potPlayer: false, captionOnMedia: false });
    await page.close();
  }
}

// ── 블루스카이: localStorage 토큰이 만료돼 있어도 앱이 쓰는 최신 토큰으로 팔로우 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ autoFollow: true, captionOnMedia: false });
    const l = log.length;
    await page.goto('https://bsky.app/staleauth', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.locator('#sp').hover();
    await page.waitForTimeout(500);
    await page.locator('smd-anchor .btn.show').last().click();
    await page.waitForTimeout(2500);
    const cr = log.slice(l).find((e) => e.bskyFollow === 'create');
    const t = await page.evaluate(() => document.querySelector('smd-toast')?.shadowRoot.querySelector('.t')?.textContent || '');
    record('[블루스카이] 저장된 토큰이 만료돼도 앱의 최신 토큰으로 자동 팔로우', cr?.subject === 'did:plc:stale2' && cr.auth && /팔로우했습니다/.test(t), { note: `${JSON.stringify(cr || '요청 없음')} · ${t}` });
  } catch (err) {
    record('[블루스카이] 최신 토큰', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 팔로우 목록 전부 팔로우 (블루스카이·X) ──
{
  const page = await ctx.newPage();
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    d.accept();
  });
  const msg = () => page.evaluate(() => document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg')?.textContent || '');
  const go = () => page.evaluate(() => document.querySelector('smd-followall').shadowRoot.querySelector('.go').click());
  try {
    await setSettings({ followAllButton: true });
    // 블루스카이: 2쪽짜리 목록 → 이미 팔로우·내 계정·차단은 빼고 b1·b2·b3 만
    let l = log.length;
    await page.goto('https://bsky.app/profile/spacestar.test/follows', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /완료/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 30000 });
    const subs = log.slice(l).filter((e) => e.bskyFollow === 'create').map((e) => e.subject);
    record('[전부 팔로우] 블루스카이: 목록 전체(여러 쪽)에서 안 한 계정만 팔로우', subs.join(',') === 'did:plc:b1,did:plc:b2,did:plc:b3', { note: `${subs.join(', ')} · ${await msg()}` });
    // 오류 경로: 로그인 만료 → 바로 멈추고 단계·원인·조치
    l = log.length;
    await page.goto('https://bsky.app/profile/errlist.test/follows', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /단계:/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 30000 });
    const subs2 = log.slice(l).filter((e) => e.bskyFollow === 'create').map((e) => e.subject);
    const m2 = await msg();
    record('[전부 팔로우] (오류 경로) 블루스카이 로그인 만료 시 멈추고 단계·원인·조치 안내', subs2.join(',') === 'did:plc:c1,did:plc:expired' && /단계/.test(m2) && /만료/.test(m2) && /새로고침/.test(m2), { note: `${subs2.join(', ')} · ${m2.replace(/\n/g, ' / ')}` });
    // 목록 화면이 아니면 버튼 없음
    await page.goto('https://bsky.app/feedvideo', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const none = await page.evaluate(() => !document.querySelector('smd-followall'));
    record('[전부 팔로우] 목록 화면이 아니면 버튼 안 띄움', none, { note: none ? '없음' : '떠 있음' });

    // X: 화면의 팔로우 버튼을 내려가며 하나씩(이미 팔로잉·추천 칸 제외), 비공개 계정 '요청됨'도 성공
    await page.goto('https://x.com/spacestar/following', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /완료/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 90000 });
    const xr = await page.evaluate(() => ({ clicks: window.__xClicks || [], suggest: !!window.__suggestClicked }));
    const xm = await msg();
    record('[전부 팔로우] X: 목록 아래로 내려가며 안 한 계정만 팔로우(추천 칸 제외)', xr.clicks.join(',') === 'user_a,user_b,locked_one,user_c,user_d' && !xr.suggest && /5명/.test(xm), { note: `${xr.clicks.join(', ')} · 추천 누름=${xr.suggest} · ${xm}` });
    // X 는 스크롤하면 같은 칸을 다른 계정에 다시 쓴다 → 다시 쓰인 칸의 새 계정도 이어서 팔로우
    await page.goto('https://x.com/recycler/following', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /완료|없습니다|단계:/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 90000 });
    const rc = await page.evaluate(() => window.__xClicks || []);
    const rm = await msg();
    record('[전부 팔로우] X: 스크롤로 다시 쓰인 칸(같은 버튼, 새 계정)도 이어서 팔로우', rc.join(',') === '1001,1002,2001,2002' && /4명/.test(rm), { note: `${rc.join(',')} · ${rm.replace(/\n/g, ' / ')}` });
    // 오류 경로: X 가 제한 알림을 띄우면 바로 멈춤
    await page.goto('https://x.com/limited/following', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /단계:/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 30000 });
    const lc = await page.evaluate(() => (window.__xClicks || []).length);
    const lm = await msg();
    record('[전부 팔로우] (오류 경로) X 제한 알림이 뜨면 바로 멈추고 원인·조치 안내', lc === 1 && /막았습니다/.test(lm) && /unable to follow/.test(lm) && /기다린/.test(lm), { note: `누른 수 ${lc} · ${lm.replace(/\n/g, ' / ')}` });
    record('[전부 팔로우] 누르면 확인 창 없이 바로 시작', dialogs === 0, { note: `확인 창 ${dialogs}번` });
    // 오류 경로: 오늘 한도(400명)를 다 쓰면 시작하지 않음
    const ep = await extPage();
    await ep.evaluate(() => chrome.storage.local.set({ followAllDay_x: { date: new Date().toISOString().slice(0, 10), count: 400 } }));
    await ep.close();
    await page.goto('https://x.com/spacestar/following', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForTimeout(800);
    const dm = await msg();
    const dc = await page.evaluate(() => (window.__xClicks || []).length);
    record('[전부 팔로우] (오류 경로) X 하루 한도 400명을 다 쓰면 시작 안 함', dc === 0 && /하루 한도/.test(dm) && /내일/.test(dm), { note: dm.replace(/\n/g, ' / ') });
    // 인스타그램 팔로워 목록 창: 창 안을 스크롤하며 '팔로우'·'맞팔로우하기'만(이미 팔로잉 제외)
    await page.goto('https://www.instagram.com/spacestar/followers/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /완료/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 90000 });
    const ig = await page.evaluate(() => window.__igClicks || []);
    record('[전부 팔로우] 인스타그램: 목록 창 안을 내려가며 안 한 계정만 팔로우', ig.join(',') === 'ig_a,ig_b,ig_c', { note: `${ig.join(', ')} · ${await msg()}` });
    // 틱톡: 팔로워 창을 열면 버튼이 뜨고, 창 안 Follow 를 모두 누름
    await page.goto('https://www.tiktok.com/@spacestar', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => !!document.querySelector('smd-followall'));
    await page.locator('#openFollowers').click();
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /완료/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 60000 });
    const tt = await page.evaluate(() => window.__ttClicks || []);
    record('[전부 팔로우] 틱톡: 팔로워 창이 열렸을 때만 버튼, 창 안 계정 모두 팔로우', !before && tt.join(',') === 'tt_a,tt_b', { note: `창 열기 전 버튼=${before} · ${tt.join(', ')} · ${await msg()}` });
    // 오류 경로: 틱톡 제한 알림 → 바로 멈춤
    await page.goto('https://www.tiktok.com/@limited', { waitUntil: 'domcontentloaded' });
    await page.locator('#openFollowers').click();
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    await go();
    await page.waitForFunction(() => /단계:/.test(document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg').textContent || ''), null, { timeout: 30000 });
    const tl = await page.evaluate(() => (window.__ttClicks || []).length);
    const tm = await msg();
    record('[전부 팔로우] (오류 경로) 틱톡 제한 알림이 뜨면 바로 멈추고 원인·조치 안내', tl === 1 && /틱톡에서 팔로우를 막았습니다/.test(tm) && !/tt_b/.test(tm) && /Try again later/.test(tm), { note: `누른 수 ${tl} · ${tm.replace(/\n/g, ' / ')}` });
  } catch (err) {
    record('[전부 팔로우]', false, { note: err.message.split('\n')[0] });
  } finally {
    const ep = await extPage();
    await ep.evaluate(() => chrome.storage.local.remove(['followAllDay_x', 'followAllDay_instagram', 'followAllDay_tiktok']));
    await ep.close();
    await page.close();
  }
}

// ── 유튜브: 같은 영상 요소로 다음 영상으로 넘어가도 이전 영상의 '받은 적 있음'·진행 표시가 남지 않음 ──
{
  const page = await ctx.newPage();
  // 유튜브처럼 페이지를 새로 열지 않고 주소·영상만 바꾼다(영상 요소는 그대로 다시 씀)
  const nav = (id) => page.evaluate((vid) => {
    history.pushState({}, '', `/shorts/${vid}`);
    const p = document.querySelector('.html5-video-player');
    p.getVideoData = () => ({ video_id: vid, title: `쇼츠 ${vid}`, author: '테스트 채널', isLive: false });
    p.getPlayerResponse = () => ({ videoDetails: { videoId: vid } });
    const v = document.querySelector('video');
    v.src = v.src.split('#')[0] + '#' + vid;
    dispatchEvent(new Event('yt-navigate-finish'));
  }, id);
  const label = async () => (await page.locator('smd-anchor .btn .txt').first().textContent()).trim();
  try {
    await setSettings({ captionOnMedia: false, preventDuplicates: false, downloadedMark: true });
    await clearDownloaded();
    await page.goto('https://www.youtube.com/shorts/YTshort0001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    let before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn').first().click({ force: true });
    const f1 = await waitFile(before, 60000);
    await page.waitForTimeout(3500);
    const a = await label();
    await nav('YTshort0002');
    await page.waitForTimeout(800);
    const b = await label();
    record('[유튜브] 다음 쇼츠로 넘기면 받은 적 있음 표시가 사라짐', !!f1 && a === '받은 적 있음' && b === '다운로드', { note: JSON.stringify({ 받은영상: a, 다음영상: b }) });
    // 받는 중에 다음 영상으로 넘김 → 버튼은 바로 새 영상용, 이전 영상 다운로드는 계속되어 저장
    before = new Set(listFiles(DL));
    await page.locator('smd-anchor .btn').first().click({ force: true });
    await page.waitForTimeout(400);
    await nav('YTshort0003');
    await page.waitForTimeout(800);
    const c = await label();
    const f2 = await waitFile(before, 60000);
    await page.waitForTimeout(1500);
    const c2 = await label();
    await nav('YTshort0002');
    await page.waitForTimeout(800);
    const d = await label();
    record('[유튜브] 받는 중 다음 영상으로 넘기면 버튼은 바로 새 영상용, 이전 영상은 계속 받아 저장', c === '다운로드' && c2 === '다운로드' && !!f2 && /YTshort0002/.test(f2) && d === '받은 적 있음', { note: JSON.stringify({ 넘긴직후: c, 저장후새영상: c2, 저장파일: f2 ? path.basename(f2) : '없음', 돌아가면: d }) });
  } catch (err) {
    record('[유튜브] 다음 영상 넘김 표시', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 유튜브 쇼츠 오른쪽 위 조회수·구독자 ──
{
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.youtube.com/shorts/YTshort0001', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /구독자/.test(document.querySelector('smd-ytstats')?.shadowRoot?.textContent || ''), null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const h = document.querySelector('smd-ytstats');
      const txt = (h.shadowRoot.querySelector('.b')?.textContent || '').trim();
      const b = h.shadowRoot.querySelector('.b').getBoundingClientRect();
      const p = document.querySelector('#shorts-player').getBoundingClientRect();
      return { text: txt, right: p.right - b.right, top: b.top - p.top };
    });
    await page.screenshot({ path: path.join(SHOTS, 'shorts-stats.png') });
    record('[유튜브] 쇼츠 오른쪽 위에 조회수·구독자 표시', /조회수 1,234,567회/.test(r.text) && /구독자 3\.4만명/.test(r.text) && r.right >= 0 && r.right < 40 && r.top >= 56 && r.top < 90, { note: `${r.text} · 오른쪽 여백 ${r.right.toFixed(0)}px · 위 여백 ${r.top.toFixed(0)}px` });
    await page.goto('https://www.youtube.com/shorts/YTshortErr1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /실패/.test(document.querySelector('smd-ytstats')?.shadowRoot?.textContent || ''), null, { timeout: 15000 });
    const e = await page.evaluate(() => document.querySelector('smd-ytstats').shadowRoot.textContent.replace(/\s+/g, ' ').trim());
    record('[유튜브] 쇼츠 통계 실패 시 원인·조치 안내', /HTTP 503/.test(e) && /새로고침/.test(e), { note: e });
    await setSettings({ ytShortsStats: false });
    await page.waitForTimeout(800);
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('smd-ytstats')).display === 'none');
    record('[유튜브] 쇼츠 통계 설정 끄면 숨김', hidden, { note: hidden ? '숨겨짐' : '여전히 보임' });
  } catch (err) {
    record('[유튜브] 쇼츠 통계', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ ytShortsStats: true });
    await page.close();
  }
}

// ── X: 사진 아래 차단(⋯ 메뉴로 실제 차단) + 자동 팔로우 ──
if (!only || only === 'x' || '팔로우'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await setSettings({ postActions: true });
    await page.goto('https://x.com/explore', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const feedBtns = await page.evaluate(() => document.querySelectorAll('smd-follow').length);
    // 자동 팔로우: 이미 팔로우 중인 사람의 사진을 받으면 팔로우 요청을 보내지 않음
    {
      const lf = log.length;
      await page.locator('#fpic').hover();
      await page.waitForTimeout(500);
      await page.locator('#t-followed_user smd-anchor .btn.show').first().click();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(1500);
      const req = log.slice(lf).filter((l) => l.follow);
      record('[자동 팔로우] X: 이미 팔로우 중이면 아무 요청도 안 함', req.length === 0, { note: req.length ? JSON.stringify(req) : '요청 없음' });
    }
    await page.locator('#fpic').hover();
    await page.waitForTimeout(500);
    const c = await clickAct(page, '#fpic', 'b');
    await page.waitForTimeout(1500);
    const blocked = await page.evaluate(() => window.__blocked || '');
    const t = await toastHist(page);
    record('[X] 사진 아래 차단 → ⋯ 메뉴 · 확인으로 실제 차단 + 알림, 피드 팔로우 버튼 없음', c === 'ok' && blocked === 'followed_user' && /차단: @followed_user 완료/.test(t) && feedBtns === 0, { note: JSON.stringify({ c, blocked, feedBtns, t: t.slice(-80) }) });
  } catch (err) {
    record('[X] 차단', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}
// ── 받은 적 있는 영상은 버튼이 초록 체크로 ──
if (!only || only === 'x' || '받은'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await clearDownloaded();
    await page.goto('https://www.example-videos.com/norange', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const cls = () => page.evaluate(() => document.querySelector('smd-anchor').shadowRoot.querySelector('.btn').className);
    const before = await cls();
    await page.locator('smd-anchor .btn.show').first().click();
    await page.locator('smd-anchor .btn.done').waitFor({ timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const after = await cls();
    await page.screenshot({ path: path.join(SHOTS, 'downloaded-mark.png') });
    record('[버튼] 받은 적 있는 영상은 새로고침 후에도 초록 체크', !/downloaded/.test(before) && /downloaded/.test(after), { note: `처음: ${before} → 다시 방문: ${after}` });
  } catch (err) {
    record('[버튼] 받은 적 있는 영상 표시', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── AI 영상 표시 ──
if (!only || only === 'ai') {
  for (const [label, url, expectAi] of [['화면 해시태그 #sora', 'https://www.example-videos.com/ai', true], ['틱톡 AIGC 라벨 데이터', 'https://www.tiktok.com/@creator/video/7300000000000000005', true], ['일반 영상(표시 없음)', 'https://www.example-videos.com/watch', false]]) {
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 30000);
      await page.waitForTimeout(300);
      const badge = await page.evaluate(() => [...document.querySelectorAll('smd-anchor')].some((h) => h.shadowRoot.querySelector('.aibadge.show')));
      if (expectAi && label.includes('해시태그')) await page.screenshot({ path: path.join(SHOTS, 'ai-badge.png') });
      const name = saved ? path.basename(saved) : '';
      const ok = expectAi ? badge && name.includes('[AI]') : !badge && !name.includes('[AI]');
      record(`[AI] ${label} → ${expectAi ? 'AI 영상 배지 + 파일 이름 [AI]' : '배지 없음'}`, ok, { note: `배지 ${badge ? '있음' : '없음'} · ${name}` });
    } catch (err) {
      record(`[AI] ${label}`, false, { note: err.message.split('\n')[0] });
    } finally {
      await page.close();
    }
  }
}

// ── 피드 내용 요약을 사진·영상 빈 공간에 넣기 ──
if (!only || only === 'caption' || '요약'.includes(only)) {
  await setSettings({ captionOnMedia: true, captionKeepOriginal: false });
  await clearDownloaded();
  const bandDiff = (a, b, w, h, y0, y1, ss = 0) => {
    // 두 영상/사진의 같은 띠 영역 평균 차이(0~255)
    const crop = `crop=${w}:${Math.round(h * (y1 - y0))}:0:${Math.round(h * y0)}`;
    const out = execFileSync('ffmpeg', ['-v', 'error', ...(ss ? ['-ss', String(ss)] : []), '-i', a, ...(ss ? ['-ss', String(ss)] : []), '-i', b, '-filter_complex', `[0:v]${crop},format=gray[x];[1:v]${crop},format=gray[y];[x][y]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, '-frames:v', '1', '-f', 'null', '-']).toString();
    return Number(/YAVG=([\d.]+)/.exec(out)?.[1] || 0);
  };
  // 사진
  {
    const page = await ctx.newPage();
    try {
      await page.goto('https://www.example-videos.com/photos', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const img = page.locator('img.photo').nth(1);
      const ib = await img.boundingBox();
      await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
      await page.waitForTimeout(400);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 30000);
      const orig = path.join(ROOT, 'tests/fixtures/media/images/photo.jpg');
      const top = bandDiff(orig, saved, 1600, 1000, 0.0, 0.08);
      const mid = bandDiff(orig, saved, 1600, 1000, 0.40, 0.60);
      const bottom = bandDiff(orig, saved, 1600, 1000, 0.76, 0.95);
      execFileSync('cp', [saved, path.join(SHOTS, 'caption-photo.jpg')]);
      record('[요약] 사진 왼쪽 위에 본문 글자, 가운데·아래는 그대로', top > 1 && mid < 0.5 && bottom < 0.5, { note: `${path.basename(saved)} · 차이 위 ${top.toFixed(1)} / 가운데 ${mid.toFixed(1)} / 아래 ${bottom.toFixed(1)}` });
    } catch (err) {
      record('[요약] 사진', false, { note: err.message.split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  // 영상 (+ 원본도 함께 저장) — 이 테스트용 Chromium 이 해독할 수 있는 VP9 영상
  {
    await setSettings({ captionKeepOriginal: true });
    const page = await ctx.newPage();
    try {
      await page.goto('https://www.example-videos.com/watch-vp9', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const t1 = Date.now();
      let added = [];
      while (Date.now() - t1 < 120000) {
        added = listFiles(DL).filter((f) => !before.has(f) && !/\.crdownload$/.test(f));
        if (added.length >= 2) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 800));
      const capped = added.find((f) => !/\(원본\)/.test(f));
      const original = added.find((f) => /\(원본\)/.test(f));
      const info = capped && probe(capped);
      let top = 0, mid = 0, bottom = 0;
      if (capped && original && info?.vcodec) {
        top = bandDiff(original, capped, 640, 360, 0.0, 0.08);
        mid = bandDiff(original, capped, 640, 360, 0.40, 0.60);
        bottom = bandDiff(original, capped, 640, 360, 0.76, 0.95);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', capped, '-frames:v', '1', path.join(SHOTS, 'caption-video.png')]);
      }
      const ok = !!info?.vcodec && info.width === 640 && info.height === 360 && !!info.acodec && info.duration > 5 && !!original && top > mid + 3 && Math.abs(bottom - mid) < 3;
      // 가운데·아래 차이는 다시 인코딩한 잡음 수준, 위쪽만 글자만큼 더 달라야 함
      record('[요약] 영상 왼쪽 위에 본문 글자(모든 프레임) + 원본도 함께 저장', ok, { note: `${capped ? path.basename(capped) : '없음'} (${info?.vcodec}+${info?.acodec}, ${info?.duration?.toFixed(1)}s) · 원본 ${original ? '있음' : '없음'} · 차이 위 ${top.toFixed(1)} / 가운데 ${mid.toFixed(1)} / 아래 ${bottom.toFixed(1)}` });
    } catch (err) {
      record('[요약] 영상', false, { note: err.message.split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  // 다시 인코딩할 수 없는 영상(이 Chromium 의 H.264) → 원본으로 저장 + 안내
  {
    await setSettings({ captionKeepOriginal: false });
    await clearDownloaded();
    const page = await ctx.newPage();
    try {
      await page.goto('https://www.example-videos.com/watch', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const saved = await waitFile(before, 60000);
      const info = saved && probe(saved);
      const pp = await extPage();
      const warn = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0]?.warning || '');
      await pp.close();
      record('[요약] 글자 넣기 실패 시 영상이 사라지지 않고 원본 저장 + 안내', info?.vcodec === 'h264' && !!info.acodec && /피드 내용을 넣지 못해 원본으로 저장/.test(warn), { note: `${saved ? path.basename(saved) : '없음'} · ${info?.vcodec} · 안내: ${warn.slice(0, 90)}` });
    } catch (err) {
      record('[요약] 실패 시 원본 저장', false, { note: err.message.split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  // MP4(H.264·AAC) 맞추기: 이미 맞는 영상은 그대로 / 인코더가 없으면 원본 저장 + 단계·원인·조치
  {
    await setSettings({ forceH264Aac: true, audioKbps: 192, captionOnMedia: false });
    await clearDownloaded();
    const one = async (url) => {
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const before = new Set(listFiles(DL));
        await page.locator('smd-anchor .btn.show').first().click();
        const saved = await waitFile(before, 90000);
        await new Promise((r) => setTimeout(r, 800));
        const pp = await extPage();
        const warn = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0]?.warning || '');
        await pp.close();
        return { saved, info: saved && probe(saved), warn };
      } finally {
        await page.close();
      }
    };
    try {
      const a = await one('https://www.example-videos.com/aac320');
      record('[H.264·AAC] 이미 MP4·H.264·고음질 AAC 면 변환 없이 그대로 저장', a.info?.vcodec === 'h264' && a.info?.acodec === 'aac' && !a.warn, { note: `${a.saved ? path.basename(a.saved) : '없음'} · ${a.info?.vcodec}/${a.info?.acodec} · 안내: ${a.warn || '없음'}` });
      await setSettings({ audioKbps: 320 });
      // 정상 경로: H.264 + Opus → 영상은 그대로, 소리는 WebAssembly AAC 인코더로 320kbps
      const o = await one('https://www.example-videos.com/opusmp4');
      const abr = o.saved ? Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,bit_rate', '-of', 'csv=p=0', o.saved]).toString().trim().split(',')[1] || 0) : 0;
      record('[H.264·AAC] Opus 소리 → AAC 320kbps 로 변환(영상 H.264 그대로), 안내 없음', o.info?.vcodec === 'h264' && o.info?.acodec === 'aac' && abr >= 280000 && /\.mp4$/.test(o.saved || '') && !o.warn, { note: `${o.saved ? path.basename(o.saved) : '없음'} · ${o.info?.vcodec}/${o.info?.acodec} ${Math.round(abr / 1000)}kbps · 안내: ${o.warn || '없음'}` });
      const b = await one('https://www.example-videos.com/watch');
      // 이 테스트용 Chromium 에는 AAC 인코더가 없다 → 오류 경로: 원본(H.264·AAC 128k) 저장 + 안내
      record('[H.264·AAC] (오류 경로) AAC 해독·인코딩을 못 하면 원본 저장 + 단계·원인·조치', b.info?.vcodec === 'h264' && /H\.264·AAC 로 바꾸지 못해/.test(b.warn) && /단계: (AAC 인코더 확인|원본 소리 읽기)/.test(b.warn) && /원인:/.test(b.warn) && /조치:/.test(b.warn), { note: `${b.saved ? path.basename(b.saved) : '없음'} · 안내: ${b.warn.slice(0, 160)}` });
    } catch (err) {
      record('[H.264·AAC] 저장 형식', false, { note: err.message.split('\n')[0] });
    } finally {
      await setSettings({ forceH264Aac: false, audioKbps: 320 });
    }
  }
  // ② 재인코딩 없이: 표지(피드 스크린샷) + 같은 이름 PNG, 영상 데이터는 그대로
  const grab = async (url, need, settle = 800) => {
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.bringToFront();
      const before = new Set(listFiles(DL));
      await page.locator('smd-anchor .btn.show').first().click();
      const t1 = Date.now();
      let added = [];
      while (Date.now() - t1 < 120000) {
        added = listFiles(DL).filter((f) => !before.has(f) && !/\.crdownload$/.test(f));
        if (added.length >= need) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, settle));
      const pp = await extPage();
      const warn = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0]?.warning || '');
      await pp.close();
      return { added, warn };
    } finally {
      await page.close();
    }
  };
  {
    await setSettings({ captionOnMedia: false, captionCover: true, captionIntro: false, captionKeepOriginal: false });
    await clearDownloaded();
    try {
      const { added, warn } = await grab('https://www.example-videos.com/watch-vp9', 2);
      const vid = added.find((f) => /\.mp4$/.test(f));
      const png = added.find((f) => /\.png$/.test(f));
      const streams = vid ? JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name:stream_disposition=attached_pic', '-of', 'json', vid]).toString()).streams : [];
      const cover = streams.find((x) => x.disposition?.attached_pic === 1);
      const main = streams.find((x) => x.codec_name === 'vp9' && x.disposition?.attached_pic !== 1);
      const info = vid && probe(vid);
      const sameName = vid && png && path.basename(vid).replace(/\.mp4$/, '') === path.basename(png).replace(/\.png$/, '');
      if (png) execFileSync('cp', [png, path.join(SHOTS, 'cover-shot.png')]);
      record('[피드②] 재인코딩 없이 표지에 피드 스크린샷 + 같은 이름 PNG', !!main && !!cover && !!sameName && !!info?.acodec && info.duration > 5 && !/카드/.test(warn), { note: `${vid ? path.basename(vid) : '없음'} · 표지 ${cover ? cover.codec_name : '없음'} · 영상 ${main?.codec_name || '?'}(복사) · PNG ${png ? '있음' : '없음'} · 안내: ${warn.slice(0, 60) || '없음'}` });
    } catch (err) {
      record('[피드②] 표지', false, { note: err.message.split('\n')[0] });
    }
  }
  // ③ 영상 시작에 피드 화면 3초
  {
    await setSettings({ captionOnMedia: false, captionCover: false, captionIntro: true, captionKeepOriginal: true });
    await clearDownloaded();
    try {
      const { added, warn } = await grab('https://www.example-videos.com/watch-vp9', 2);
      const vid = added.find((f) => !/\(원본\)/.test(f));
      const orig = added.find((f) => /\(원본\)/.test(f));
      const a = vid && probe(vid);
      const b = orig && probe(orig);
      const astart = vid ? Number(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'json', vid]).toString()).packets?.[0]?.pts_time) : NaN;
      if (vid) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.5', '-i', vid, '-frames:v', '1', path.join(SHOTS, 'intro-frame.png')]);
      const grow = a && b ? a.duration - b.duration : 0;
      record('[피드③] 영상 시작에 피드 화면 3초 + 소리 3초 뒤로', !!a?.vcodec && !!a.acodec && grow > 2.5 && grow < 3.6 && astart > 2.8 && astart < 3.3, { note: `${vid ? path.basename(vid) : '없음'} (${a?.vcodec}+${a?.acodec}) · 길이 +${grow.toFixed(2)}s · 소리 시작 ${astart}s · 안내: ${warn.slice(0, 60) || '없음'}` });
    } catch (err) {
      record('[피드③] 인트로', false, { note: err.message.split('\n')[0] });
    }
  }
  // ③ 실패 경로: 이 Chromium 이 해독 못 하는 H.264 → 원본 저장 + 안내
  {
    await setSettings({ captionIntro: true, captionKeepOriginal: false });
    await clearDownloaded();
    try {
      const { added, warn } = await grab('https://www.example-videos.com/watch', 1);
      const info = added[0] && probe(added[0]);
      record('[피드③] 인트로 실패 시 원본 저장 + 단계·원인 안내', info?.vcodec === 'h264' && /피드 화면 3초를 넣지 못해 원본으로 저장/.test(warn), { note: `${info?.vcodec} · 안내: ${warn.slice(0, 100)}` });
    } catch (err) {
      record('[피드③] 실패 경로', false, { note: err.message.split('\n')[0] });
    }
  }
  // 피드 본문(탭 제목 아님) + 첫 프레임이 검은 영상에서도 인물 없는 아래쪽에 글자
  {
    await setSettings({ captionOnMedia: true, captionCover: false, captionIntro: false, captionKeepOriginal: true });
    await clearDownloaded();
    try {
      const page = await ctx.newPage();
      let added = [];
      try {
        await page.goto('https://www.example-videos.com/feedpost', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const before = new Set(listFiles(DL));
        await page.locator('smd-anchor .btn.show').first().click();
        const t1 = Date.now();
        while (Date.now() - t1 < 120000) {
          added = listFiles(DL).filter((f) => !before.has(f) && !/\.crdownload$/.test(f));
          if (added.length >= 2) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        await new Promise((r) => setTimeout(r, 800));
      } finally {
        await page.close();
      }
      const pp = await extPage();
      const h = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0] || {});
      await pp.close();
      const capped = added.find((f) => !/\(원본\)/.test(f));
      const original = added.find((f) => /\(원본\)/.test(f));
      let top = 0, bottom = 0;
      if (capped && original) {
        top = bandDiff(original, capped, 640, 360, 0.03, 0.22, 3);
        bottom = bandDiff(original, capped, 640, 360, 0.76, 0.95, 3);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', capped, '-frames:v', '1', path.join(SHOTS, 'caption-person.png')]);
      }
      // 본문 부분(작성자 줄 '[작성자 …]' 앞)에는 탭 제목·작성자가 섞이지 않고, 작성자 줄은 '이름 (@아이디) · 사이트'
      const usedBody = String(h.captionUsed || '').replace(/ \[작성자 .*\]$/, '');
      const textOk = /한강에서 자전거/.test(usedBody) && !/하리니|\/ X/.test(usedBody);
      record('[요약①] 피드 본문 글자만 왼쪽 위에', /^\[피드 글\] 오늘 한강/.test(usedBody) && !/하리니/.test(usedBody) && !h.warning, { note: `${h.captionUsed} · 안내: ${h.warning || '없음'}` });
      record('[작성자 줄] 첫 줄에 작성자 이름 (@아이디) · 사이트', /\[작성자 하리니 \(@harin_test\) · \S/.test(h.captionUsed || ''), { note: h.captionUsed || '(없음)' });
      record('[요약] 탭 제목·아이디가 아니라 게시물 본문을 요약', textOk, { note: `넣은 글자: ${h.captionUsed || '(없음)'}` });
      record('[요약①] 캡처는 항상 화면 맨 위에 바짝(아래는 그대로)', top > 3 && bottom < top / 3, { note: `차이 위 ${top.toFixed(1)} / 아래 ${bottom.toFixed(1)}` });
    } catch (err) {
      record('[요약] 본문·위치', false, { note: err.message.split('\n')[0] });
    }
  }
  // 작성자(영상 위) + 본문(영상 아래)을 따로 잘라 이어 붙인 캡처
  {
    await setSettings({ captionOnMedia: true, captionCover: false, captionIntro: false, captionKeepOriginal: false });
    await clearDownloaded();
    try {
      const page = await ctx.newPage();
      let saved = null;
      try {
        await page.goto('https://www.example-videos.com/feedshot2', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const before = new Set(listFiles(DL));
        await page.locator('smd-anchor .btn.show').first().click();
        saved = await waitFile(before, 120000);
      } finally {
        await page.close();
      }
      const pp = await extPage();
      const h = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0] || {});
      await pp.close();
      if (saved) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', saved, '-frames:v', '1', path.join(SHOTS, 'caption-stacked.png')]);
      record('[요약①] 본문이 영상 아래에 있어도 본문 글자만', /^\[피드 글\]/.test(h.captionUsed || '') && !/민지/.test(String(h.captionUsed || '').replace(/ \[작성자 .*\]$/, '')) && /바다/.test(h.captionUsed || '') && !h.warning, { note: `${h.captionUsed || '(없음)'} · 안내: ${h.warning || '없음'}` });
    } catch (err) {
      record('[요약①] 위·아래 이어 붙인 캡처', false, { note: err.message.split('\n')[0] });
    }
  }
  // 한국어가 아닌 피드 글: 캡처 아래에 한국어 번역 / 번역 실패 시 원문 + 안내
  for (const [path_, expectOk] of [['/feedpost-en', true], ['/feedpost-fail', false]]) {
    await setSettings({ captionOnMedia: true, translateCaption: true, captionCover: false, captionIntro: false, captionKeepOriginal: false });
    await clearDownloaded();
    try {
      const page = await ctx.newPage();
      let saved = null;
      try {
        await page.goto(`https://www.example-videos.com${path_}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await page.locator('article img').hover();
        await page.waitForTimeout(500);
        const before = new Set(listFiles(DL));
        await page.locator('article smd-anchor .btn.show').first().click();
        saved = await waitFile(before, 30000);
      } finally {
        await page.close();
      }
      const pp = await extPage();
      const h = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0] || {});
      await pp.close();
      if (expectOk) {
        if (saved) execFileSync('cp', [saved, path.join(SHOTS, 'caption-translated.jpg')]);
        record('[번역] 한국어가 아닌 피드 글은 한국어 번역만(원문 없음)', /^\[피드 글\+번역\]/.test(h.captionUsed || '') && /해변/.test(h.captionUsed || '') && !/sunset/i.test(h.captionUsed || '') && !h.warning, { note: `${saved ? path.basename(saved) : '저장 안 됨'} · ${h.captionUsed || '(없음)'} · 안내: ${h.warning || '없음'}` });
      } else {
        record('[번역] 번역 실패 시 원문 글자 + 단계·원인·조치 안내', !!saved && /^\[피드 글\]/.test(h.captionUsed || '') && /번역 실패\(번역 단계\)/.test(h.warning || '') && /HTTP 500/.test(h.warning || ''), { note: `${h.captionUsed || '(없음)'} · 안내: ${h.warning || '없음'}` });
      }
    } catch (err) {
      record(`[번역] ${path_}`, false, { note: err.message.split('\n')[0] });
    }
  }
  // 피드 캡처: 화면에 보이는 게시물은 작성자 줄+본문을 여백 없이(해시태그 제외),
  // 고정 머리줄에 가려진 게시물은 스크롤하지 않고 작성자 이름+본문 카드를 그려 넣음
  for (const [label, offset, expectShot] of [['보이는 게시물', 150, true], ['고정 머리줄에 가려진 게시물', 30, false]]) {
    await setSettings({ captionOnMedia: true, translateCaption: true, captionCover: false, captionIntro: false, captionKeepOriginal: false });
    await clearDownloaded();
    try {
      const page = await ctx.newPage();
      let saved = null;
      let moved = 0;
      try {
        await page.goto('https://www.example-videos.com/stickyfeed', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        await page.evaluate((o) => scrollTo(0, document.getElementById('post').getBoundingClientRect().top + scrollY - o), offset);
        await page.waitForTimeout(300);
        const y0 = await page.evaluate(() => scrollY);
        await page.locator('#pic').hover();
        await page.waitForTimeout(500);
        const yh = await page.evaluate(() => scrollY);
        const before = new Set(listFiles(DL));
        await page.locator('#post smd-anchor .btn.show').first().click();
        await page.waitForTimeout(200);
        moved = (await page.evaluate(() => scrollY)) - yh;
        saved = await waitFile(before, 30000);
        if (yh !== y0) moved += 0; // hover 자체의 스크롤은 무시
      } finally {
        await page.close();
      }
      let red = -1, green = -1, pink = -1, w = 0, hh = 0;
      if (saved) {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', saved, '-vf', 'crop=iw:ih*0.15:0:0,scale=320:-1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        red = green = pink = 0;
        for (let i = 0; i < raw.length; i += 3) {
          const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
          if (r > 200 && g < 60 && b < 60) red++;
          if (g > 200 && r < 80 && b < 80) green++;
          if (r > 200 && g > 120 && g < 190 && b > 150) pink++;
        }
      }
      const pp = await extPage();
      const h = await pp.evaluate(async () => (await chrome.storage.local.get('history')).history?.[0] || {});
      await pp.close();
      if (saved) execFileSync('cp', [saved, path.join(SHOTS, `caption-${expectShot ? 'tight' : 'card'}.jpg`)]);
      // 화면 캡처 없이 본문 글자만(작성자·해시태그 없음), 페이지 스크롤 안 함
      const ok = /^\[피드 글\] 장어 덮밥 먹고 힘내요( \[작성자 [^\]]+\])?$/.test(h.captionUsed || '') && red < 20 && green < 5 && pink < 5;
      record(`[요약①] ${label}: 본문 글자만(작성자·해시태그 제외), 페이지 스크롤 안 함`, !!saved && ok && moved === 0, { note: `${h.captionUsed || '(없음)'} · 빨강 ${red} · 초록 ${green} · 프로필 ${pink} · 스크롤 변화 ${moved}` });
    } catch (err) {
      record(`[요약①] ${label}`, false, { note: err.message.split('\n')[0] });
    }
  }
  await setSettings({ captionCover: false, captionIntro: false });
  await setSettings({ captionOnMedia: false, captionKeepOriginal: false });
}


// ── 버튼 위치: 기본 오른쪽 가운데 + 직접 배치 후 저장 ──
if (!only || only === 'place' || '배치'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.tiktok.com/@creator/video/7300000000000000001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const geom = () => page.evaluate(() => {
      const v = document.querySelector('video');
      const b = v.parentElement.querySelector('smd-anchor').shadowRoot.querySelector('.btn');
      const vr = v.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return { fx: ((br.left + br.width / 2) - vr.left) / vr.width, fy: ((br.top + br.height / 2) - vr.top) / vr.height };
    });
    const g0 = await geom();
    const midRight = g0.fx > 0.6 && Math.abs(g0.fy - 0.5) < 0.05;
    record('[버튼] 기본 위치 = 영상 오른쪽 가운데', midRight, { note: `가로 ${(g0.fx * 100).toFixed(0)}% · 세로 ${(g0.fy * 100).toFixed(0)}%` });

    const tabId = await (async () => { const pp = await extPage(); const id = await pp.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.tiktok.com/*' }))[0]?.id); await pp.close(); return id; })();
    const pp = await extPage(`popup/popup.html?tabId=${tabId}`);
    await pp.click('.tab[data-tab="settings"]');
    await pp.click('#placeButton');
    await pp.close().catch(() => {});
    await page.locator('smd-toolbar').waitFor({ timeout: 5000 });
    const btn = page.locator('smd-anchor .btn').first();
    const bb = await btn.boundingBox();
    const vb = await page.locator('video').first().boundingBox();
    await page.screenshot({ path: path.join(SHOTS, 'place-mode.png') });
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(vb.x + vb.width * 0.5, vb.y + vb.height * 0.2, { steps: 8 });
    await page.mouse.up();
    await page.locator('smd-toolbar').evaluate((t) => t.shadowRoot.querySelector('[data-a="save"]').click());
    await page.waitForTimeout(300);
    const before = new Set(listFiles(DL));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const g1 = await geom();
    const moved = Math.abs(g1.fx - 0.5) < 0.06 && Math.abs(g1.fy - 0.2) < 0.06;
    await page.screenshot({ path: path.join(SHOTS, 'placed.png') });
    // 배치한 위치에서 실제 다운로드도 되는지
    await page.locator('smd-anchor .btn.show').first().click();
    const saved = await waitFile(before, 30000);
    record('[버튼] 직접 배치 → 저장 → 새로고침 후에도 그 위치 + 다운로드', moved && !!saved, { note: `가로 ${(g1.fx * 100).toFixed(0)}% · 세로 ${(g1.fy * 100).toFixed(0)}% · ${saved ? path.basename(saved) : '파일 없음'}` });
    await setSettings({ placements: {} });
  } catch (err) {
    record('[버튼] 직접 배치', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 버튼이 스크롤해도 영상에 붙어 있는지 ──
if (!only || only === 'scroll' || '스크롤'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.example-videos.com/feed', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const gaps = [];
    for (const y of [0, 300, 700, 1300]) {
      await page.mouse.wheel(0, y ? 400 : 0);
      await page.waitForTimeout(16); // 다음 프레임 직후 측정(지연 없이 붙어 있어야 함)
      const g = await page.evaluate(() => {
        const out = [];
        for (const v of document.querySelectorAll('video')) {
          const host = v.parentElement.querySelector('smd-anchor');
          const b = host?.shadowRoot?.querySelector('.btn.show');
          if (!b) continue;
          const vr = v.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          if (vr.bottom < 0 || vr.top > innerHeight) continue;
          out.push({ dx: Math.round(vr.right - br.right), dy: Math.round(vr.bottom - br.bottom), inside: br.top >= vr.top && br.bottom <= vr.bottom });
        }
        return out;
      });
      gaps.push(...g);
    }
    const stable = gaps.length > 0 && gaps.every((g) => g.inside && g.dx === gaps[0].dx && g.dy === gaps[0].dy);
    await page.screenshot({ path: path.join(SHOTS, 'scroll-feed.png') });
    record('[버튼] 스크롤해도 각 영상 하단에 붙어 이동', stable, { note: JSON.stringify(gaps.slice(0, 6)) });
  } catch (err) {
    record('[버튼] 스크롤해도 각 영상 하단에 붙어 이동', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 팝업: 현재 탭 영상 목록에서 다운로드 ──
if (!only || '팝업'.includes(only) || only === 'popup') {
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto('https://x.com/tester/status/1790000000000000001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const pp = await extPage();
    const tabId = await pp.evaluate(async () => (await chrome.tabs.query({ url: 'https://x.com/*' }))[0]?.id);
    await pp.setViewportSize({ width: 392, height: 600 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    await pp.locator('.vitem .btn').first().waitFor({ timeout: 10000 });
    await pp.screenshot({ path: path.join(SHOTS, 'popup-current-tab.png') });
    const before = new Set(listFiles(DL));
    await pp.locator('.vitem .btn').first().click();
    const saved = await waitFile(before);
    await pp.waitForTimeout(800);
    await pp.screenshot({ path: path.join(SHOTS, 'popup-after-download.png') });
    const info = saved && probe(saved);
    const listText = (await pp.locator('#jobList').innerText()).replace(/\s+/g, ' ');
    record('[팝업] 현재 탭 영상 목록 → 다운로드', !!info && info.height === 1920 && !!info.acodec && listText.includes('저장 완료'), { note: saved ? `${path.relative(DL, saved)} · ${info.width}x${info.height} · 최근 목록: ${listText.slice(0, 60)}` : '파일 없음', ms: Date.now() - t0 });
    await pp.close();
  } catch (err) {
    record('[팝업] 현재 탭 영상 목록 → 다운로드', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 팝업 화면 캡처 ──
{
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 392, height: 600 });
  await p.goto(`chrome-extension://${extId}/popup/popup.html`);
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(SHOTS, 'popup-home.png') });
  await p.click('.tab[data-tab="settings"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(SHOTS, 'popup-settings.png'), fullPage: true });
  await p.click('.tab[data-tab="sites"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(SHOTS, 'popup-sites.png') });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.click('.tab[data-tab="home"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(SHOTS, 'popup-home-dark.png') });
  await p.close();
}

// ── (맨 마지막) 확장 업데이트로 열린 페이지와 연결이 끊겼을 때: 전부 팔로우가 영어 오류 대신 새로고침 안내 ──
{
  const page = await ctx.newPage();
  try {
    await setSettings({ followAllButton: true });
    await page.goto('https://x.com/spacestar/following', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('smd-followall', { timeout: 8000 });
    const ep = await extPage();
    await ep.evaluate(() => setTimeout(() => chrome.runtime.reload(), 50)).catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.querySelector('smd-followall').shadowRoot.querySelector('.go').click()).catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => document.querySelector('smd-followall')?.shadowRoot.querySelector('.msg')?.textContent || '');
    const clicks = await page.evaluate(() => (window.__xClicks || []).length);
    record('[전부 팔로우] (오류 경로) 확장 업데이트 후 연결이 끊기면 새로고침 안내(영어 오류 없음)', /연결이 끊겼습니다/.test(m) && /새로고침\(F5\)/.test(m) && !/Extension context/i.test(m) && clicks === 0, { note: `${m.replace(/\n/g, ' / ')} · 누른 수 ${clicks}` });
  } catch (err) {
    record('[전부 팔로우] 연결 끊김 안내', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close().catch(() => {});
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n결과: ${passed}/${results.length} 통과`);
fs.writeFileSync(path.join(OUT, 'e2e-report.json'), JSON.stringify({ when: new Date().toISOString(), chromium: ctx.browser()?.version?.() || 'persistent', results, swLogs: swLogs.slice(-50) }, null, 2));
if (process.env.SHOW_SW_LOGS) console.log(swLogs.join('\n'));
await ctx.close();
server.close();
process.exit(passed === results.length ? 0 : 1);
