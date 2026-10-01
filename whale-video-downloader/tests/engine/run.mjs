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
console.table(results);
await browser.close(); server.close();
