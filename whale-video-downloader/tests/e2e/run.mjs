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
await setSettings({ captionOnMedia: false, preventDuplicates: false }); // 같은 페이지를 여러 번 받는 시나리오가 많아 중복 막기는 전용 테스트에서만 켠다
for (const s of scenarios) await scenario(s);

// ── 저장 위치: 하위 폴더 설정 반영 ──
if (!only || only === 'folder') {
  await setSettings({ subfolder: '쇼츠 소스/2026' });
  await scenario({ name: '[저장 위치] 하위 폴더 설정 반영', url: 'https://www.example-videos.com/watch', expect: { width: 1920, height: 1080, audio: true, dir: '쇼츠 소스/2026/영상 1분30초 이하' } });
  await setSettings({ subfolder: '' });
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
      const ok = !!saved && saved.endsWith(`.${ext}`) && out.includes(`${w},${h}`) && path.basename(path.dirname(path.dirname(saved))) === '사진';
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

// ── X 사진 확대 보기: 사진을 누르면 닫힘 ──
{
  const page = await ctx.newPage();
  try {
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
    record('[다운로드] 누르는 순간 사이트가 플레이어를 다시 그려도 한 번 클릭에 다운로드', !!saved && re > 0, { note: `${saved ? path.basename(saved) : '저장 안 됨'} · 사이트 다시 그림 ${re}회` });
  } catch (err) {
    record('[다운로드] 한 번 클릭', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── 모든 사이트: 영상 눌러도 정지 안 되게 ──
{
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.example-videos.com/clicktoggle', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const playing = (id) => page.evaluate((i) => !document.getElementById(i).paused, id);
    const center = async (sel) => {
      const b = await page.locator(sel).boundingBox();
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    let [x, y] = await center('#o1');
    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
    const a1 = await playing('c1');
    [x, y] = await center('#o2');
    await page.mouse.click(x, y);
    await page.waitForTimeout(600);
    const a2 = await playing('c2');
    await page.locator('#like').click();
    const liked = await page.evaluate(() => !!window.__liked);
    // 멈춘 영상은 눌러서 재생할 수 있어야 함
    await page.evaluate(() => document.getElementById('c1').pause());
    [x, y] = await center('#o1');
    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
    const resume = await playing('c1');
    record('[모든 사이트] 영상 눌러도 정지 안 됨(클릭·누르는 순간 방식 모두), 버튼은 동작, 멈춘 영상은 눌러서 재생', a1 && a2 && liked && resume, { note: JSON.stringify({ 클릭방식: a1, 누름방식: a2, 버튼: liked, 멈춘영상재생: resume }) });
    await setSettings({ noClickPause: false });
    await page.waitForTimeout(300);
    [x, y] = await center('#o1');
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
    const off = await playing('c1');
    record('[모든 사이트] 설정 끄면 눌러서 정지 가능(원래대로)', !off, { note: `재생 중=${off}` });
  } catch (err) {
    record('[모든 사이트] 영상 눌러도 정지 안 됨', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ noClickPause: true });
    await page.close();
  }
}


// ── 블루스카이 팔로우 버튼 ──
{
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto('https://bsky.app/feedfollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="feedItem-by-"]')].map((el) => {
      const h = el.querySelector('smd-bfollow');
      const b = h?.shadowRoot.querySelector('button');
      const r = b?.getBoundingClientRect();
      const visible = !!r && r.width > 10 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === h;
      return [el.id.slice(2), b ? `${b.textContent}${visible ? '' : '(가려짐)'}` : '(없음)'];
    })));
    const s0 = await state();
    record('[블루스카이] 피드 팔로우 상태 표시 (팔로잉/팔로우/내 계정 제외)', s0.alice === '팔로잉' && s0.bob === '팔로우' && s0.me === '(없음)', { note: JSON.stringify(s0) });
    const l1 = log.length;
    await page.locator('#b-bob smd-bfollow button').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    const s1 = await state();
    const r1 = log.slice(l1).find((l) => l.bskyFollow === 'create');
    record('[블루스카이] 팔로우 누르기 → 팔로잉', s1.bob === '팔로잉' && r1?.subject === 'did:plc:bob' && r1.repo === 'did:plc:me' && r1.collection === 'app.bsky.graph.follow' && r1.auth, { note: `${s1.bob} · ${JSON.stringify(r1)}` });
    const l2 = log.length;
    await page.locator('#b-alice smd-bfollow button').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    const s2 = await state();
    const r2 = log.slice(l2).find((l) => l.bskyFollow === 'delete');
    record('[블루스카이] 팔로잉 누르기(확인) → 언팔로우', s2.alice === '팔로우' && r2?.rkey === '3kalice', { note: `${s2.alice} · ${JSON.stringify(r2)}` });
    await page.locator('#b-expired smd-bfollow button').click();
    await page.waitForTimeout(800);
    const err = await page.locator('#b-expired smd-bfollow').evaluate((h) => h.shadowRoot.querySelector('.err')?.textContent || '');
    record('[블루스카이] 로그인 만료 시 단계·원인·조치 안내', /팔로우 실패/.test(err) && /만료/.test(err) && /새로고침/.test(err), { note: err });
  } catch (err) {
    record('[블루스카이] 팔로우 버튼', false, { note: err.message.split('\n')[0] });
  } finally {
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
  const page = await ctx.newPage();
  try {
    await setSettings({ captionOnMedia: false, autoFollow: true });
    let l = log.length;
    await page.goto('https://x.com/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickSave(page, '#pic');
    const xr = log.slice(l).find((e) => e.follow === 'create');
    record('[자동 팔로우] X: 사진 다운로드 누르면 X ⋯ 메뉴로 작성자 팔로우(X 보안 값 포함 요청)', xr?.screen_name === 'auto_user' && xr.ok && xr.tx === 'PAGE-TX', { note: JSON.stringify(xr || '요청 없음') });

    l = log.length;
    await page.goto('https://bsky.app/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await clickSave(page, '#apic');
    const already = log.slice(l).filter((e) => e.bskyFollow);
    record('[자동 팔로우] 블루스카이: 이미 팔로우 중이면 아무 요청도 안 함', already.length === 0, { note: already.length ? JSON.stringify(already) : '요청 없음' });
    l = log.length;
    await clickSave(page, '#pic');
    const br = log.slice(l).find((e) => e.bskyFollow === 'create');
    record('[자동 팔로우] 블루스카이: 다운로드 누르면 작성자 팔로우', br?.subject === 'did:plc:carol' && br.repo === 'did:plc:me', { note: JSON.stringify(br || '요청 없음') });

    await page.goto('https://www.example-videos.com/afollow', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickSave(page, '#pic');
    await clickSave(page, '#pic2');
    const g = await page.evaluate(() => ({ followed: window.__followed || 0, unfollowed: !!window.__unfollowed, label: document.getElementById('fb').textContent }));
    record('[자동 팔로우] 일반 사이트: 가까운 팔로우 버튼만 누름(이미 팔로잉은 그대로)', g.followed === 1 && !g.unfollowed && g.label === '팔로잉', { note: JSON.stringify(g) });

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
    record('[나라 구분] 한국어 화면이어도 원문이 일본어면 일본 폴더 + [일본] 표시', folder === '일본' && /^\[일본\]/.test(name), { note: saved ? `${folder}/${name}` : '저장 안 됨' });
  } catch (err) {
    record('[나라 구분]', false, { note: err.message.split('\n')[0] });
  } finally {
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
    before = new Set(listFiles(DL));
    await btn().click();
    const again = await waitFile(before, 30000);
    record('[중복 막기] 받은 파일을 지웠으면 그냥 다시 받음', !!again, { note: again ? path.basename(again) : `저장 안 됨 · 안내: ${(await panelText()).slice(0, 80)}` });
  } catch (err) {
    record('[중복 막기]', false, { note: err.message.split('\n')[0] });
  } finally {
    await setSettings({ preventDuplicates: false });
    await page.close();
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

// ── X 팔로우 버튼 + 소리 자동 켜기 ──
if (!only || only === 'x' || '팔로우'.includes(only)) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto('https://x.com/explore', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    // 버튼이 실제로 화면에 보이는지(잘리거나 가려지지 않았는지)
    const vis = await page.evaluate(() => [...document.querySelectorAll('article')].filter((a) => a.id !== 't-me_account').map((a) => {
      const h = a.querySelector('smd-follow');
      const b = h?.shadowRoot.querySelector('button')?.getBoundingClientRect();
      if (!b || b.width < 10) return false;
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === h;
    }));
    record('[X] 팔로우 버튼이 잘리지 않고 화면에 보임', vis.length > 0 && vis.every(Boolean), { note: JSON.stringify(vis) });
    const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('article')].map((a) => [a.id.slice(2), a.querySelector('smd-follow')?.shadowRoot.querySelector('button')?.textContent || '(없음)'])));
    const s0 = await state();
    record('[X] 팔로우 상태 표시 (팔로잉/팔로우/React 데이터/내 계정 제외)', s0.followed_user === '팔로잉' && s0.new_user === '팔로우' && s0.react_user === '팔로잉' && s0.me_account === '(없음)', { note: JSON.stringify(s0) });
    await page.screenshot({ path: path.join(SHOTS, 'x-follow.png') });

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
    const logStart = log.length;
    await page.locator('#t-new_user smd-follow button').click();
    await page.mouse.move(5, 5); // 마우스가 버튼 위에 있으면 '언팔로우'로 보이므로 치운다
    await page.waitForTimeout(800);
    const s1 = await state();
    const req1 = log.slice(logStart).find((l) => l.follow === 'create');
    record('[X] 팔로우 누르기 → X ⋯ 메뉴로 실제 팔로우(보안 값 포함) → 팔로잉', s1.new_user === '팔로잉' && req1?.ok && req1.user_id === '2002' && req1.tx === 'PAGE-TX', { note: `${s1.new_user} · 요청 ${JSON.stringify(req1)}` });

    const logStart2 = log.length;
    await page.locator('#t-followed_user smd-follow button').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    const s2 = await state();
    const req2 = log.slice(logStart2).find((l) => l.follow === 'destroy');
    record('[X] 팔로잉 누르기(확인) → X 메뉴·확인 창으로 실제 언팔로우', s2.followed_user === '팔로우' && req2?.ok && req2.user_id === '1001' && req2.tx === 'PAGE-TX', { note: `${s2.followed_user} · 요청 ${JSON.stringify(req2)}` });

    // 쿠키가 없으면 단계·원인·해결 안내
    await page.evaluate(() => (document.cookie = 'ct0=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'));
    await page.locator('#t-react_user smd-follow button').click();
    await page.waitForTimeout(500);
    const err = await page.locator('#t-react_user smd-follow').evaluate((h) => h.shadowRoot.querySelector('.err')?.textContent || '');
    record('[X] 로그인 쿠키 없을 때 오류 안내', /로그인/.test(err) && /새로고침/.test(err), { note: err });

  } catch (err) {
    record('[X] 팔로우 버튼', false, { note: err.message.split('\n')[0] });
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
      const textOk = /한강에서 자전거/.test(h.captionUsed || '') && !/하리니|\/ X/.test(h.captionUsed || '');
      record('[요약①] 피드 본문 글자만 왼쪽 위에', /^\[피드 글\] 오늘 한강/.test(h.captionUsed || '') && !/하리니/.test(h.captionUsed || '') && !h.warning, { note: `${h.captionUsed} · 안내: ${h.warning || '없음'}` });
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
      record('[요약①] 본문이 영상 아래에 있어도 본문 글자만', /^\[피드 글\]/.test(h.captionUsed || '') && !/민지/.test(h.captionUsed || '') && /바다/.test(h.captionUsed || '') && !h.warning, { note: `${h.captionUsed || '(없음)'} · 안내: ${h.warning || '없음'}` });
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
      const ok = /^\[피드 글\] 장어 덮밥 먹고 힘내요$/.test(h.captionUsed || '') && red < 20 && green < 5 && pink < 5;
      record(`[요약①] ${label}: 본문 글자만(작성자·해시태그 제외), 페이지 스크롤 안 함`, !!saved && ok && moved === 0, { note: `${h.captionUsed || '(없음)'} · 빨강 ${red} · 초록 ${green} · 프로필 ${pink} · 스크롤 변화 ${moved}` });
    } catch (err) {
      record(`[요약①] ${label}`, false, { note: err.message.split('\n')[0] });
    }
  }
  await setSettings({ captionCover: false, captionIntro: false });
  await setSettings({ captionOnMedia: false, captionKeepOriginal: false });
}


