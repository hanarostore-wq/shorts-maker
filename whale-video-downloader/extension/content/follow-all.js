// 팔로우 목록 전부 팔로우 (블루스카이·X, ISOLATED world)
//  - 블루스카이 /profile/{계정}/follows·followers, X /{계정}/following·followers·verified_followers 화면 오른쪽 아래에 버튼
//  - 이미 팔로우 중인 계정·내 계정·차단 관계 계정은 건너뛴다. 진행 중 언제든 '중지'
//  - 짧은 시간에 너무 많이 팔로우하면 사이트가 계정을 제한할 수 있어 한 명씩 간격을 두고 천천히 진행한다
//    (블루스카이 약 1.2초, X 3~5초 간격 · X 는 하루 400명 제한이 있어 그 전에 멈춤)
(() => {
  'use strict';
  if (globalThis.__SMD_FOLLOWALL || window.top !== window) return;
  globalThis.__SMD_FOLLOWALL = true;
  const site = /(^|\.)bsky\.app$/.test(location.hostname) ? 'bsky' : /(^|\.)(x|twitter)\.com$/.test(location.hostname) ? 'x' : '';
  if (!site) return;

  let on = true;
  chrome.storage.local.get('settings').then((r) => {
    on = r.settings?.followAllButton !== false;
    tick();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      on = c.settings.newValue?.followAllButton !== false;
      tick();
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const X_DAILY = 400; // X 하루 팔로우 한도
  const X_RESERVED = ['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose'];

  // 지금 화면이 팔로우 목록인가 → { actor, kind }
  function listPage() {
    const p = location.pathname;
    if (site === 'bsky') {
      const m = /^\/profile\/([^/]+)\/(follows|followers)\/?$/.exec(p);
      return m ? { actor: decodeURIComponent(m[1]), kind: m[2] } : null;
    }
    const m = /^\/([A-Za-z0-9_]{1,15})\/(following|followers|verified_followers)\/?$/.exec(p);
    return m && !X_RESERVED.includes(m[1].toLowerCase()) ? { actor: m[1], kind: m[2] } : null;
  }

  // ── 화면 ──
  let host = null;
  let ui = null;
  let run = null; // { stop: bool }
  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement('smd-followall');
    host.setAttribute('style', 'all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646');
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      .box{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font:600 12.5px/1.4 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif}
      button{all:unset;cursor:pointer;padding:9px 16px;border-radius:999px;color:#fff;font-weight:800;background:linear-gradient(135deg,#0a7aff,#5b5cff);box-shadow:0 4px 16px rgba(0,0,0,.35)}
      button.stop{background:#e0245e}
      button[hidden]{display:none}
      .msg{max-width:320px;padding:8px 12px;border-radius:12px;background:rgba(15,15,25,.92);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:pre-line}
      .msg.err{background:rgba(150,20,40,.95)}
      .msg:empty{display:none}
    </style><div class="box"><div class="msg"></div><button class="go" type="button">이 목록 전부 팔로우</button><button class="stop" type="button" hidden>중지</button></div>`;
    ui = { msg: sh.querySelector('.msg'), go: sh.querySelector('.go'), stop: sh.querySelector('.stop') };
    ui.go.addEventListener('click', start);
    ui.stop.addEventListener('click', () => run && (run.stop = true));
    document.documentElement.appendChild(host);
  }
  const say = (text, err = false) => {
    ui.msg.textContent = text;
    ui.msg.classList.toggle('err', err);
  };
  function tick() {
    const lp = on && listPage();
    if (!lp && !run) {
      host?.remove();
      return;
    }
    ensure();
    ui.go.hidden = !!run;
    ui.stop.hidden = !run;
  }

  async function start() {
    const lp = listPage();
    if (!lp || run) return;
    run = { stop: false };
    tick();
    try {
      await (site === 'bsky' ? runBsky(lp) : runX(lp));
    } catch (err) {
      say(`전부 팔로우 실패\n단계: ${err.step || '진행'}\n원인: ${err.reason || err.message || err}\n조치: ${err.action || '페이지를 새로고침한 뒤 다시 누르세요.'}`, true);
    } finally {
      run = null;
      tick();
    }
  }
  const confirmRun = (n, skipped, eta) =>
    window.confirm(`${n}명을 팔로우합니다${skipped ? ` (이미 팔로우 중·내 계정·차단 ${skipped}명 제외)` : ''}.\n\n짧은 시간에 너무 많이 팔로우하면 사이트가 계정을 일시 제한할 수 있어 한 명씩 천천히 진행합니다 (예상 ${eta}).\n진행 중에는 이 탭을 닫거나 새로고침하지 마세요. '중지'로 언제든 멈출 수 있습니다.\n\n시작할까요?`);
  const mins = (sec) => (sec < 90 ? `${Math.max(1, Math.round(sec))}초` : `${Math.round(sec / 60)}분`);

  // ── 블루스카이: 목록 API 로 전부 읽은 뒤 한 명씩 팔로우 기록 생성 ──
  async function runBsky({ actor, kind }) {
    const B = globalThis.__SMD_BSKY;
    const s = B?.session();
    if (!s) throw { step: '로그인 확인', reason: '블루스카이 로그인 정보를 찾지 못했습니다', action: '블루스카이에 로그인한 뒤 새로고침하세요.' };
    const nsid = kind === 'follows' ? 'app.bsky.graph.getFollows' : 'app.bsky.graph.getFollowers';
    const all = [];
    let cursor = '';
    do {
      if (run.stop) return say('목록 읽기를 중지했습니다. 팔로우한 계정은 없습니다.');
      say(`목록 읽는 중… ${all.length}명`);
      let j;
      try {
        j = await B.xrpc(s, 'GET', nsid, { params: `actor=${encodeURIComponent(actor)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, proxy: true });
      } catch (err) {
        throw { step: '목록 읽기', ...err };
      }
      all.push(...(j.follows || j.followers || []));
      cursor = j.cursor || '';
    } while (cursor && all.length < 20000);
    const targets = all.filter((p) => p.did && p.did !== s.did && !p.viewer?.following && !p.viewer?.blocking && !p.viewer?.blockedBy);
    if (!targets.length) return say(`목록 ${all.length}명을 모두 이미 팔로우 중이거나 팔로우할 수 없는 계정입니다.`);
    if (!confirmRun(targets.length, all.length - targets.length, mins(targets.length * 1.3))) return say('');
    let ok = 0;
    const fails = [];
    for (const [i, p] of targets.entries()) {
      if (run.stop) return say(`중지했습니다. ${ok}명 팔로우 · 실패 ${fails.length}명 · 남은 ${targets.length - i}명`);
      say(`팔로우 중 ${i + 1}/${targets.length} · 성공 ${ok} · 실패 ${fails.length}\n@${p.handle}`);
      try {
        const j = await B.xrpc(s, 'POST', 'com.atproto.repo.createRecord', { body: { repo: s.did, collection: 'app.bsky.graph.follow', record: { $type: 'app.bsky.graph.follow', subject: p.did, createdAt: new Date().toISOString() } } });
        ok++;
        B.setFollowing(p.handle, p.did, j.uri || 'yes');
      } catch (err) {
        // 로그인 만료·횟수 제한은 계속해도 모두 실패하므로 바로 멈춘다
        if (err.expired || err.status === 429) throw { step: `팔로우 (${ok}명 성공 후 @${p.handle} 에서)`, ...err, action: err.status === 429 ? '블루스카이가 잠시 팔로우를 막았습니다. 1시간쯤 뒤에 다시 누르면 남은 계정만 이어서 팔로우합니다.' : err.action };
        fails.push(`@${p.handle}: ${err.reason}`);
      }
      await sleep(1200);
    }
    say(`완료: ${ok}명 팔로우${fails.length ? `\n실패 ${fails.length}명 (다시 누르면 남은 계정만 시도)\n${fails.slice(0, 3).join('\n')}` : ''}`, !!fails.length && !ok);
  }

  // ── X: 화면의 팔로우 버튼을 한 명씩 누르며 아래로 스크롤 ──
  async function xDailyCount() {
    const today = new Date().toISOString().slice(0, 10);
    const r = await chrome.storage.local.get('xFollowAllDay').catch(() => ({}));
    return r.xFollowAllDay?.date === today ? r.xFollowAllDay.count : 0;
  }
  async function xAddCount(n) {
    const today = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({ xFollowAllDay: { date: today, count: (await xDailyCount()) + n } }).catch(() => {});
  }
  const col = () => document.querySelector('[data-testid="primaryColumn"]') || document;
  const xFollowBtns = () => [...col().querySelectorAll('[data-testid="UserCell"] [data-testid$="-follow"], [data-testid="cellInnerDiv"] [data-testid$="-follow"]')].filter((b) => !b.dataset.smdTried && b.offsetParent);
  const xLimitNotice = () => {
    const t = [...document.querySelectorAll('[data-testid="toast"], [role="alert"], [data-testid="sheetDialog"], [role="alertdialog"]')].map((e) => e.innerText || '').join(' ');
    return /unable to follow|limit|제한|팔로우할 수 없|더 이상 팔로우/i.test(t) ? t.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  };
  async function runX() {
    if (!document.cookie.includes('twid=')) throw { step: '로그인 확인', reason: 'X 에 로그인되어 있지 않습니다', action: 'X 에 로그인한 뒤 새로고침하세요.' };
    const done0 = await xDailyCount();
    const room = X_DAILY - done0;
    if (room <= 0) throw { step: '하루 한도 확인', reason: `오늘 이미 ${done0}명을 팔로우했습니다 (X 하루 한도 ${X_DAILY}명)`, action: '내일 다시 누르면 이어서 팔로우합니다.' };
    const visible = xFollowBtns().length;
    if (!visible) return say('화면에 팔로우할 계정이 없습니다 (모두 팔로우 중이거나 목록이 아직 안 불러와짐).\n목록이 보인 뒤 다시 누르세요.', true);
    if (!window.confirm(`이 목록에서 아직 팔로우하지 않은 계정을 아래로 내려가며 최대 ${room}명까지 팔로우합니다 (오늘 남은 X 한도).\n\nX 는 짧은 시간에 많이 팔로우하면 계정을 일시 제한할 수 있어 3~5초 간격으로 천천히 진행합니다 (${room}명 기준 약 ${mins(room * 4.2)}).\n진행 중에는 이 탭을 닫거나 다른 화면으로 옮기지 마세요. '중지'로 언제든 멈출 수 있습니다.\n\n시작할까요?`)) return say('');
    const startPath = location.pathname;
    let ok = 0;
    let fail = 0;
    let idleScrolls = 0;
    try {
      while (ok < room) {
        if (run.stop) return say(`중지했습니다. ${ok}명 팔로우 · 실패 ${fail}명`);
        if (location.pathname !== startPath) return say(`화면을 옮겨서 멈췄습니다. ${ok}명 팔로우 · 실패 ${fail}명\n목록 화면에서 다시 누르면 이어서 합니다.`, true);
        const b = xFollowBtns()[0];
        if (!b) {
          if (idleScrolls >= 4) break;
          idleScrolls++;
          say(`다음 계정 불러오는 중… (성공 ${ok})`);
          scrollBy(0, innerHeight * 0.85);
          await sleep(1800);
          continue;
        }
        idleScrolls = 0;
        b.dataset.smdTried = '1';
        const cell = b.closest('[data-testid="UserCell"], [data-testid="cellInnerDiv"]');
        const name = (cell?.querySelector('a[href^="/"][role="link"] span')?.textContent || '').trim();
        b.scrollIntoView({ block: 'center' });
        await sleep(300);
        say(`팔로우 중 · 성공 ${ok} · 실패 ${fail} · 오늘 남은 한도 ${room - ok}\n${name}`);
        b.click();
        // 버튼이 '팔로잉'(-unfollow) 또는 비공개 계정 '요청됨'(-cancel)으로 바뀌면 성공
        let changed = false;
        for (let t = 0; t < 25; t++) {
          await sleep(200);
          if (cell?.querySelector('[data-testid$="-unfollow"], [data-testid$="-cancel"]')) {
            changed = true;
            break;
          }
          if (xLimitNotice()) break;
        }
        const notice = xLimitNotice();
        if (notice) throw { step: `팔로우 (${ok}명 성공 후)`, reason: `X 가 팔로우를 막았습니다: "${notice}"`, action: 'X 가 정한 제한이 풀릴 때까지(보통 몇 시간~하루) 기다린 뒤 다시 누르세요.' };
        if (changed) ok++;
        else fail++;
        if (fail >= 5 && ok === 0) throw { step: '팔로우', reason: '팔로우 버튼을 눌러도 상태가 바뀌지 않습니다 (X 화면 구조가 바뀌었거나 제한 중)', action: 'X 화면에서 직접 한 명 팔로우가 되는지 확인한 뒤 다시 시도하세요.' };
        await sleep(3000 + Math.random() * 2000);
      }
    } finally {
      await xAddCount(ok);
    }
    say(ok >= room ? `오늘 한도(${X_DAILY}명)까지 팔로우했습니다: ${ok}명${fail ? ` · 실패 ${fail}명` : ''}\n내일 다시 누르면 이어서 합니다.` : `완료: ${ok}명 팔로우${fail ? ` · 실패 ${fail}명 (버튼이 바뀌지 않음)` : ''}`);
  }

  // 사이트 안에서 화면이 바뀌어도(주소만 바뀜) 버튼을 띄우고 숨긴다
  let lastPath = '';
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      tick();
    }
  }, 500);
})();
