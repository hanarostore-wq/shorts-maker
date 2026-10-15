// 메모리·CPU 측정: 같은 모의 사이트 탭 N 개를 확장프로그램 있이/없이 열어 브라우저 프로세스 전체의 RSS(실제 쓰는 램)와 가만히 둔 동안의 CPU 시간을 잰다.
//   node tests/e2e/bench-mem.mjs            확장 켬
//   NOEXT=1 node tests/e2e/bench-mem.mjs    확장 없음(기준)
//   EXT_DIR=폴더 로 다른 확장 폴더, TABS=개수(기본 10)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { start } from './mock-sites.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const EXT = process.env.EXT_DIR || path.join(ROOT, 'extension');
const NOEXT = !!process.env.NOEXT;
const TABS = Number(process.env.TABS || 10);
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const server = await start(443);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-mem-'));
const args = ['--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', '--ignore-certificate-errors', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--lang=ko-KR'];
if (!NOEXT) args.unshift(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
const ctx = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, args });

// SW(서비스워커) 힙(확장 켠 경우만)
const sw = NOEXT ? null : ctx.serviceWorkers().find((w) => /(service-worker|sw)\.js/.test(w.url())) || (await ctx.waitForEvent('serviceworker', { timeout: 8000 }).catch(() => null));
if (!NOEXT && !sw) throw new Error('확장 서비스워커를 찾지 못했습니다');

// 이 브라우저(프로필 폴더가 같은) 프로세스를 종류별로 모은다
function procs() {
  const out = execFileSync('ps', ['-eo', 'pid,rss,utime,stime,args', '--no-headers'], { maxBuffer: 1 << 26 }).toString().split('\n');
  const list = [];
  for (const l of out) {
    if (!l.includes(profile)) continue;
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const type = /--type=(\S+)/.exec(m[5])?.[1] || 'browser';
    const ext = /--extension-process/.test(m[5]);
    list.push({ pid: +m[1], rssMB: +m[2] / 1024, type: ext ? `${type}(확장)` : type });
  }
  return list;
}
const cpuTicks = (pids) => pids.reduce((n, p) => {
  try {
    const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' ');
    return n + Number(f[13]) + Number(f[14]);
  } catch {
    return n;
  }
}, 0);

const URLS = [
  'https://www.youtube.com/benchheavy', 'https://www.tiktok.com/@creator/video/7300000000000000001', 'https://x.com/tester/status/1790000000000000001',
  'https://www.instagram.com/reel/CmockReel01/', 'https://www.facebook.com/', 'https://www.example-videos.com/watch', 'https://www.xiaohongshu.com/',
  'https://www.snapchat.com/', 'https://www.douyin.com/', 'https://www.google.com/search?q=test',
];
if (process.env.EXCLUDE && sw) {
  // 확장은 켠 채 이 사이트만 제외(기능 전부 꺼짐) → 확장 기본 비용과 기능 비용을 나눠 본다
  const ep = await ctx.newPage();
  await ep.goto(`chrome-extension://${sw.url().split('/')[2]}/popup/popup.html`);
  await ep.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(r.settings || {}), excludedSites: ['www.example-videos.com'] } });
  });
  await ep.close();
  await new Promise((r) => setTimeout(r, 1500));
}
if (process.env.FRAMES) URLS.splice(0, URLS.length, 'https://www.example-videos.com/manyframes');
const pages = [];
for (let i = 0; i < TABS; i++) {
  const p = await ctx.newPage();
  await p.goto(URLS[i % URLS.length], { waitUntil: 'domcontentloaded' }).catch(() => {});
  pages.push(p);
}
await new Promise((r) => setTimeout(r, 8000));
if (process.env.PROFILE) {
  // 가만히 둔 동안 확장 스크립트가 쓰는 시간: 첫 탭에서 CPU 프로파일을 떠서 파일·함수별 자기 시간(ms)을 센다
  const cdp = await ctx.newCDPSession(pages[0]);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await new Promise((r) => setTimeout(r, 8000));
  const { profile: pr } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(pr.nodes.map((n) => [n.id, n]));
  pr.samples.forEach((id, i) => {
    const n = byId.get(id);
    const cf = n.callFrame;
    const key = `${(cf.url || '(내부)').replace(/^chrome-extension:\/\/[a-z]+\//, 'ext:')}:${cf.functionName || '(익명)'}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (pr.timeDeltas[i] || 0) / 1000);
  });
  console.log('가만히 둔 8초 동안 자기 시간 상위(ms):');
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
}
const before = procs();
const t0 = cpuTicks(before.map((p) => p.pid));
const c0 = Object.fromEntries(before.map((p) => [p.pid, cpuTicks([p.pid])]));
await new Promise((r) => setTimeout(r, 20000));
const after = procs();
const t1 = cpuTicks(after.map((p) => p.pid));
const cpuBy = {};
for (const p of after) cpuBy[p.type] = (cpuBy[p.type] || 0) + (cpuTicks([p.pid]) - (c0[p.pid] || 0));
const sum = (l) => l.reduce((n, p) => n + p.rssMB, 0);
const byType = {};
for (const p of after) (byType[p.type] ||= { n: 0, mb: 0 }), (byType[p.type].n++, (byType[p.type].mb += p.rssMB));
const hz = Number(execFileSync('getconf', ['CLK_TCK']).toString());
const swHeap = sw ? await sw.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1)).catch(() => -2) : null;
console.log(JSON.stringify({ swHeapMB: swHeap, frames: !!process.env.FRAMES, mode: NOEXT ? '확장 없음' : '확장 켬', tabs: TABS, processes: after.length, totalRssMB: Math.round(sum(after)), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, `${v.n}개 ${Math.round(v.mb)}MB`])), idleCpuSecPer20s: +((t1 - t0) / hz).toFixed(2), cpuByType: Object.fromEntries(Object.entries(cpuBy).map(([k, v]) => [k, +(v / hz).toFixed(2)])) }, null, 1));
await ctx.close();
server.close();
process.exit(0);
