import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 10000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 10001);
const ACCESS_PATH = process.env.ACCESS_PATH || 'C:/ProgramData/BinancePublicGateway/access.json';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
const targets = {
  upbit: { host: '127.0.0.1', port: 7070 },
  control: { host: '127.0.0.1', port: 3000 },
  spot: { host: '127.0.0.1', port: 7081 },
  futures: { host: '127.0.0.1', port: 7082 },
};

function readAccess() {
  try { return JSON.parse(fs.readFileSync(ACCESS_PATH, 'utf8')); } catch { return null; }
}
function configured() {
  const access = readAccess();
  return !!(access?.salt && access?.hash);
}
function verifyPassword(password) {
  const access = readAccess();
  if (!password || !access?.salt || !access?.hash) return false;
  const derived = crypto.scryptSync(password, Buffer.from(access.salt, 'base64'), 64);
  const expected = Buffer.from(access.hash, 'base64');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}
function setPassword(password) {
  if (password.length < 12) throw new Error('비밀번호는 12자 이상으로 설정하세요.');
  const salt = crypto.randomBytes(24);
  const hash = crypto.scryptSync(password, salt, 64);
  const body = JSON.stringify({ salt: salt.toString('base64'), hash: hash.toString('base64'), updatedAt: Date.now() }, null, 2);
  fs.mkdirSync(path.dirname(ACCESS_PATH), { recursive: true });
  const temp = `${ACCESS_PATH}.tmp`;
  fs.writeFileSync(temp, body, { mode: 0o600 });
  fs.renameSync(temp, ACCESS_PATH);
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function safeNext(value) {
  const text = String(value || '/');
  return text.startsWith('/') && !text.startsWith('//') ? text : '/';
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((row) => row.trim().split(/=(.*)/s, 2)).filter(([key]) => key));
}
function sessionValid(req) {
  const id = cookies(req).yt_public_session;
  const until = id ? sessions.get(id) : 0;
  if (!until || until <= Date.now()) { if (id) sessions.delete(id); return false; }
  return true;
}
function createSession() {
  const id = crypto.randomBytes(32).toString('base64url');
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  return id;
}
function loginPage(res, next, error = '') {
  const errorHtml = error ? `<p class="error">${error}</p>` : '';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YuJin Traders 외부 접속</title><style>body{margin:0;background:#0b1018;color:#edf4ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(420px,calc(100vw - 40px));padding:30px;border:1px solid #26384f;border-radius:18px;background:#101925}h1{margin-top:0;font-size:24px}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin-top:14px;color:#c7d7ee}input{margin-top:7px;padding:13px;border:1px solid #385477;border-radius:10px;background:#07111f;color:#fff}button{margin-top:20px;padding:14px;border:0;border-radius:10px;background:#2a7ce8;color:#fff;font-weight:800}.error{padding:10px;border-radius:9px;background:#481d27;color:#ffccd3}small{color:#92a3b8}</style><main class="box"><h1>YuJin Traders 외부 접속</h1><p>BLACK PC에서 설정한 공개 접근 비밀번호를 입력하세요.</p>${errorHtml}<form method="post" action="/login"><input type="hidden" name="next" value="${safeNext(next)}"><label>접근 비밀번호<input name="password" type="password" required autofocus autocomplete="current-password"></label><button type="submit">접속하기</button></form><p><small>비밀번호는 BLACK PC에 암호 해시로만 저장됩니다.</small></p></main></html>`);
}
function landing(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YuJin Traders Binance</title><style>body{margin:0;background:#0b1018;color:#edf4ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(440px,calc(100vw - 40px));padding:32px;border:1px solid #26384f;border-radius:18px;background:#101925}a{display:block;margin-top:14px;padding:16px;border-radius:12px;background:#17365f;color:#fff;text-decoration:none;font-weight:700}small{color:#92a3b8}</style><main class="box"><h1>YuJin Traders Binance</h1><p>현물 또는 USDⓈ-M 선물 터미널을 선택하세요.</p><a href="/spot/">바이낸스 현물</a><a href="/futures/">바이낸스 USDⓈ-M 선물</a><p><small>외부 접속 인증이 완료된 세션입니다.</small></p></main></html>`);
}
function resolveRoute(req, url) {
  const direct = url.pathname.match(/^\/(spot|futures|control)(?:\/(.*))?$/);
  if (direct) return { terminal: direct[1], path: `/${direct[2] || ''}` };
  try {
    const ref = new URL(String(req.headers.referer || ''));
    const inferred = ref.pathname.match(/^\/(spot|futures|control)(?:\/|$)/);
    if (inferred) return { terminal: inferred[1], path: `${url.pathname}${url.search}` };
  } catch { /* direct non-browser asset request */ }
  return null;
}
function externalService(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (host.endsWith(':8443')) return 'control';
  if (host && !host.endsWith(':10000')) return 'upbit';
  return null;
}
function rewriteHtml(html, terminal) {
  const rewritten = html.replace(/\b(href|src)=(['"])\/(?!\/)/g, `$1=$2/${terminal}/`);
  if (terminal !== 'control') return rewritten;
  const bridge = `<script>(function(){const p='/control';const root=window.fetch;window.fetch=function(i,o){if(typeof i==='string'&&i.startsWith('/api/'))i=p+i;else if(i instanceof Request&&new URL(i.url,location.href).origin===location.origin&&new URL(i.url,location.href).pathname.startsWith('/api/'))i=new Request(p+new URL(i.url,location.href).pathname+new URL(i.url,location.href).search,i);return root.call(this,i,o)};const ES=window.EventSource;window.EventSource=function(u,o){const v=typeof u==='string'&&u.startsWith('/api/')?p+u:u;return new ES(v,o)};window.EventSource.prototype=ES.prototype})();</script>`;
  return rewritten.replace('</head>', `${bridge}</head>`);
}
function proxy(req, res, route) {
  const target = targets[route.terminal];
  const headers = { ...req.headers, host: `${target.host}:${target.port}`, 'accept-encoding': 'identity', 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host || '' };
  delete headers.authorization;
  const upstream = http.request({ host: target.host, port: target.port, method: req.method, path: route.path, headers }, (upstreamRes) => {
    const contentType = String(upstreamRes.headers['content-type'] || '');
    if (!contentType.includes('text/html') || !['spot', 'futures', 'control'].includes(route.terminal)) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }
    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders['content-length'];
      delete responseHeaders['content-encoding'];
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      res.end(rewriteHtml(Buffer.concat(chunks).toString('utf8'), route.terminal));
    });
  });
  upstream.once('error', () => {
    if (!res.headersSent) sendJson(res, 502, { error: `${route.terminal === 'spot' ? '현물' : route.terminal === 'futures' ? '선물' : route.terminal === 'upbit' ? '업비트' : '관제실'} 프록시 연결 실패`, detail: 'BLACK PC 로컬 서비스 상태를 확인하세요.' });
  });
  req.pipe(upstream);
}
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > 16_384) reject(new Error('요청이 너무 큽니다.')); else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function setupPage(res, message = '') {
  const note = message ? `<p class="note">${message}</p>` : '';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Binance 공개 접근 설정</title><style>body{margin:0;background:#0b1018;color:#edf4ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(440px,calc(100vw - 40px));padding:30px;border:1px solid #26384f;border-radius:18px;background:#101925}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin-top:15px;color:#c7d7ee}input{margin-top:7px;padding:13px;border:1px solid #385477;border-radius:10px;background:#07111f;color:white}button{margin-top:20px;padding:14px;border:0;border-radius:10px;background:#2a7ce8;color:white;font-weight:800}.note{color:#7ee7a2}</style><main class="box"><h1>공개 접근 비밀번호</h1><p>이 페이지는 BLACK PC의 <b>127.0.0.1:${ADMIN_PORT}</b>에서만 열립니다. 비밀번호 원문은 저장하지 않고 암호 해시만 저장합니다.</p>${note}<form method="post"><label>새 비밀번호<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><label>비밀번호 확인<input name="confirm" type="password" minlength="12" required autocomplete="new-password"></label><button type="submit">공개 접근 비밀번호 저장</button></form></main></html>`);
}

const publicServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://gateway.local');
  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, port: PORT, configured: configured() });
  if (!configured()) return sendJson(res, 503, { error: '공개 접근 비밀번호 미설정', detail: `BLACK PC에서 http://127.0.0.1:${ADMIN_PORT} 를 열어 설정하세요.` });
  if (url.pathname === '/login' && req.method === 'GET') return loginPage(res, safeNext(url.searchParams.get('next')));
  if (url.pathname === '/login' && req.method === 'POST') {
    try {
      const body = new URLSearchParams(await readRequestBody(req));
      const next = safeNext(body.get('next'));
      if (!verifyPassword(String(body.get('password') || ''))) return loginPage(res, next, '비밀번호가 일치하지 않습니다.');
      const session = createSession();
      res.writeHead(303, { Location: next, 'Set-Cookie': `yt_public_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`, 'Cache-Control': 'no-store' });
      return res.end();
    } catch { return loginPage(res, '/', '로그인 요청을 처리하지 못했습니다.'); }
  }
  if (!sessionValid(req)) return loginPage(res, safeNext(`${url.pathname}${url.search}`));
  const explicitRoute = resolveRoute(req, url);
  if (explicitRoute) return proxy(req, res, explicitRoute);
  const forcedService = externalService(req);
  if (forcedService) return proxy(req, res, { terminal: forcedService, path: `${url.pathname}${url.search}` });
  if (url.pathname === '/') return landing(res);
  return sendJson(res, 404, { error: '경로 없음', detail: 'spot 또는 futures 경로를 사용하세요.' });
});
const adminServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://admin.local');
  if (url.pathname !== '/') return sendJson(res, 404, { error: '경로 없음' });
  if (req.method === 'GET') return setupPage(res, configured() ? '현재 공개 접근 비밀번호가 설정돼 있습니다. 새 값으로 변경할 수 있습니다.' : '아직 공개 접근 비밀번호가 설정되지 않았습니다.');
  if (req.method !== 'POST') return sendJson(res, 405, { error: '허용되지 않은 메서드' });
  try {
    const body = new URLSearchParams(await readRequestBody(req));
    const password = String(body.get('password') || '');
    const confirm = String(body.get('confirm') || '');
    if (password !== confirm) return setupPage(res, '비밀번호 확인값이 일치하지 않습니다.');
    setPassword(password);
    return setupPage(res, '저장 완료 · 외부 URL에서 이 비밀번호로 접속하세요.');
  } catch (error) { return setupPage(res, error instanceof Error ? error.message : '저장에 실패했습니다.'); }
});

publicServer.keepAliveTimeout = 65_000;
publicServer.listen(PORT, '127.0.0.1', () => console.log(`Public trading gateway listening on 127.0.0.1:${PORT}`));
adminServer.listen(ADMIN_PORT, '127.0.0.1', () => console.log(`Public access setup listening on 127.0.0.1:${ADMIN_PORT}`));
