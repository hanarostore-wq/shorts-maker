// 블랙전용 '비밀번호 관리' 시험 — 실제 Chromium 에 확장을 로드하고 모의 로그인 화면에서 저장·자동 입력·CSV 불러오기를 확인
//   node tests/e2e/black-pw.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from './mock-sites.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const EXT = path.join(ROOT, 'extension');
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!fs.existsSync(path.join(ROOT, 'tests/e2e/certs/server.crt'))) throw new Error('tests/e2e/make-certs.sh 를 먼저 실행하세요');
const server = await start(443);
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'smd-pw-')), {
  executablePath: CHROME,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', '--ignore-certificate-errors', '--no-proxy-server', '--lang=ko-KR'],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
const extId = new URL(sw.url()).host;
const results = [];
const record = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? ` — ${note}` : ''}`);
};
const W = 'https://www.example-videos.com';
const C = 'https://cdn.example-videos.com';
const toast = (p) => p.evaluate(() => document.querySelector('smd-pw-toast')?.shadowRoot.querySelector('.m')?.textContent || '');
const vals = (p) => p.evaluate(() => ({ user: document.getElementById('user').value, pass: document.getElementById('pass').value, events: window.__events || 0 }));
async function popup() {
  const pp = await ctx.newPage();
  await pp.goto(`chrome-extension://${extId}/popup/popup.html`);
  await pp.click('.tab[data-tab="black"]');
  await pp.waitForTimeout(600);
  return pp;
}
const list = async () => {
  const pp = await popup();
  const r = await pp.evaluate(() => chrome.runtime.sendMessage({ type: 'smd:pw-list' }));
  const ui = await pp.evaluate(() => [...document.querySelectorAll('#pwList .pw-item')].map((li) => `${li.querySelector('.h').textContent}|${li.querySelector('.u').textContent}`));
  await pp.close();
  return { items: r.items || [], ui };
};

