// install.template.sh + socks5-proxy.mjs → install.sh (서버에 이 파일 하나만 올리면 되는 자체 완결형 설치 스크립트)
//   node tools/bypass-proxy/make-installer.mjs        → tools/bypass-proxy/install.sh 를 다시 만든다
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
export function buildInstaller() {
  const tpl = fs.readFileSync(path.join(dir, 'install.template.sh'), 'utf8');
  const proxy = fs.readFileSync(path.join(dir, 'socks5-proxy.mjs'));
  return tpl.replace('__PROXY_B64__', proxy.toString('base64').replace(/(.{76})/g, '$1\n'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.slice(7))) {
  const out = path.join(dir, 'install.sh');
  fs.writeFileSync(out, buildInstaller(), { mode: 0o755 });
  console.log(`설치 파일 만듦: ${out}`);
}
