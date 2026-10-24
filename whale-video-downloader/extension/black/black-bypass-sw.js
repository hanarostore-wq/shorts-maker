// 블랙전용(개인용 기능) — HTTP 451 우회(서비스워커 쪽). 유료판에서는 tools/make-paid.mjs 가 이 파일과 import 줄을 뺀다.
//  - 보관: chrome.storage.local 의 blackBypass {on, proxy, hosts} — 설정(settings)과 따로 두어 내보내기·동기화에 들어가지 않는다.
//  - 451 이 뜬 탭에는 아래쪽에 [우회로 다시 열기] 띠를 넣는다. 눌러야만 그 사이트가 프록시 목록에 들어간다(몰래 돌리지 않음).
//  - 프록시는 PAC 로 '목록의 사이트만' 돌린다. 다른 확장이 프록시를 쥐고 있으면 덮어쓰지 않고 이유를 알린다.
import { normalizeHost, parseProxy, planBypass } from './black-bypass-core.js';

const KEY = 'blackBypass';
const err = (step, reason, action) => ({ error: { step, reason, action } });
const ext = (sender) => sender.id === chrome.runtime.id && String(sender.url || '').startsWith(`chrome-extension://${chrome.runtime.id}/`);
const read = async () => ({ on: false, proxy: '', hosts: [], ...((await chrome.storage.local.get(KEY))[KEY] || {}) });
const write = (s) => chrome.storage.local.set({ [KEY]: s });
let lock = Promise.resolve();
const serial = (fn) => {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
};

// 지금 설정을 브라우저 프록시에 반영한다. 돌려주는 값: {applied, ...} 또는 {error}
async function apply(state) {
  if (!chrome.proxy?.settings) return err('프록시 권한 확인', '프록시 권한이 없습니다', '팝업 블랙전용 → 451 우회에서 프록시 주소를 저장할 때 나오는 권한 묻기에서 [허용]을 누르세요.');
  let cur;
  try {
    cur = await chrome.proxy.settings.get({ incognito: false });
  } catch (e) {
    return err('프록시 현재 상태 읽기', `브라우저가 프록시 설정을 알려 주지 않았습니다 (${e?.message || e})`, '확장프로그램을 껐다 켠 뒤 다시 해 보세요.');
  }
  const mine = cur.levelOfControl === 'controlled_by_this_extension';
  const plan = planBypass(state);
  if (!plan.apply) {
    if (plan.why === 'bad-proxy') return plan;
    if (mine) await chrome.proxy.settings.clear({ scope: 'regular' }).catch(() => {});
    return { applied: false, why: plan.why };
  }
  if (cur.levelOfControl === 'controlled_by_other_extensions' || cur.levelOfControl === 'not_controllable') {
    return err('프록시 설정 쓰기', cur.levelOfControl === 'not_controllable' ? '이 브라우저는 확장이 프록시를 바꾸지 못하게 막혀 있습니다(관리자 정책)' : '다른 확장프로그램이 브라우저 프록시를 이미 쥐고 있습니다', '다른 프록시·VPN 확장을 끄고 다시 켜세요. 그 확장의 프록시가 켜져 있으면 이 우회는 동작하지 않습니다.');
  }
  try {
    await chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: plan.pacData } }, scope: 'regular' });
  } catch (e) {
    return err('프록시 설정 쓰기', `브라우저가 프록시 설정을 받지 않았습니다 (${e?.message || e})`, '프록시 주소를 다시 확인해 저장하세요.');
  }
  return { applied: true, hosts: plan.hosts, proxy: plan.proxy.normalized };
}

const view = (s) => ({ on: s.on, proxy: s.proxy, hosts: s.hosts });
const hasPerm = () => chrome.permissions.contains({ permissions: ['proxy'] }).catch(() => false);

// 시작할 때·권한이 생겼을 때 한 번 맞춰 둔다(브라우저가 설정을 기억해도 목록과 어긋나 있지 않게)
const sync = () => serial(async () => (await hasPerm()) && apply(await read())).catch(() => {});
chrome.runtime.onStartup.addListener(sync);
chrome.runtime.onInstalled.addListener(sync);

