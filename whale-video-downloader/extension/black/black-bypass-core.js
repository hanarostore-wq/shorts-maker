// 블랙전용(개인용 기능) — HTTP 451(법적 사유로 이용 불가) 우회 공용 함수(서비스워커·단위 시험에서 씀). 유료판에서는 black/ 째 빠진다.
//  - 451 은 클라우드플레어가 '한국 안에 있는 서버'로 들어온 접속을 막는 것이라, 한국 밖 프록시로 그 사이트만 돌려서 연다.
//  - 프록시 서버는 사용자가 직접 정한다(확장이 대신 구해 주지 않음). 막힌 사이트 호스트에만 프록시를 쓰고 나머지는 직접 연결.

// 사이트 이름 정리: 주소·호스트 어느 쪽을 넣어도 호스트 이름만(앞의 www. 는 뺌 → 하위 도메인까지 같이 돌림)
export function normalizeHost(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return { error: { step: '사이트 이름 확인', reason: '사이트를 입력하지 않았습니다', action: '막힌 사이트 주소(예: example.com)를 넣으세요.' } };
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return { error: { step: '사이트 이름 확인', reason: `"${input}" 은(는) 주소로 읽을 수 없습니다`, action: '막힌 사이트 주소(예: example.com)를 다시 넣으세요.' } };
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || /^\d+$/.test(host.split('.').pop())) {
    return { error: { step: '사이트 이름 확인', reason: `"${host}" 은(는) 인터넷 사이트 이름이 아닙니다 (IP 주소·localhost 는 지원하지 않음)`, action: 'example.com 처럼 도메인 이름을 넣으세요.' } };
  }
  return { host };
}

// 프록시 주소 읽기: socks5://호스트:포트 · http://호스트:포트 · https://호스트:포트 (아이디·비밀번호 입력 방식은 브라우저가 지원하지 않아 받지 않음)
export function parseProxy(input) {
  const raw = String(input ?? '').trim();
  const fix = (reason, action) => ({ error: { step: '프록시 주소 확인', reason, action } });
  if (!raw) return fix('프록시 주소를 입력하지 않았습니다', '한국 밖에 있는 프록시를 socks5://주소:포트 형식으로 넣으세요.');
  const m = raw.match(/^([a-z0-9]+):\/\/(.+)$/i);
  if (!m) return fix(`"${raw}" 에 방식(socks5:// · http:// · https://)이 없습니다`, '예: socks5://203.0.113.5:1080');
  const scheme = m[1].toLowerCase();
  const token = { socks5: 'SOCKS5', socks4: 'SOCKS', http: 'PROXY', https: 'HTTPS' }[scheme];
  if (!token) return fix(`"${scheme}://" 방식은 지원하지 않습니다`, 'socks5:// · socks4:// · http:// · https:// 중 하나로 넣으세요.');
  if (/[@\s]/.test(m[2])) return fix('아이디·비밀번호(user:pass@)나 공백이 들어 있습니다 — 브라우저 확장은 프록시 로그인을 지원하지 않습니다', '로그인 없이 쓸 수 있는 프록시(허용 IP 등록 방식)를 쓰거나 주소만 넣으세요.');
  const hp = m[2].replace(/\/+$/, '').match(/^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?):(\d{1,5})$/i);
  const port = hp ? Number(hp[3]) : 0;
  if (!hp || port < 1 || port > 65535) return fix(`"${m[2]}" 에서 주소:포트를 읽지 못했습니다`, '예: socks5://203.0.113.5:1080 (포트는 1~65535)');
  return { scheme, host: hp[1], port, pac: `${token} ${hp[1]}:${port}`, normalized: `${scheme}://${hp[1]}:${port}` };
}

// 막힌 사이트(와 그 하위 도메인)만 프록시로, 나머지는 직접 — 프록시가 죽어도 몰래 직접 연결로 돌아가지 않게 프록시만 적는다
export function buildPac(hosts, pac) {
  return `function FindProxyForURL(url, host) {\n  var list = ${JSON.stringify(hosts)};\n  host = host.toLowerCase();\n  for (var i = 0; i < list.length; i++) {\n    if (host === list[i] || dnsDomainIs(host, "." + list[i])) return ${JSON.stringify(pac)};\n  }\n  return "DIRECT";\n}\n`;
}

// 현재 상태 → 적용 계획: 프록시 설정을 넣을지 끌지, 못 넣으면 이유
export function planBypass(state) {
  const s = state || {};
  const hosts = [...new Set((s.hosts || []).filter(Boolean))];
  if (!s.on) return { apply: false, why: 'off' };
  if (!hosts.length) return { apply: false, why: 'no-hosts' };
  const p = parseProxy(s.proxy);
  if (p.error) return { apply: false, why: 'bad-proxy', error: p.error };
  return { apply: true, pacData: buildPac(hosts, p.pac), proxy: p, hosts };
}