// ── X 재생: 최고 화질 고정 · 재생바 항상 표시 · 진행 막대 두껍게 ──
if (!only || only === 'x') {
  const page = await ctx.newPage();
  try {
    await page.goto('https://x.com/hq', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const hq = await page.evaluate(() => ({ fetch: window.__fetchVariants, xhr: window.__xhrVariants, best: /1080x1920/.test(window.__fetchText || '') }));
    record('[X] 재생 화질 항상 최고(재생목록에 1080p 하나만)', hq.fetch === 1 && hq.xhr === 1 && hq.best, { note: JSON.stringify(hq) });

    await page.goto('https://x.com/controls', { waitUntil: 'domcontentloaded' });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(5000);
    const c = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('ctl'));
      const cr = document.getElementById('ctl').getBoundingClientRect();
      const el = document.elementFromPoint(cr.left + cr.width / 2, cr.top + 30);
      return { opacity: cs.opacity, visibility: cs.visibility, onTop: !!el && document.getElementById('ctl').contains(el), track: getComputedStyle(document.getElementById('track')).height, played: getComputedStyle(document.getElementById('played')).height, thumb: getComputedStyle(document.getElementById('thumb')).height };
    });
    await page.screenshot({ path: path.join(SHOTS, 'x-controls.png') });
    record('[X] 재생바 5초 뒤에도 계속 표시(사이트가 가짜 마우스 신호를 무시해도)', c.opacity === '1' && c.visibility === 'visible' && c.onTop, { note: JSON.stringify(c) });
    record('[X] 진행 막대 2px → 8px(슬라이더 바깥 막대 포함), 손잡이 12px → 18px', c.track === '8px' && c.played === '8px' && c.thumb === '18px', { note: JSON.stringify(c) });
  } catch (err) {
    record('[X] 재생 설정', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}

// ── X 넓은 화면: 오른쪽 사이드바 숨김 + 가운데 확대 ──
if (!only || only === 'x' || '넓은'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('https://x.com/layout', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const g = await page.evaluate(() => ({
      sidebar: getComputedStyle(document.querySelector('[data-testid="sidebarColumn"]')).display,
      center: Math.round(document.querySelector('[data-testid="primaryColumn"]').getBoundingClientRect().width),
      video: Math.round(document.querySelector('video').getBoundingClientRect().width),
      left: !!document.querySelector('header[role="banner"]').offsetWidth,
      leftArea: Math.round(document.querySelector('header[role="banner"]').getBoundingClientRect().width),
      post: Math.round(document.querySelector('article').getBoundingClientRect().width),
    }));
    await page.screenshot({ path: path.join(SHOTS, 'x-wide.png') });
    record('[X] 넓은 화면: 오른쪽 숨김 + 피드 게시물까지 확대(안쪽 600px 제한 해제), 왼쪽 메뉴는 메뉴 너비만', g.sidebar === 'none' && g.center > 1000 && g.post > 1000 && g.post <= g.center && g.video > 900 && g.left && g.leftArea < 320, { note: JSON.stringify(g) });
    await setSettings({ xWideLayout: false });
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="sidebarColumn"]')).display);
    record('[X] 넓은 화면 끄면 원래대로', off !== 'none', { note: `오른쪽 display=${off}` });
    await setSettings({ xWideLayout: true });
  } catch (err) {
    record('[X] 넓은 화면', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
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

const passed = results.filter((r) => r.ok).length;
console.log(`\n결과: ${passed}/${results.length} 통과`);
fs.writeFileSync(path.join(OUT, 'e2e-report.json'), JSON.stringify({ when: new Date().toISOString(), chromium: ctx.browser()?.version?.() || 'persistent', results, swLogs: swLogs.slice(-50) }, null, 2));
if (process.env.SHOW_SW_LOGS) console.log(swLogs.join('\n'));
await ctx.close();
server.close();
process.exit(passed === results.length ? 0 : 1);
