// 블랙전용(개인용 기능) — 비밀번호 자동 입력·저장(페이지 쪽, 맨 위 창만). 유료판에서는 black/ 째 빠진다.
//  - 저장된 계정이 하나면 아이디·비밀번호 칸을 바로 채우고, 여러 개(또는 같은 상위 도메인의 다른 주소)면 칸을 누를 때 고르는 목록
//  - 로그인(제출·로그인 단추·Enter)하는 순간 아이디·비밀번호를 서비스워커에 보내 저장(확인 창 없이) → 화면 아래 '저장했습니다 [되돌리기]'
//  - 비밀번호는 페이지 기록(console)·화면 글자에 남기지 않는다
(() => {
  'use strict';
  if (globalThis.__SMD_OFF) return; // 이 사이트 제외(content/off.js)
  if (globalThis.__SMD_BLACK_PW || window.top !== window || location.protocol === 'chrome-extension:') return;
  globalThis.__SMD_BLACK_PW = true;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const ask = (msg) => (alive() ? chrome.runtime.sendMessage(msg) : Promise.reject(new Error('확장프로그램 연결이 끊김')));

  // ── 칸 찾기 ──
  const shown = (el) => {
    if (!el.isConnected || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const USER_TYPES = /^(text|email|tel|)$/i;
  // 비밀번호 칸 앞쪽의 아이디 칸: 폼이 있으면 폼 안, 없으면 비밀번호 칸에서 한 단계씩 넓혀 가며 찾는다
  function userFieldFor(pw) {
    const pick = (scope) => {
      const all = [...scope.querySelectorAll('input')];
      for (let i = all.indexOf(pw) - 1; i >= 0; i--) {
        const el = all[i];
        if (el.type === 'password') break; // 앞쪽 다른 로그인 칸 묶음까지 넘어가지 않음
        if (USER_TYPES.test(el.type || '') && shown(el) && !/search|captcha|otp|code/i.test(`${el.name} ${el.id} ${el.autocomplete} ${el.type}`)) return el;
      }
      return null;
    };
    if (pw.form) return pick(pw.form);
    for (let p = pw.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) {
      const found = pick(p);
      if (found) return found;
      if (p === document.body) break;
    }
    return null;
  }
  const pwFields = () => [...document.querySelectorAll('input[type="password"]')].filter(shown);

  // ── 값 넣기(React 등 사이트가 알아채도록 input·change 이벤트) ──
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function put(el, v) {
    if (!el) return;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fillPair(pw, cred) {
    const u = userFieldFor(pw);
    if (u && cred.username) put(u, cred.username);
    put(pw, cred.password);
  }

  // ── 알림(화면 아래) ──
  let toastHost = null;
  function toast(text, { err = false, undo = null } = {}) {
    toastHost?.remove();
    toastHost = document.createElement('smd-pw-toast');
    toastHost.setAttribute('style', 'all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647');
    const sh = toastHost.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>.t{display:flex;gap:10px;align-items:center;max-width:440px;padding:10px 14px;border-radius:12px;background:${err ? 'rgba(150,20,40,.96)' : 'rgba(20,20,30,.94)'};color:#fff;font:600 12.5px/1.5 "Malgun Gothic",system-ui,sans-serif;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.4)}button{all:unset;cursor:pointer;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.16);font-weight:800}</style><div class="t"><span class="m"></span></div>`;
    sh.querySelector('.m').textContent = text;
    if (undo) {
      const b = document.createElement('button');
      b.textContent = '되돌리기';
      b.addEventListener('click', undo);
      sh.querySelector('.t').appendChild(b);
    }
    (document.body || document.documentElement).appendChild(toastHost);
    const me = toastHost;
    setTimeout(() => me.remove(), err ? 12000 : 8000);
  }
  const errText = (what, e) => `${what} 실패\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action || '페이지를 새로고침(F5)한 뒤 다시 해 보세요.'}`;
  function savedToast(r) {
    const who = r.username ? ` (${r.username})` : '';
    toast(r.result === 'updated' ? `비밀번호를 새 것으로 바꿔 저장했습니다${who}` : `비밀번호를 저장했습니다${who}`, {
      undo: async () => {
        try {
          const u = await ask({ type: 'smd:pw-undo', id: r.id });
          if (u?.error) toast(errText('저장 되돌리기', u.error), { err: true });
          else toast(u.result === 'updated' ? '이전 비밀번호로 되돌렸습니다' : '저장을 취소했습니다');
        } catch (e) {
          toast(errText('저장 되돌리기', { step: '확장프로그램 연결', reason: e.message, action: '팝업 블랙전용 → 비밀번호 목록에서 직접 지우세요.' }), { err: true });
        }
      },
    });
  }

  // ── 고르는 목록(칸 아래) ──
  let menu = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  function openMenu(field, pw, data) {
    closeMenu();
    const list = [...data.exact.map((c) => ({ c, label: c.username || '(아이디 없음)' })), ...data.near.map((c) => ({ c, label: `${c.username || '(아이디 없음)'} · ${c.host}` }))];
    if (!list.length) return;
    const r = field.getBoundingClientRect();
    menu = document.createElement('smd-pw-menu');
    menu.setAttribute('style', `all:initial;position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px;z-index:2147483647`);
    const sh = menu.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>.b{min-width:${Math.max(200, Math.round(r.width))}px;max-width:360px;padding:6px;border-radius:10px;background:#1b1b26;box-shadow:0 8px 24px rgba(0,0,0,.45);font:600 12.5px/1.4 "Malgun Gothic",system-ui,sans-serif;color:#eee}.h{padding:4px 8px;color:#9aa;font-size:11px}button{all:unset;display:block;box-sizing:border-box;width:100%;cursor:pointer;padding:7px 8px;border-radius:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button:hover{background:rgba(255,255,255,.1)}</style><div class="b"><div class="h">저장된 계정</div></div>`;
    for (const { c, label } of list) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('mousedown', async (ev) => {
        ev.preventDefault();
        closeMenu();
        try {
          const cred = c.password !== undefined ? c : await ask({ type: 'smd:pw-pick', id: c.id });
          if (cred?.error) return toast(errText('자동 입력', cred.error), { err: true });
          fillPair(pw, cred);
        } catch (e) {
          toast(errText('자동 입력', { step: '확장프로그램 연결', reason: e.message, action: '페이지를 새로고침(F5)한 뒤 다시 누르세요.' }), { err: true });
        }
      });
      sh.querySelector('.b').appendChild(b);
    }
    (document.body || document.documentElement).appendChild(menu);
  }
  addEventListener('scroll', closeMenu, true);
  addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu(), true);

  // ── 페이지의 저장 항목 ──
  let data = null;
  let loading = null;
  const getData = () =>
    (loading ||= ask({ type: 'smd:pw-query' })
      .then((r) => {
        if (r?.error) toast(errText('비밀번호 불러오기', r.error), { err: true });
        data = r?.on ? r : { on: false, exact: [], near: [] };
        return data;
      })
      .catch(() => (data = { on: false, exact: [], near: [] })));

  const seen = new WeakSet();
  async function scan() {
    const pws = pwFields().filter((p) => !seen.has(p));
    if (!pws.length) return;
    const d = await getData();
    if (!d.on) return;
    for (const pw of pws) {
      seen.add(pw);
      const u = userFieldFor(pw);
      // 저장된 계정이 하나뿐이고 칸이 비어 있으면 바로 채움(크롬처럼)
      if (d.exact.length === 1 && !pw.value && !(u && u.value && u.value !== d.exact[0].username)) fillPair(pw, d.exact[0]);
      // 여러 개면 칸을 누를 때 고르기
      if (d.exact.length + d.near.length > (d.exact.length === 1 ? 1 : 0)) {
        for (const f of [u, pw].filter(Boolean)) f.addEventListener('focus', () => openMenu(f, pw, d));
        for (const f of [u, pw].filter(Boolean)) f.addEventListener('blur', () => setTimeout(closeMenu, 150));
      }
    }
  }

  // ── 로그인 순간 저장 ──
  let last = '';
  let lastAt = 0;
  async function capture(pw) {
    if (!pw?.value) return;
    const u = userFieldFor(pw);
    const sig = `${u?.value || ''}\u0000${pw.value}`;
    if (sig === last && Date.now() - lastAt < 4000) return;
    last = sig;
    lastAt = Date.now();
    try {
      const r = await ask({ type: 'smd:pw-capture', username: u?.value || '', password: pw.value });
      if (r?.error) return toast(errText('비밀번호 저장', r.error), { err: true });
      if (r?.result === 'added' || r?.result === 'updated') {
        loading = null; // 다음 조회에 새 값
        savedToast({ ...r, username: u?.value || '' });
        // 이 화면에 알림이 1.5초 넘게 남아 있으면(페이지가 안 바뀌면) 다음 페이지에서 또 알리지 않게 지운다.
        // 바로 다른 페이지로 넘어가면 이 타이머는 돌지 않고, 다음 페이지가 알림을 띄운다.
        setTimeout(() => ask({ type: 'smd:pw-recent' }).catch(() => {}), 1500);
      }
    } catch (e) {
      toast(errText('비밀번호 저장', { step: '확장프로그램 연결', reason: e.message, action: '페이지를 새로고침(F5)한 뒤 다시 로그인하세요.' }), { err: true });
    }
  }
  const pwOf = (el) => (el?.type === 'password' ? el : (el?.closest('form') || document).querySelector?.('input[type="password"]'));
  addEventListener('submit', (e) => capture([...(e.target.querySelectorAll?.('input[type="password"]') || [])].find((p) => p.value)), true);
  addEventListener(
    'click',
    (e) => {
      const b = e.target?.closest?.('button, input[type="submit"], [role="button"]');
      if (!b) return;
      const isSubmit = b.type === 'submit' || /로그인|log\s*in|sign\s*in|signin|login|확인|다음|next/i.test(`${b.textContent} ${b.value || ''} ${b.getAttribute('aria-label') || ''}`);
      if (!isSubmit) return;
      const pw = pwOf(b);
      if (pw && shown(pw)) capture(pw);
    },
    true,
  );
  addEventListener('keydown', (e) => e.key === 'Enter' && e.target?.type === 'password' && capture(e.target), true);

  // ── 시작 ──
  // 로그인 직후 다음 페이지: 방금 저장한 것 알리기
  ask({ type: 'smd:pw-recent' }).then((r) => r?.result && savedToast(r), () => {});
  let t = 0;
  const later = () => {
    clearTimeout(t);
    t = setTimeout(scan, 300);
  };
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
  later();
})();