// ── 451 감지: 문서 응답이 451 이면 그 탭을 기억했다가 다 불러온 뒤 띠를 넣는다 ──
const hit = new Map(); // tabId → {url, host}
chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (d.statusCode !== 451 || d.tabId < 0) return;
    const r = normalizeHost(d.url);
    if (r.host) hit.set(d.tabId, { url: d.url, host: r.host });
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
);
chrome.webRequest.onBeforeRequest.addListener((d) => void hit.delete(d.tabId), { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
chrome.tabs.onRemoved.addListener((id) => hit.delete(id));
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const h = hit.get(tabId);
  if (info.status !== 'complete' || !h) return;
  hit.delete(tabId);
  try {
    const s = await read();
    const routed = s.on && s.hosts.includes(h.host);
    await chrome.scripting.executeScript({
      target: { tabId },
      func: injectBar,
      args: [
        routed
          ? '우회 프록시로 열었는데도 451 입니다. 프록시가 한국 안에 있거나 같은 클라우드플레어 서버를 쓰는 것 같습니다 — 한국 밖(일본·미국 등) 프록시로 바꿔 보세요.'
          : '이 사이트는 한국 안 서버에서 법적 사유(451)로 막혔습니다. 한국 밖 프록시로 이 사이트만 돌려서 열 수 있습니다.',
        routed ? '' : '우회로 다시 열기',
      ],
    });
  } catch {
    // 띠를 못 넣는 탭(보호된 페이지 등)은 건너뜀 — 팝업에서 직접 사이트를 추가할 수 있다
  }
});

