// 451 우회용 SOCKS5 프록시 (한국 밖 서버에서 실행). 확장 블랙전용 → 451 우회 에 `socks5://서버주소:포트` 로 넣는다.
//   ALLOW_IPS=내집공인IP[,IP...] [PORT=1080] [HOST=0.0.0.0] node tools/bypass-proxy/socks5-proxy.mjs
//  - 확장이 프록시 로그인을 못 하므로 '허용 IP' 방식: ALLOW_IPS 에 없는 주소는 바로 끊는다. ALLOW_IPS 가 비면 시작하지 않는다(열린 프록시 방지).
//  - CONNECT 만 받고, 서버 자신·사설망(127.*, 10.*, 192.168.* 등)으로의 연결은 막는다(ALLOW_PRIVATE_DEST=1 이면 풀림 — 시험용).
//  - 외부 패키지 없이 Node 18+ 만 있으면 된다.
import net from 'node:net';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

const REP = { ok: 0, fail: 1, denied: 2, unreach: 3, host: 4, refused: 5, cmd: 7, atyp: 8 };
const strip = (ip) => String(ip || '').replace(/^::ffff:/, '');

export function isPrivate(ip) {
  const a = strip(ip);
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
  }
  const l = a.toLowerCase();
  return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

export function createProxy({ allow, allowPrivate = false, log = () => {}, idleMs = 120000 }) {
  const allowed = new Set((allow || []).map(strip));
  if (!allowed.size) throw new Error('허용 IP(ALLOW_IPS)가 비어 있어 시작하지 않습니다 — 아무나 쓰는 열린 프록시가 됩니다');
  return net.createServer((c) => {
    const from = strip(c.remoteAddress);
    c.on('error', () => {});
    if (!allowed.has(from)) {
      log(`거부: 허용 목록에 없는 주소 ${from}`);
      return c.destroy();
    }
    c.setTimeout(idleMs, () => c.destroy());
    let buf = Buffer.alloc(0);
    let stage = 'hello';
    const reply = (rep) => c.write(Buffer.from([5, rep, 0, 1, 0, 0, 0, 0, 0, 0]));
    const onData = async (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 'hello') {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf.length < 2 + buf[1]) return c.destroy();
        const methods = [...buf.subarray(2, 2 + buf[1])];
        buf = buf.subarray(2 + buf[1]);
        if (!methods.includes(0)) {
          c.write(Buffer.from([5, 0xff]));
          return c.destroy();
        }
        c.write(Buffer.from([5, 0]));
        stage = 'req';
      }
      if (stage === 'req') {
        if (buf.length < 5) return;
        if (buf[0] !== 5) return c.destroy();
        const atyp = buf[3];
        let host;
        let end;
        if (atyp === 1) {
          if (buf.length < 10) return;
          host = [...buf.subarray(4, 8)].join('.');
          end = 8;
        } else if (atyp === 3) {
          end = 5 + buf[4];
          if (buf.length < end + 2) return;
          host = buf.subarray(5, end).toString('utf8');
        } else if (atyp === 4) {
          if (buf.length < 22) return;
          host = Array.from({ length: 8 }, (_, i) => buf.readUInt16BE(4 + i * 2).toString(16)).join(':');
          end = 20;
        } else return (reply(REP.atyp), c.end());
        if (buf[1] !== 1) return (reply(REP.cmd), c.end());
        const port = buf.readUInt16BE(end);
        const rest = buf.subarray(end + 2);
        stage = 'connecting';
        c.removeListener('data', onData);
        c.pause();
        let addr = host;
        try {
          if (!net.isIP(host)) addr = (await dns.lookup(host)).address;
        } catch {
          log(`이름 못 찾음: ${host}`);
          return (reply(REP.host), c.end());
        }
        if (!allowPrivate && isPrivate(addr)) {
          log(`막음: 사설·내부 주소로 연결 시도 ${host} → ${addr}`);
          return (reply(REP.denied), c.end());
        }
        const up = net.connect({ host: addr, port });
        up.setTimeout(idleMs, () => up.destroy());
        up.on('error', (e) => {
          log(`연결 실패 ${host}:${port} (${e.code || e.message})`);
          if (!up.connecting && up.bytesWritten + up.bytesRead > 0) return c.destroy();
          reply(e.code === 'ECONNREFUSED' ? REP.refused : e.code === 'ENETUNREACH' ? REP.unreach : e.code === 'ETIMEDOUT' ? REP.host : REP.fail);
          c.end();
        });
        up.on('connect', () => {
          reply(REP.ok);
          if (rest.length) up.write(rest);
          c.pipe(up);
          up.pipe(c);
          c.on('close', () => up.destroy());
          up.on('close', () => c.destroy());
          c.resume();
        });
      }
    };
    c.on('data', (d) => onData(d).catch(() => c.destroy()));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const allow = (process.env.ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const port = Number(process.env.PORT || 1080);
  const bad = allow.filter((ip) => !net.isIP(strip(ip)));
  if (!allow.length || bad.length || !(port >= 1 && port <= 65535)) {
    console.error(`프록시 시작 실패\n단계: 설정 확인\n원인: ${!allow.length ? 'ALLOW_IPS(허용할 내 공인 IP)가 비어 있습니다' : bad.length ? `IP 형식이 아닙니다: ${bad.join(', ')}` : `PORT 가 1~65535 가 아닙니다 (${process.env.PORT})`}\n조치: 집·사무실 PC 에서 https://api.ipify.org 를 열어 나온 주소를 넣으세요. 예) ALLOW_IPS=203.0.113.7 PORT=1080 node tools/bypass-proxy/socks5-proxy.mjs`);
    process.exit(1);
  }
  const srv = createProxy({ allow, allowPrivate: process.env.ALLOW_PRIVATE_DEST === '1', log: (m) => console.log(`${new Date().toISOString()} ${m}`) });
  srv.on('error', (e) => {
    console.error(`프록시 시작 실패\n단계: 포트 열기\n원인: ${e.code === 'EADDRINUSE' ? `${port} 포트를 이미 다른 프로그램이 쓰고 있습니다` : e.code === 'EACCES' ? `${port} 포트를 열 권한이 없습니다` : e.message}\n조치: PORT=다른번호 로 다시 실행하세요.`);
    process.exit(1);
  });
  srv.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`SOCKS5 프록시 켜짐: 포트 ${port}, 허용 IP ${allow.join(', ')}`));
}
