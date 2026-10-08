// 사용: npm pack @mediabunny/aac-encoder@<mediabunny 와 같은 버전> → 풀고
//   node tools/vendor-aac-encoder.mjs package/dist/bundles/mediabunny-aac-encoder.mjs extension/vendor
// @mediabunny/aac-encoder 번들을 확장프로그램에서 쓸 수 있게 나눈다:
//  - 인라인 워커(Blob URL, 확장 페이지 CSP 에서 막힘) → 별도 파일 워커
//  - import "mediabunny" → 같은 vendor 폴더의 mediabunny.min.mjs
import fs from 'node:fs';
const [src, outDir] = process.argv.slice(2);
let code = fs.readFileSync(src, 'utf8');
const start = code.indexOf('return inlineWorker(`');
if (start < 0) throw new Error('인라인 워커를 찾지 못함');
let i = start + 'return inlineWorker(`'.length;
const litStart = i;
for (; i < code.length; i++) {
  if (code[i] === '\\') { i++; continue; }
  if (code[i] === '$' && code[i + 1] === '{') throw new Error('템플릿 치환이 있음');
  if (code[i] === '`') break;
}
const literal = code.slice(litStart, i);
const text = new Function('return `' + literal + '`')();
fs.writeFileSync(`${outDir}/mediabunny-aac-encoder.worker.js`, text);
// 닫는 백틱 뒤의 ')' 까지 바꾼다(inlineWorker( … ) 호출 전체)
if (code[i + 1] !== ')') throw new Error('inlineWorker 호출 모양이 다름');
code = code.slice(0, start) + "return new Worker(new URL('./mediabunny-aac-encoder.worker.js', import.meta.url))" + code.slice(i + 2);
code = code.replace(/from "mediabunny";/g, 'from "./mediabunny.min.mjs";');
if (/from "mediabunny"/.test(code)) throw new Error('mediabunny 가져오기가 남음');
fs.writeFileSync(`${outDir}/mediabunny-aac-encoder.mjs`, code);
console.log('worker', text.length, 'module', code.length);
