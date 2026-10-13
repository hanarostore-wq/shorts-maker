// 유료판 만들기: extension/ 을 복사하면서 블랙전용(개인용) 기능을 뺀다.
//   node tools/make-paid.mjs [출력 폴더]  →  기본 dist/paid/extension
//   - black/ 폴더 통째로 뺌
//   - manifest.json 에서 black/ 스크립트 묶음 뺌
//   - '블랙전용 (유료판에서 빠짐)' 표시가 붙은 줄을 뺌(서비스워커 import, 팝업 <script>)
//   - 끝나고 결과물 안에 블랙전용 흔적이 남았는지 검사해서, 남았으면 어느 파일·몇째 줄인지 알리고 실패로 끝낸다
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = path.resolve(process.env.MAKE_PAID_SRC || path.join(root, 'extension'));
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'paid', 'extension'));
const MARK = '블랙전용 (유료판에서 빠짐)';

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (p) => path.relative(src, p).split(path.sep)[0] !== 'black' });

const mfPath = path.join(out, 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
mf.content_scripts = (mf.content_scripts || []).filter((g) => !g.js.some((f) => f.startsWith('black/')));
fs.writeFileSync(mfPath, `${JSON.stringify(mf, null, 2)}\n`);

const problems = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(js|mjs|html|json|css)$/.test(e.name)) continue;
    let text = fs.readFileSync(full, 'utf8');
    if (text.includes(MARK)) {
      text = text.split('\n').filter((l) => !l.includes(MARK)).join('\n');
      fs.writeFileSync(full, text);
    }
    text.split('\n').forEach((l, i) => {
      if (/black\/|블랙전용|smd:black|blackAltW/.test(l)) problems.push(`${path.relative(out, full)}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
})(out);

if (problems.length) {
  console.error(`유료판 만들기 실패\n단계: 블랙전용 흔적 검사\n원인: 결과물에 블랙전용 코드가 남아 있습니다\n${problems.join('\n')}\n조치: 위 줄 끝에 '// ${MARK}' 표시를 붙이거나 black/ 폴더로 옮긴 뒤 다시 실행하세요.`);
  process.exit(1);
}
console.log(`유료판 완료: ${out} (블랙전용 기능 없음, 버전 ${mf.version})`);
