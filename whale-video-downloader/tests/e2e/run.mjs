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
    if (e.dir && !path.dirname(saved).endsWith(e.dir)) problems.push(`저장 폴더 ${path.dirname(saved)} (기대: …/${e.dir})`);
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
  { name: '일반 사이트(직접 mp4)', url: 'https://www.example-videos.com/watch', expect: { width: 1920, height: 1080, audio: true, dir: SUB, noSuccessPanel: true }, cdn: 'cdn.example-videos.com', shot: 'generic' },
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
      const ok = !!saved && saved.endsWith(`.${ext}`) && out.includes(`${w},${h}`) && path.basename(path.dirname(saved)) === '사진';
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

// ── X 팔로우 버튼 + 소리 자동 켜기 ──
if (!only || only === 'x' || '팔로우'.includes(only)) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto('https://x.com/explore', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('article')].map((a) => [a.id.slice(2), a.querySelector('smd-follow')?.shadowRoot.querySelector('button')?.textContent || '(없음)'])));
    const s0 = await state();
    record('[X] 팔로우 상태 표시 (팔로잉/팔로우/React 데이터/내 계정 제외)', s0.followed_user === '팔로잉' && s0.new_user === '팔로우' && s0.react_user === '팔로잉' && s0.me_account === '(없음)', { note: JSON.stringify(s0) });
    await page.screenshot({ path: path.join(SHOTS, 'x-follow.png') });

    const logStart = log.length;
    await page.locator('#t-new_user smd-follow button').click();
    await page.mouse.move(5, 5); // 마우스가 버튼 위에 있으면 '언팔로우'로 보이므로 치운다
    await page.waitForTimeout(800);
    const s1 = await state();
    const req1 = log.slice(logStart).find((l) => l.follow === 'create');
    record('[X] 팔로우 누르기 → 팔로잉으로 바뀜', s1.new_user === '팔로잉' && req1?.ok && req1.user_id === '2002' && req1.auth === 'Bearer PAGE-AUTH-TOKEN', { note: `${s1.new_user} · 요청 ${JSON.stringify(req1)}` });

    const logStart2 = log.length;
    await page.locator('#t-followed_user smd-follow button').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    const s2 = await state();
    const req2 = log.slice(logStart2).find((l) => l.follow === 'destroy');
    record('[X] 팔로잉 누르기(확인) → 언팔로우', s2.followed_user === '팔로우' && req2?.ok && req2.user_id === '1001', { note: `${s2.followed_user} · 요청 ${JSON.stringify(req2)}` });

    // 쿠키가 없으면 단계·원인·해결 안내
    await page.evaluate(() => (document.cookie = 'ct0=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'));
    await page.locator('#t-react_user smd-follow button').click();
    await page.waitForTimeout(500);
    const err = await page.locator('#t-react_user smd-follow').evaluate((h) => h.shadowRoot.querySelector('.err')?.textContent || '');
    record('[X] 로그인 쿠키 없을 때 오류 안내', /로그인/.test(err) && /새로고침/.test(err), { note: err });

    const sound = await page.evaluate(() => ({ muted: document.getElementById('xv').muted, clicked: !!window.__unmuteClicked, paused: document.getElementById('xv').paused }));
    record('[X] 영상 재생되면 소리 자동 켜기(X 음소거 버튼 사용)', !sound.muted && sound.clicked && !sound.paused, { note: JSON.stringify(sound) });
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

// ── 광고 차단 ──
if (!only || only === 'ad' || '광고'.includes(only)) {
  const page = await ctx.newPage();
  try {
    await page.goto('https://x.com/ads', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const vis = () => page.evaluate(() => Object.fromEntries(['normal', 'promoted', 'tracked'].map((id) => [id, getComputedStyle(document.getElementById(id)).display !== 'none'])));
    const v1 = await vis();
    const net1 = await page.evaluate(() => window.__adNet);
    record('[광고] X 피드 광고(프로모션·placementTracking) 숨김, 일반 게시물 유지', v1.normal && !v1.promoted && !v1.tracked, { note: JSON.stringify(v1) });
    record('[광고] 광고 서버 요청 차단', net1 === 'blocked', { note: `doubleclick 요청: ${net1}` });
    await setSettings({ adBlock: false });
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const v2 = await vis();
    const net2 = await page.evaluate(() => window.__adNet);
    record('[광고] 광고 차단 끄면 원래대로(게시물·요청)', v2.promoted && v2.tracked && /loaded 200/.test(net2), { note: `${JSON.stringify(v2)} · ${net2}` });
    await setSettings({ adBlock: true });
    await page.waitForTimeout(600);

    await page.goto('https://www.youtube.com/adsfeed', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const yt = await page.evaluate(() => ({ ad: getComputedStyle(document.getElementById('ad1')).display, vid: getComputedStyle(document.getElementById('vid1')).display, skipped: !!window.__skipped }));
    record('[광고] 유튜브 광고 칸 숨김 + 영상 광고 건너뛰기', yt.ad === 'none' && yt.vid !== 'none' && yt.skipped, { note: JSON.stringify(yt) });
  } catch (err) {
    record('[광고] 광고 차단', false, { note: err.message.split('\n')[0] });
  } finally {
    await page.close();
  }
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
    const c = await page.evaluate(() => ({ controls: getComputedStyle(document.getElementById('ctl')).display, track: getComputedStyle(document.getElementById('track')).height, thumb: getComputedStyle(document.getElementById('thumb')).height }));
    await page.screenshot({ path: path.join(SHOTS, 'x-controls.png') });
    record('[X] 재생바 5초 뒤에도 계속 표시', c.controls === 'block', { note: JSON.stringify(c) });
    record('[X] 진행 막대 4px → 8px, 손잡이 12px → 18px', c.track === '8px' && c.thumb === '18px', { note: JSON.stringify(c) });
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
    }));
    await page.screenshot({ path: path.join(SHOTS, 'x-wide.png') });
    record('[X] 넓은 화면: 오른쪽 숨김 + 가운데 600px → 확대, 왼쪽 메뉴 유지', g.sidebar === 'none' && g.center > 1000 && g.video > 1000 && g.left, { note: JSON.stringify(g) });
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
