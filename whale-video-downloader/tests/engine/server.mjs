// 엔진 단위 검증용 로컬 서버: 저장소 파일 제공 + 결과 업로드 저장 + Range 지원
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const outDir = process.env.OUT_DIR || '/tmp/engine-out';
fs.mkdirSync(outDir, { recursive: true });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment' };
export function start(port = 0) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/upload') {
      const f = fs.createWriteStream(path.join(outDir, path.basename(u.searchParams.get('name'))));
      req.pipe(f); f.on('finish', () => { res.end('ok'); });
      return;
    }
    const file = path.join(root, decodeURIComponent(u.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    const size = fs.statSync(file).size;
    const type = types[path.extname(file)] || 'application/octet-stream';
    const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' };
    const rq = u.searchParams.get('range');
    if (rq) {
      const m = /(\d+)-(\d*)/.exec(rq);
      const s = Number(m[1]); const e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(200, { ...h, 'Content-Length': e - s + 1 });
      return fs.createReadStream(file, { start: s, end: e }).pipe(res);
    }
    if (u.searchParams.get('norange') === '1' && req.headers.range) { res.writeHead(400, h); return res.end('range header not allowed'); }
    const range = req.headers.range;
    if (u.searchParams.get('deny') === '1') { res.writeHead(403, h); return res.end('denied'); }
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const s = Number(m[1]); const e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 });
      return fs.createReadStream(file, { start: s, end: e }).pipe(res);
    }
    res.writeHead(200, { ...h, 'Content-Length': size });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
