import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { start } from './server.mjs';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
if (!fs.existsSync(path.join(ROOT, 'tests/fixtures/media/hls_fmp4/master.m3u8'))) execFileSync('bash', [path.join(ROOT, 'tests/fixtures/make-media.sh')], { stdio: 'inherit' });
const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + '/tests/engine/page.html');
await page.waitForFunction(() => window.ready);
const M = '/tests/fixtures/media/';
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,duration', '-show_entries', 'format=duration', '-of', 'compact', '/tmp/engine-out/' + f]).toString().trim();
const results = [];
async function t(name, fn, file) {
  try { const r = await fn(); results.push([name, 'OK', JSON.stringify(r)]); if (file) console.log(name, '\n ', probe(file).replace(/\n/g, '\n  ')); }
  catch (e) { results.push([name, 'FAIL', e.message.split('\n')[0]]); }
}
await t('merge avc+aac', () => page.evaluate(([v, a]) => runMerge(v, a, 'merge_avc.mp4'), [base + M + 'dash_video_avc.mp4', base + M + 'dash_audio.m4a']), 'merge_avc.mp4');
await t('merge vp9+opus', () => page.evaluate(([v, a]) => runMerge(v, a, 'merge_vp9.mp4'), [base + M + 'dash_video_vp9.webm', base + M + 'dash_audio_opus.webm']), 'merge_vp9.mp4');
await t('merge rangeParam (googlevideo style)', () => page.evaluate(([v, a, vs, as]) => runMerge(v, a, 'merge_rp.mp4', { v: { rangeParam: true, size: vs }, a: { rangeParam: true, size: as } }), [base + M + 'dash_video_avc.mp4?norange=1', base + M + 'dash_audio.m4a?norange=1', 4172300, 98046]), 'merge_rp.mp4');
await t('hls ts', () => page.evaluate((u) => runHls(u, 'hls_ts.mp4'), base + M + 'hls_ts/master.m3u8'), 'hls_ts.mp4');
await t('hls fmp4 + audio group', () => page.evaluate((u) => runHls(u, 'hls_fmp4.mp4'), base + M + 'hls_fmp4/master.m3u8'), 'hls_fmp4.mp4');
await t('copy progressive', () => page.evaluate((u) => runCopy(u, 'copy.mp4'), base + M + 'progressive_1080x1920.mp4'), 'copy.mp4');
await t('copy 403', () => page.evaluate((u) => runCopy(u, 'deny.mp4'), base + M + 'progressive_360p.mp4?deny=1'));
// 장면 나누기 (scenes.webm: 0~3 테스트화면, 3~3.6 빨간 번쩍임, 3.6~6.6 컬러바, 6.6~9.6 만델브로)
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', '/tmp/engine-out/' + f]).toString().trim());
const color = (f) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-i', '/tmp/engine-out/' + f, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [...b].join(','); };
const near = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;
await t('scenes precise min 2s', async () => {
  const r = await page.evaluate((u) => runScenes(u, 'sc2', { minSec: 2, precise: true }), base + M + 'scenes.webm');
  if (r.error) throw new Error(`${r.step}: ${r.error}`);
  const d = r.out.map((o) => dur(o.name));
  // 번쩍임(0.6초)은 2초보다 짧아 따로 나뉘지 않는다 → 장면 3개, 각 길이가 구간 길이와 같음(정확하게 = 장면 첫 프레임부터)
  if (r.out.length !== 3) throw new Error(`장면 ${r.out.length}개 (cuts ${r.cuts})`);
  r.out.forEach((o, i) => { if (!near(d[i], o.end - o.start)) throw new Error(`장면 ${i + 1} 길이 ${d[i]} ≠ ${o.end - o.start}`); });
  if (!near(r.cuts[1], 6.6, 0.05)) throw new Error(`두 번째 경계 ${r.cuts[1]}`);
  return { codec: r.codec, cuts: r.cuts, durations: d, frames: r.frames, lastProgress: r.lastProgress };
});
await t('scenes precise min 0.5s (flash separate)', async () => {
  const r = await page.evaluate((u) => runScenes(u, 'sc05', { minSec: 0.5, precise: true }), base + M + 'scenes.webm');
  if (r.error) throw new Error(`${r.step}: ${r.error}`);
  if (r.out.length !== 4) throw new Error(`장면 ${r.out.length}개 (cuts ${r.cuts})`);
  const flash = color(r.out[1].name).split(',').map(Number);
  if (!(flash[0] > 200 && flash[1] < 60 && flash[2] < 60)) throw new Error(`두 번째 장면 첫 색이 빨강이 아님: ${flash}`);
  return { cuts: r.cuts, durations: r.out.map((o) => dur(o.name)), flashRGB: flash };
});
await t('scenes fast (copy, keyframe only at 0)', async () => {
  const r = await page.evaluate((u) => runScenes(u, 'scf', { minSec: 2, precise: false }), base + M + 'scenes.webm');
  if (r.error) throw new Error(`${r.step}: ${r.error}`);
  if (r.out.length !== 3) throw new Error(`장면 ${r.out.length}개`);
  // 복사 방식: 앞 키프레임(이 파일은 0초 하나뿐)부터 담고 앞부분은 재생 안 되게 표시 → 보이는 길이는 장면 길이와 같아야 함
  const d = r.out.map((o) => dur(o.name));
  r.out.forEach((o, i) => { if (!near(d[i], o.end - o.start)) throw new Error(`장면 ${i + 1} 길이 ${d[i]} ≠ ${o.end - o.start}`); });
  const c3 = color(r.out[2].name).split(',').map(Number);
  const p3 = color('sc2_3.mp4').split(',').map(Number);
  if (c3.some((v, k) => Math.abs(v - p3[k]) > 30)) throw new Error(`빠르게 자른 3번째 장면 첫 화면이 정확하게 자른 것과 다름: ${c3} vs ${p3}`);
  return { cuts: r.cuts, durations: d, sizes: r.out.map((o) => o.size), firstRGB: c3, codecs: r.out.map((o) => probe(o.name).match(/codec_name=(\w+)/)?.[1]) };
});
await t('scenes error: audio only', async () => {
  const r = await page.evaluate((u) => runScenes(u, 'sca', {}), base + M + 'dash_audio.m4a');
  if (!r.error || r.step !== '장면 찾기') throw new Error(JSON.stringify(r));
  return r;
});
console.table(results);
await browser.close(); server.close();