// 탭 안에 넣는 띠(이 함수는 그대로 페이지에 들어가므로 바깥 변수를 쓰지 않는다)
function injectBar(text, button) {
  if (document.getElementById('smd-bypass-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'smd-bypass-bar';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:12px;align-items:center;padding:10px 14px;background:#111;color:#fff;font:14px/1.4 sans-serif;box-shadow:0 -2px 8px rgba(0,0,0,.4)';
  const t = document.createElement('span');
  t.style.flex = '1';
  t.textContent = text;
  bar.append(t);
  const show = (msg) => (t.textContent = msg);
  if (button) {
    const b = document.createElement('button');
    b.textContent = button;
    b.style.cssText = 'padding:6px 12px;border:0;border-radius:6px;background:#4f8cff;color:#fff;font:inherit;cursor:pointer';
    b.onclick = async () => {
      b.disabled = true;
      show('우회 설정 중…');
      try {
        const r = await chrome.runtime.sendMessage({ type: 'smd:bypass-add-here' });
        if (r?.error) {
          b.disabled = false;
          return show(`우회 실패\n단계: ${r.error.step}\n원인: ${r.error.reason}\n조치: ${r.error.action}`);
        }
        location.reload();
      } catch (e) {
        b.disabled = false;
        show(`우회 실패\n단계: 확장 백그라운드 연결\n원인: ${e?.message || e}\n조치: 확장프로그램을 껐다 켠 뒤 페이지를 새로고침하세요.`);
      }
    };
    bar.append(b);
  }
  const x = document.createElement('button');
  x.textContent = '×';
  x.setAttribute('aria-label', '닫기');
  x.style.cssText = 'border:0;background:none;color:#fff;font-size:18px;cursor:pointer';
  x.onclick = () => bar.remove();
  bar.append(x);
  t.style.whiteSpace = 'pre-line';
  document.documentElement.append(bar);
}

// ── 메시지 ──
const handlers = {
  // 451 띠의 [우회로 다시 열기]: 호스트는 메시지가 아니라 브라우저가 알려 준 탭 주소로 정한다
  async 'smd:bypass-add-here'(msg, sender) {
    if (sender.frameId !== 0 || !sender.tab) return err('사이트 찾기', '우회할 탭을 브라우저가 알려 주지 않았습니다', '팝업 블랙전용 → 451 우회에서 사이트를 직접 추가하세요.');
    const r = normalizeHost(sender.url);
    if (r.error) return r;
    if (!(await hasPerm())) return err('프록시 권한 확인', '프록시 권한이 아직 없습니다', '먼저 팝업 블랙전용 → 451 우회에서 프록시 주소를 저장하고 권한을 허용하세요.');
    return serial(async () => {
      const s = await read();
      if (parseProxy(s.proxy).error) return err('프록시 주소 확인', s.proxy ? '저장된 프록시 주소를 읽지 못했습니다' : '프록시 주소가 아직 없습니다', '팝업 블랙전용 → 451 우회에서 한국 밖 프록시 주소를 저장하세요.');
      const next = { ...s, on: true, hosts: [...new Set([...s.hosts, r.host])] };
      const a = await apply(next);
      if (a.error) return a;
      await write(next);
      return { ok: true, host: r.host };
    });
  },
  // ── 팝업(블랙전용 탭) ──
  async 'smd:bypass-get'(msg, sender) {
    if (!ext(sender)) return err('우회 설정 보기', '확장 팝업에서만 볼 수 있습니다', '');
    return { ...view(await read()), permission: await hasPerm() };
  },
  async 'smd:bypass-save'(msg, sender) {
    if (!ext(sender)) return err('우회 설정 저장', '확장 팝업에서만 할 수 있습니다', '');
    const proxy = String(msg.proxy ?? '').trim();
    let norm = '';
    if (proxy) {
      const p = parseProxy(proxy);
      if (p.error) return p;
      norm = p.normalized;
    } else if (msg.on) return err('프록시 주소 확인', '프록시 주소를 입력하지 않았습니다', '한국 밖에 있는 프록시를 socks5://주소:포트 형식으로 넣으세요.');
    if (msg.on && !(await hasPerm())) return err('프록시 권한 확인', '프록시 권한이 없습니다', '[저장]을 다시 누르고 권한 묻기 창에서 [허용]을 누르세요.');
    return serial(async () => {
      const next = { ...(await read()), proxy: norm, on: !!msg.on };
      const a = await apply(next);
      if (a.error) return a;
      await write(next);
      return { ...view(next), applied: a.applied };
    });
  },
  async 'smd:bypass-host'(msg, sender) {
    if (!ext(sender)) return err('사이트 바꾸기', '확장 팝업에서만 할 수 있습니다', '');
    let host = '';
    if (msg.add) {
      const r = normalizeHost(msg.add);
      if (r.error) return r;
      host = r.host;
    }
    return serial(async () => {
      const s = await read();
      let hosts = s.hosts;
      if (msg.add) hosts = [...new Set([...hosts, host])];
      else if (msg.remove) {
        if (!hosts.includes(msg.remove)) return err('사이트 빼기', `"${msg.remove}" 은(는) 목록에 없습니다(이미 뺌)`, '목록을 다시 여세요.');
        hosts = hosts.filter((h) => h !== msg.remove);
      }
      const next = { ...s, hosts };
      if (next.on) {
        const a = await apply(next);
        if (a.error) return a;
      }
      await write(next);
      return view(next);
    });
  },
  // 시험: 그 사이트에 프록시를 거쳐 요청을 보내 451 이 풀렸는지 본다
  async 'smd:bypass-test'(msg, sender) {
    if (!ext(sender)) return err('연결 시험', '확장 팝업에서만 할 수 있습니다', '');
    const r = normalizeHost(msg.host);
    if (r.error) return r;
    const s = await read();
    if (!s.on || !s.hosts.includes(r.host)) return err('연결 시험', `"${r.host}" 은(는) 지금 우회 중이 아닙니다 (스위치가 꺼져 있거나 목록에 없음)`, '스위치를 켜고 사이트를 목록에 넣은 뒤 다시 시험하세요.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(`https://${r.host}/`, { method: 'GET', cache: 'no-store', signal: ctl.signal });
      if (res.status === 451) return err('연결 시험', `프록시를 거쳤는데도 ${r.host} 가 451 을 돌려줍니다 — 프록시가 한국 안이거나 같은 클라우드플레어 서버를 쓰는 듯합니다`, '한국 밖(일본·미국 등) 프록시로 바꿔 저장한 뒤 다시 시험하세요.');
      return { ok: true, host: r.host, status: res.status };
    } catch (e) {
      const timeout = e?.name === 'AbortError';
      return err('연결 시험', timeout ? `프록시가 12초 안에 응답하지 않았습니다 (${s.proxy})` : `프록시로 ${r.host} 에 연결하지 못했습니다 (${e?.message || e})`, '프록시 주소·포트가 맞는지, 프록시 서버가 켜져 있는지, 로그인이 필요한 프록시는 아닌지 확인하세요.');
    } finally {
      clearTimeout(timer);
    }
  },
};

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  const h = handlers[msg?.type];
  if (!h) return;
  h(msg, sender).then(send, (e) => send(err('451 우회', String(e?.message || e), '확장을 최신으로 업데이트한 뒤 다시 해 보세요. 계속되면 이 안내를 그대로 보내 주세요.')));
  return true;
});
