// 블루스카이 페이지 쪽(MAIN world): 앱이 보내는 요청의 최신 로그인 토큰을 확장 쪽(bsky-tools.js)에 알려 준다.
//   블루스카이는 토큰을 스스로 새로 고치는데 localStorage 값은 늦게 바뀌는 일이 있어, 팔로우가 '로그인 만료'로 실패하는 것을 막는다.
//   토큰은 같은 페이지 안에서 이벤트로만 넘기고 저장·기록하지 않는다.
(() => {
  if (window.__smdBskyHook) return;
  window.__smdBskyHook = true;
  let last = '';
  const tell = (url, auth) => {
    try {
      if (!auth || !/^Bearer\s/i.test(auth) || !/\/xrpc\//.test(url)) return;
      const base = new URL(url, location.href).origin;
      const key = `${base}|${auth}`;
      if (key === last) return;
      last = key;
      document.dispatchEvent(new CustomEvent('__smd_bsky_auth', { detail: JSON.stringify({ auth, base }) }));
    } catch {}
  };
  const authOf = (h) => {
    if (!h) return '';
    if (typeof h.get === 'function') return h.get('authorization') || '';
    if (Array.isArray(h)) return (h.find(([k]) => /^authorization$/i.test(k)) || [])[1] || '';
    for (const k of Object.keys(h)) if (/^authorization$/i.test(k)) return h[k];
    return '';
  };
  const of = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      tell(url, authOf(init?.headers) || (input instanceof Request ? input.headers.get('authorization') : ''));
    } catch {}
    return of.apply(this, arguments);
  };
})();
