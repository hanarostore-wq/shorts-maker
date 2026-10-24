import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createProxy, isPrivate } from '../../tools/bypass-proxy/socks5-proxy.mjs';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
// SOCKS5 CONNECT 를 해 보고 { rep, sock } 를 돌려준다
const socks = (port, host, dport) =>
  new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('error', reject);
    s.once('close', () => resolve({ closed: true }));
    s.write(Buffer.from([5, 1, 0]));
    s.once('data', (d) => {
      if (d[1] !== 0) return resolve({ methodRefused: d[1], sock: s });
      const h = Buffer.from(host);
      const req = Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([dport >> 8, dport & 255])]);
      s.write(req);
      s.once('data', (r) => resolve({ rep: r[1], sock: s }));
    });
  });

test('허용 IP 가 비면 열린 프록시가 되므로 시작하지 않음', () => {
  assert.throws(() => createProxy({ allow: [] }), /ALLOW_IPS/);
});

test('사설·내부 주소 판별', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) assert.equal(isPrivate(a), true, a);
  for (const a of ['8.8.8.8', '203.0.113.7', '172.32.0.1']) assert.equal(isPrivate(a), false, a);
});

test('허용된 주소: CONNECT 후 양방향 중계', async () => {
  const echo = net.createServer((c) => c.pipe(c));
  const ep = await listen(echo);
  const proxy = createProxy({ allow: ['127.0.0.1'], allowPrivate: true });
  const pp = await listen(proxy);
  const { rep, sock } = await socks(pp, '127.0.0.1', ep);
  assert.equal(rep, 0);
  sock.write('hello');
  const got = await new Promise((r) => sock.once('data', r));
  assert.equal(got.toString(), 'hello');
  sock.destroy();
  proxy.close();
  echo.close();
});

test('오류 경로: 허용 목록에 없는 주소는 바로 끊김', async () => {
  const proxy = createProxy({ allow: ['203.0.113.7'] });
  const pp = await listen(proxy);
  const r = await socks(pp, 'example.com', 80);
  assert.equal(r.closed, true);
  proxy.close();
});

test('오류 경로: 내부 주소(127.0.0.1)로의 연결은 거부(rep 2)', async () => {
  const proxy = createProxy({ allow: ['127.0.0.1'] });
  const pp = await listen(proxy);
  const r = await socks(pp, '127.0.0.1', 22);
  assert.equal(r.rep, 2);
  proxy.close();
});

test('오류 경로: 닫힌 포트는 연결 거절(rep 5), 없는 이름은 호스트 오류(rep 4)', async () => {
  const proxy = createProxy({ allow: ['127.0.0.1'], allowPrivate: true });
  const pp = await listen(proxy);
  const free = net.createServer();
  const closedPort = await listen(free);
  free.close();
  assert.equal((await socks(pp, '127.0.0.1', closedPort)).rep, 5);
  assert.equal((await socks(pp, 'no-such-host.invalid', 80)).rep, 4);
  proxy.close();
});

test('설치 스크립트(install.sh)에 들어 있는 프록시가 원본(socks5-proxy.mjs)과 같음', async () => {
  const fs = await import('node:fs');
  const { buildInstaller } = await import('../../tools/bypass-proxy/make-installer.mjs');
  const dir = new URL('../../tools/bypass-proxy/', import.meta.url);
  const sh = fs.readFileSync(new URL('install.sh', dir), 'utf8');
  assert.equal(sh, buildInstaller(), 'install.sh 가 오래됨 — node tools/bypass-proxy/make-installer.mjs 를 다시 실행하세요');
  const b64 = sh.split("<<'B64'\n")[1].split('\nB64')[0].replace(/\s+/g, '');
  assert.equal(Buffer.from(b64, 'base64').toString(), fs.readFileSync(new URL('socks5-proxy.mjs', dir), 'utf8'));
});