const page = await ctx.newPage();
try {
  // 1) 처음 로그인 → 자동 저장 + 다음 페이지에서 알림
  await page.goto(`${W}/pwlogin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const empty = await vals(page);
  await page.fill('#user', 'alice');
  await page.fill('#pass', 'pw1');
  await page.click('#go');
  await page.waitForURL(/pwdone/);
  await page.waitForTimeout(1200);
  const t1 = await toast(page);
  const l1 = await list();
  record('[비밀번호] 처음 로그인하면 확인 창 없이 저장 + 다음 화면에 알림', empty.user === '' && empty.pass === '' && /비밀번호를 저장했습니다 \(alice\)/.test(t1) && l1.items.length === 1 && l1.items[0].host === 'www.example-videos.com' && l1.items[0].password === 'pw1' && l1.ui[0] === 'www.example-videos.com|alice', JSON.stringify({ t1, ui: l1.ui }));
  // 저장소에 평문이 남지 않음(암호문), 설정(동기화 백업 대상)에도 없음
  const raw = await page.evaluate(() => 0).then(async () => {
    const pp = await popup();
    const s = await pp.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)) + JSON.stringify(await chrome.storage.sync.get(null)));
    await pp.close();
    return s;
  });
  record('[비밀번호] 저장소에 비밀번호 글자가 그대로 남지 않고 동기화 백업에도 없음', !raw.includes('"pw1"') && !/alice/.test(raw), raw.includes('pw1') ? 'pw1 보임' : '안 보임');
  // 2) 다시 오면 자동 입력(사이트가 알아채도록 input 이벤트까지)
  await page.goto(`${W}/pwlogin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const f2 = await vals(page);
  const q = await page.evaluate(() => document.querySelector('input[name="q"]').value);
  record('[비밀번호] 저장된 사이트에 다시 오면 아이디·비밀번호 자동 입력(검색 칸은 그대로)', f2.user === 'alice' && f2.pass === 'pw1' && f2.events >= 2 && q === '', JSON.stringify({ ...f2, pass: f2.pass ? '(채워짐)' : '', q }));
  // 3) 비밀번호 바꿔 로그인 → 바뀜 알림 → 되돌리기
  await page.fill('#pass', 'pw2');
  await page.click('#go');
  await page.waitForURL(/pwdone/);
  await page.waitForTimeout(1200);
  const t3 = await toast(page);
  await page.evaluate(() => document.querySelector('smd-pw-toast').shadowRoot.querySelector('button').click());
  await page.waitForTimeout(800);
  const t3b = await toast(page);
  const l3 = await list();
  record('[비밀번호] 비밀번호가 바뀌면 새 것으로 저장, [되돌리기]로 이전 것 복구', /새 것으로 바꿔 저장/.test(t3) && /이전 비밀번호로 되돌렸습니다/.test(t3b) && l3.items.length === 1 && l3.items[0].password === 'pw1', JSON.stringify({ t3, t3b }));
  // 4) 폼 없는 화면(SPA): 로그인 단추 누르면 그 자리에서 저장 알림
  await page.goto(`${W}/pwspa`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.fill('#user', 'spa_user');
  await page.fill('#pass', 'spa_pw');
  await page.click('#go');
  await page.waitForTimeout(1000);
  const t4 = await toast(page);
  record('[비밀번호] 폼 없는 로그인(단추만)도 누르는 순간 저장', /저장했습니다 \(spa_user\)/.test(t4), t4);
  // 5) CSV 불러오기: 같은 사이트 다른 계정 + 다른 주소 + 건너뛸 줄
  const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pwcsv-')), 'pw.csv');
  fs.writeFileSync(csv, `name,url,username,password,note\nexample,${W}/pwlogin,carol,pwc,\nexample,${W}/,alice,pw1,\ncdn,,nobody,x,\nnear,https://img.example-videos.com/,dave,pwd,\n`);
  let pp = await popup();
  await pp.setInputFiles('#pwFile', csv);
  await pp.waitForTimeout(1200);
  const m5 = await pp.evaluate(() => document.getElementById('pwMsg').textContent);
  const n5 = await pp.evaluate(() => document.getElementById('pwCount').textContent);
  await pp.close();
  record('[비밀번호] CSV 불러오기: 새 항목·이미 있음·건너뛴 줄(줄 번호·이유) 안내', /새로 2개/.test(m5) && /이미 있음 1개/.test(m5) && /4째 줄\(주소 없음\)/.test(m5) && /저장된 비밀번호 4개/.test(n5), `${m5.replace(/\n/g, ' / ')} · ${n5}`);
  // 5-1) 큰 CSV(3000개): 'Maximum call stack size exceeded' 없이 불러오고, 다시 읽어도 그대로
  {
    const big = path.join(path.dirname(csv), 'big.csv');
    const rows = ['name,url,username,password,note'];
    for (let i = 0; i < 3000; i++) rows.push(`s${i},https://site${i}.example-big.com/login,user${i},${'p'.repeat(20)}${i},메모 ${i}`);
    fs.writeFileSync(big, rows.join('\n'));
    const bp = await popup();
    await bp.setInputFiles('#pwFile', big);
    await bp.waitForFunction(() => /완료|실패/.test(document.getElementById('pwMsg').textContent), null, { timeout: 30000 });
    const mb = await bp.evaluate(() => document.getElementById('pwMsg').textContent);
    await bp.close();
    const lb = await list();
    record('[비밀번호] 큰 CSV(3000개)도 불러오기(멈춤·오류 없음)', /새로 3000개/.test(mb) && lb.items.length === 3004 && lb.items.some((i) => i.username === 'user2999' && i.password === `${'p'.repeat(20)}2999`), `${mb.split('\n')[0]} · 목록 ${lb.items.length}개`);
    // 다음 시험을 위해 큰 항목 지우기
    const dp = await popup();
    await dp.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: 'smd:pw-list' });
      for (const it of r.items.filter((i) => i.host.endsWith('example-big.com'))) await chrome.runtime.sendMessage({ type: 'smd:pw-delete', id: it.id });
    });
    await dp.close();
  }
  // 6) 같은 주소에 계정이 둘 → 자동으로 채우지 않고, 칸을 누르면 목록에서 고르기
  await page.goto(`${W}/pwlogin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const f6 = await vals(page);
  await page.click('#user');
  await page.waitForTimeout(300);
  const opts = await page.evaluate(() => [...(document.querySelector('smd-pw-menu')?.shadowRoot.querySelectorAll('button') || [])].map((b) => b.textContent));
  await page.evaluate(() => [...document.querySelector('smd-pw-menu').shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'carol').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForTimeout(400);
  const f6b = await vals(page);
  record('[비밀번호] 계정이 여러 개면 칸을 누를 때 골라서 입력', f6.user === '' && f6.pass === '' && opts.includes('alice') && opts.includes('carol') && f6b.user === 'carol' && f6b.pass === 'pwc', JSON.stringify({ opts, picked: f6b.user }));
  // 7) 같은 상위 도메인의 다른 주소(cdn.) → 후보로 보여 주고 골라서 입력
  await page.goto(`${C}/pwlogin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const f7 = await vals(page);
  await page.click('#user');
  await page.waitForTimeout(300);
  const opts7 = await page.evaluate(() => [...(document.querySelector('smd-pw-menu')?.shadowRoot.querySelectorAll('button') || [])].map((b) => b.textContent));
  await page.evaluate(() => [...document.querySelector('smd-pw-menu').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.startsWith('dave')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForTimeout(500);
  const f7b = await vals(page);
  record('[비밀번호] 같은 상위 도메인의 다른 주소는 바로 채우지 않고 후보로(골라서 입력)', f7.user === '' && opts7.some((o) => /dave · img\.example-videos\.com/.test(o)) && f7b.user === 'dave' && f7b.pass === 'pwd', JSON.stringify({ opts7, picked: f7b.user }));
  // 8) 오류 경로: 형식이 다른 CSV
  const bad = path.join(path.dirname(csv), 'bad.csv');
  fs.writeFileSync(bad, 'title,link,pass\na,b,c\n');
  pp = await popup();
  await pp.setInputFiles('#pwFile', bad);
  await pp.waitForTimeout(800);
  const m8 = await pp.evaluate(() => document.getElementById('pwMsg').textContent);
  // 지우기
  const before = await pp.evaluate(() => document.querySelectorAll('#pwList .pw-item').length);
  await pp.locator('#pwList .pw-item', { hasText: 'dave' }).locator('.pw-del').click();
  await pp.waitForTimeout(500);
  const after = await pp.evaluate(() => document.querySelectorAll('#pwList .pw-item').length);
  await pp.close();
  fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  record('[비밀번호] (오류 경로) 형식이 다른 CSV 는 단계·원인·조치 안내', /CSV 불러오기 실패\n단계: CSV 형식 확인\n원인: .+\n조치: .+name,url,username,password/.test(m8), m8.replace(/\n/g, ' / '));
  record('[비밀번호] 목록에서 지우기', before === 4 && after === 3, `${before} → ${after}`);
  // 9) 끄면 자동 입력 안 함
  pp = await popup();
  await pp.click('label:has(#blackPwOn)');
  await pp.waitForTimeout(400);
  await pp.close();
  await page.goto(`${C}/pwlogin`, { waitUntil: 'domcontentloaded' });
  await page.goto(`${W}/pwspa`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const f9 = await vals(page);
  record('[비밀번호] 끄면 자동 입력하지 않음', f9.user === '' && f9.pass === '', JSON.stringify({ user: f9.user }));
} catch (err) {
  record('[비밀번호]', false, err.message.split('\n')[0]);
} finally {
  await ctx.close();
  server.close?.();
}
const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
