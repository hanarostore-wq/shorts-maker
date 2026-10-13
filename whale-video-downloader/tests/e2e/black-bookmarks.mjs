// 블랙전용 '북마크바 아이콘만' 시험 (실제 Chromium 에 확장 로드)
//   node tests/e2e/black-bookmarks.mjs
//   - 정상 경로: 시험 브라우저는 권한 묻는 창을 누를 수 없어서, 확장 복사본에 'bookmarks' 를 기본 권한으로 넣어 실행
//   - 오류 경로: 원래 확장(권한 없음)으로 켜면 단계·원인·조치 안내
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const results = [];
const record = (name, ok, note = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? ` — ${note}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(extDir) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-bm-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox'] });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/popup/popup.html`);
  return { ctx, page, profile };
}

// ── 정상 경로 ──
{
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-bmext-'));
  fs.cpSync(path.join(ROOT, 'extension'), ext, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  mf.permissions.push('bookmarks');
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));
  const { ctx, page } = await launch(ext);
  try {
    // 북마크바: 링크 2개 + 폴더 1개(안에 링크 1개), 기타 북마크에 1개
    const ids = await page.evaluate(async () => {
      const [root] = await chrome.bookmarks.getTree();
      const bar = root.children.find((c) => c.folderType === 'bookmarks-bar') || root.children[0];
      const other = root.children.find((c) => c.folderType === 'other') || root.children[1];
      const a = await chrome.bookmarks.create({ parentId: bar.id, title: '네이버', url: 'https://www.naver.com/' });
      const b = await chrome.bookmarks.create({ parentId: bar.id, title: '유튜브', url: 'https://www.youtube.com/' });
      const f = await chrome.bookmarks.create({ parentId: bar.id, title: '업무' });
      const fi = await chrome.bookmarks.create({ parentId: f.id, title: '폴더 안', url: 'https://example.com/' });
      const o = await chrome.bookmarks.create({ parentId: other.id, title: '기타', url: 'https://example.org/' });
      return { a: a.id, b: b.id, f: f.id, fi: fi.id, o: o.id, bar: bar.id };
    });
    const titles = () => page.evaluate(async (ids) => Object.fromEntries(await Promise.all(Object.entries(ids).filter(([k]) => k !== 'bar').map(async ([k, id]) => [k, (await chrome.bookmarks.get(id))[0].title]))), ids);
    // 팝업 스위치로 켜기(권한 요청은 이미 있는 권한이라 바로 허용)
    await page.click('.tab[data-tab="black"]');
    await page.click('label:has(#blackBmIcons)');
    await wait(1500);
    const t1 = await titles();
    const msg1 = await page.evaluate(() => document.getElementById('blackBmMsg').textContent);
    record('[북마크바 아이콘만] 켜면 북마크바 북마크 이름만 비움(폴더·폴더 안·기타 북마크는 그대로)', t1.a === '' && t1.b === '' && t1.f === '업무' && t1.fi === '폴더 안' && t1.o === '기타' && /켜짐: 북마크바 2개/.test(msg1), JSON.stringify({ t1, msg1 }));
    // 켜 둔 동안 새로 추가한 북마크도 비움
    const nid = await page.evaluate(async (bar) => (await chrome.bookmarks.create({ parentId: bar, title: '새 북마크', url: 'https://new.example/' })).id, ids.bar);
    await wait(1200);
    const nt = await page.evaluate(async (id) => (await chrome.bookmarks.get(id))[0].title, nid);
    record('[북마크바 아이콘만] 켜 둔 동안 새로 넣은 북마크도 아이콘만', nt === '', `새 북마크 이름 '${nt}'`);
    // 켜 둔 동안 이름을 새로 쓰면 그 이름을 보관하고 다시 비움 → 끄면 새 이름으로 돌아옴
    await page.evaluate(async (id) => chrome.bookmarks.update(id, { title: '네이버 메일' }), ids.a);
    await wait(1200);
    const ra = await page.evaluate(async (id) => (await chrome.bookmarks.get(id))[0].title, ids.a);
    // 폴더 이름도 숨기기
    await page.click('label:has(#blackBmFolders)');
    await wait(1200);
    const t2 = await titles();
    record('[북마크바 아이콘만] 폴더 이름도 숨기기(폴더 안 북마크는 그대로)', ra === '' && t2.f === '' && t2.fi === '폴더 안', JSON.stringify({ ra, t2 }));
    // 끄면 원래 이름(바꾼 이름 포함)으로 되돌림
    await page.click('label:has(#blackBmIcons)');
    await wait(1500);
    const t3 = await titles();
    const n3 = await page.evaluate(async (id) => (await chrome.bookmarks.get(id))[0].title, nid);
    const left = await page.evaluate(async () => Object.keys((await chrome.storage.local.get('blackBmTitles')).blackBmTitles || {}).length);
    record('[북마크바 아이콘만] 끄면 원래 이름으로 되돌림(켜 둔 동안 새로 쓴 이름 포함, 보관함 비움)', t3.a === '네이버 메일' && t3.b === '유튜브' && t3.f === '업무' && n3 === '새 북마크' && left === 0, JSON.stringify({ t3, n3, left }));
    // 북마크바 밖으로 옮긴 북마크는 이름을 되돌림
    await page.click('label:has(#blackBmIcons)');
    await wait(1200);
    const other = await page.evaluate(async () => {
      const [root] = await chrome.bookmarks.getTree();
      return (root.children.find((c) => c.folderType === 'other') || root.children[1]).id;
    });
    await page.evaluate(async ([id, to]) => chrome.bookmarks.move(id, { parentId: to }), [ids.b, other]);
    await wait(1200);
    const mb = await page.evaluate(async (id) => (await chrome.bookmarks.get(id))[0].title, ids.b);
    record('[북마크바 아이콘만] 북마크바 밖으로 옮기면 이름이 돌아옴', mb === '유튜브', `옮긴 뒤 이름 '${mb}'`);
  } catch (err) {
    record('[북마크바 아이콘만]', false, err.message.split('\n')[0]);
  } finally {
    await ctx.close();
  }
}

// ── 오류 경로: 권한 없는 원래 확장에서 켜짐 상태가 되면 단계·원인·조치 ──
{
  const { ctx, page } = await launch(path.join(ROOT, 'extension'));
  try {
    const has = await page.evaluate(() => !!chrome.bookmarks);
    await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...(settings || {}), blackBmIcons: true } });
    });
    await wait(1200);
    const st = await page.evaluate(async () => (await chrome.storage.local.get('blackBmStatus')).blackBmStatus);
    await page.reload();
    await page.click('.tab[data-tab="black"]');
    await wait(500);
    const msg = await page.evaluate(() => document.getElementById('blackBmMsg').textContent);
    record('[북마크바 아이콘만] (오류 경로) 권한 없으면 단계·원인·조치 안내', !has && st?.error?.step === '북마크 권한 확인' && /실패\n단계: 북마크 권한 확인\n원인:.+\n조치:/.test(msg), msg.replace(/\n/g, ' / '));
  } catch (err) {
    record('[북마크바 아이콘만] 오류 경로', false, err.message.split('\n')[0]);
  } finally {
    await ctx.close();
  }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n결과: ${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
