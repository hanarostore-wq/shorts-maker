// 성능 측정: 확장프로그램을 켠 채로 무거운 유튜브 모양 페이지(썸네일 600개 + 계속 바뀌는 DOM)를 10초 열어 두고
// 페이지가 쓴 스크립트·레이아웃 시간(CDP Performance)을 잰다.  EXT_DIR=폴더 node tests/e2e/bench.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { start } from './mock-sites.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const EXT = process.env.EXT_DIR || path.join(ROOT, 'extension');
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const server = await start(443);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-bench-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', '--ignore-certificate-errors', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'],
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const t0 = Date.now();
await page.goto(`https://www.youtube.com/${process.env.BENCH_PAGE || 'benchheavy'}`, { waitUntil: 'load' });
const loadMs = Date.now() - t0;
await page.waitForTimeout(2000);
const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
const a = await m();
if (process.env.PROFILE) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
}
await page.waitForTimeout(10000);
const b = await m();
if (process.env.PROFILE) {
  const { profile: pr } = await cdp.send('Profiler.stop');
  const self = new Map();
  const dt = pr.timeDeltas;
  const byId = new Map(pr.nodes.map((n) => [n.id, n]));
  const hits = new Map();
  pr.samples.forEach((id, i) => hits.set(id, (hits.get(id) || 0) + (dt[i] || 0)));
  for (const [id, us] of hits) {
    const n = byId.get(id);
    const k = `${n.callFrame.functionName || '(anon)'} @ ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + us);
  }
  for (const [k, us] of [...self].sort((x, y) => y[1] - x[1]).slice(0, 18)) console.log(`${(us / 1000).toFixed(0)}ms  ${k}`);
}
const d = (k) => Math.round((b[k] - a[k]) * 1000);
const gaps = await page.evaluate(() => (window.__gaps || []).slice().sort((a, b) => b - a));
console.log(JSON.stringify({ page: process.env.BENCH_PAGE || 'benchheavy', maxFrameGapMs: Math.round(gaps[0] || 0), p95GapMs: Math.round(gaps[Math.floor(gaps.length * 0.05)] || 0), ext: path.basename(EXT), loadMs, scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), recalcMs: d('RecalcStyleDuration'), taskMs: d('TaskDuration'), layouts: b.LayoutCount - a.LayoutCount }));
await ctx.close();
server.close?.();
process.exit(0);
