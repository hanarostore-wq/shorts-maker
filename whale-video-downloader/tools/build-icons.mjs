// SVG 아이콘을 PNG(16/32/48/128)로 렌더링한다. Chromium 으로 그려서 브라우저와 같은 안티에일리어싱을 얻는다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const big = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
const small = fs.readFileSync(path.join(root, 'assets/icon-small.svg'), 'utf8');
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [size, svg] of [[16, small], [24, small], [32, small], [48, big], [64, big], [96, big], [128, big], [256, big]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
  await page.waitForTimeout(50);
  const out = size === 256 ? path.join(root, 'assets/icon256.png') : path.join(root, `extension/icons/icon${size}.png`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', path.relative(root, out));
}
await browser.close();
