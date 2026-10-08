// 팔로우 목록 전부 팔로우 (블루스카이·X·인스타그램·스레드·틱톡·더우인·웨이보·빌리빌리·샤오홍슈·핀터레스트·콰이쇼우, ISOLATED world)
//  - 블루스카이 /profile/{계정}/follows·followers, X /{계정}/following·followers·verified_followers,
//    그 밖의 사이트는 팔로워·팔로잉 목록 창(팔로우 버튼이 여러 개 있는 창)이 열리면 오른쪽 아래에 버튼
//  - 이미 팔로우 중인 계정·내 계정·차단 관계 계정은 건너뛴다. 진행 중 언제든 '중지'
//  - 누르면 확인 창 없이 바로 시작(사용자 요청)
//  - 짧은 시간에 너무 많이 팔로우하면 사이트가 계정을 제한할 수 있어 한 명씩 간격을 두고 천천히 진행한다
//    (블루스카이 약 1.2초, X 3~5초 간격 · X 는 하루 400명 제한이 있어 그 전에 멈춤)
(() => {
  'use strict';
  if (globalThis.__SMD_FOLLOWALL || window.top !== window) return;
  globalThis.__SMD_FOLLOWALL = true;
  const H = location.hostname;
  const SITE_OF = [
    ['bsky', /(^|\.)bsky\.app$/], ['x', /(^|\.)(x|twitter)\.com$/], ['instagram', /(^|\.)instagram\.com$/], ['threads', /(^|\.)threads\.(net|com)$/],
    ['tiktok', /(^|\.)tiktok\.com$/], ['douyin', /(^|\.)douyin\.com$/], ['weibo', /(^|\.)weibo\.(com|cn)$/], ['bilibili', /(^|\.)bilibili\.com$/],
    ['xiaohongshu', /(^|\.)xiaohongshu\.com$/], ['pinterest', /(^|\.)pinterest\./], ['kuaishou', /(^|\.)kuaishou\.com$/],
  ];
  // 목록에 없는 사이트(유튜브·페이스북·그 밖)도 팔로워·팔로잉 목록 창이 열리면 같은 방식(화면 버튼을 한 명씩)으로 한다
  const site = SITE_OF.find(([, re]) => re.test(H))?.[0] || 'other';
  const sid = site === 'bsky' ? 'bluesky' : site === 'other' ? globalThis.__SMD_SITES?.pick?.(H)?.id || 'generic' : site;
  const effOf = (s, site) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) }); // 사이트별로 바꾼 값이 우선

  // 확장프로그램을 업데이트(다시 시작)하면 이미 열려 있던 페이지의 이 스크립트는 확장과 연결이 끊긴다
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const DEAD = {
    step: '확장프로그램 연결 확인',
    reason: '확장프로그램이 업데이트(또는 다시 시작)되어 이 페이지와 연결이 끊겼습니다',
    action: '이 페이지를 새로고침(F5)한 뒤 다시 누르세요. 업데이트한 뒤에는 열려 있던 페이지를 한 번씩 새로고침해야 합니다.',
  };
  const friendly = (err) => (/Extension context invalidated/i.test(String(err?.reason || err?.message || err)) ? { ...DEAD, step: err?.step && err.step !== '진행' ? err.step : DEAD.step } : err);

  let on = true;
  chrome.storage.local.get('settings').then((r) => {
    on = effOf(r.settings, sid).followAllButton !== false;
    tick();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) {
      on = effOf(c.settings.newValue, sid).followAllButton !== false;
      tick();
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const X_RESERVED = ['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose'];

  // 지금 화면이 팔로우 목록인가 → { actor, kind }
  function listPage() {
    const p = location.pathname;
    if (site === 'bsky') {
      const m = /^\/profile\/([^/]+)\/(follows|followers)\/?$/.exec(p);
      return m ? { actor: decodeURIComponent(m[1]), kind: m[2] } : null;
    }
    if (site !== 'x') return null;
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
    const lp = on && (site === 'bsky' ? listPage() : cfg.active());
    if (!lp && !run) {
      host?.remove();
      return;
    }
    ensure();
    ui.go.hidden = !!run;
    ui.stop.hidden = !run;
  }

  async function start() {
    if (!alive()) {
      ui.go.hidden = true;
      return say(`전부 팔로우 실패\n단계: ${DEAD.step}\n원인: ${DEAD.reason}\n조치: ${DEAD.action}`, true);
    }
    const lp = site === 'bsky' ? listPage() : null;
    if ((site === 'bsky' ? !lp : !cfg.active()) || run) return;
    run = { stop: false };
    tick();
    try {
      await (site === 'bsky' ? runBsky(lp) : runClicks());
    } catch (e0) {
      const err = friendly(e0);
      say(`전부 팔로우 실패\n단계: ${err.step || '진행'}\n원인: ${err.reason || err.message || err}\n조치: ${err.action || '페이지를 새로고침한 뒤 다시 누르세요.'}`, true);
    } finally {
      run = null;
      tick();
    }
  }
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
    // 확인 창 없이 바로 시작(사용자 요청). 인원·예상 시간은 진행 칸에 보여 준다
    const skipped = all.length - targets.length;
    const eta = mins(targets.length * 1.3);
    let ok = 0;
    const fails = [];
    for (const [i, p] of targets.entries()) {
      if (run.stop) return say(`중지했습니다. ${ok}명 팔로우 · 실패 ${fails.length}명 · 남은 ${targets.length - i}명`);
      say(`팔로우 중 ${i + 1}/${targets.length} · 성공 ${ok} · 실패 ${fails.length}${skipped ? ` · 제외 ${skipped}명(이미 팔로우 등)` : ''}\n예상 ${eta} · @${p.handle}`);
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
  // ── 블루스카이 밖: 화면의 팔로우 버튼을 한 명씩 누르며 목록을 아래로 스크롤 ──
  //   사이트마다 하루 한도·간격을 다르게 둔다(사이트가 정한 한도보다 낮게, 인스타·스레드는 특히 엄격)
  const FOLLOW_TXT = /^(팔로우|맞팔로우|맞팔로우하기|follow|follow back|关注|回关|\+ ?关注|关注 ?\+|팔로우하기)$/i;
  const DONE_TXT = /^(팔로잉|팔로우 중|팔로우중|요청됨|친구|following|requested|friends|unfollow|已关注|互相关注|已互粉|已请求|取消关注)$/i;
  const LIMIT_TXT = /unable to follow|try again later|limit|we restrict|action blocked|제한|나중에 다시|팔로우할 수 없|더 이상 팔로우|操作频繁|频繁|稍后再试|上限/i;
  const txt = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const visibleEl = (el) => !!el && el.isConnected && (el.offsetParent || el.getClientRects().length) && !el.closest('smd-followall');
  const textButtons = (root) => [...root.querySelectorAll('button, [role="button"]')].filter((b) => FOLLOW_TXT.test(txt(b)) && visibleEl(b) && !b.dataset.smdTried);
  // 팔로우 버튼이 2개 이상 든 창(목록 창)
  const listDialog = () => [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].reverse().find((d) => visibleEl(d) && textButtons(d).length + d.querySelectorAll('[data-smd-tried]').length >= 2) || null;
  const scrollerIn = (root) => {
    for (const el of [root, ...root.querySelectorAll('div, ul, section')]) {
      const st = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(st.overflowY)) return el;
    }
    return null;
  };
  // 사이트가 띄운 제한 알림(알림·토스트를 먼저, 목록 창 글자는 버튼 이름과 섞이지 않게 맨 나중에)
  const limitNotice = () => {
    for (const sel of ['[data-testid="toast"], [role="alert"], [role="alertdialog"], [data-testid="sheetDialog"]', '[role="dialog"]']) {
      for (const e of document.querySelectorAll(sel)) {
        if (e.closest('smd-followall')) continue;
        const t = txt(e);
        const m = LIMIT_TXT.exec(t);
        if (!m) continue;
        if (sel === '[role="dialog"]' && t.length > 200) {
          const i = Math.max(0, m.index - 40);
          return t.slice(i, i + 120).trim();
        }
        return t.slice(0, 120);
      }
    }
    return '';
  };
  const xCol = () => document.querySelector('[data-testid="primaryColumn"]') || document;
  const CLICK = {
    x: {
      name: 'X', cap: 400, gap: [3000, 5000],
      active: () => !!listPage(),
      buttons: () => [...xCol().querySelectorAll('[data-testid="UserCell"] [data-testid$="-follow"], [data-testid="cellInnerDiv"] [data-testid$="-follow"]')].filter((b) => !b.dataset.smdTried && visibleEl(b)),
      cell: (b) => b.closest('[data-testid="UserCell"], [data-testid="cellInnerDiv"]'),
      done: (b, cell) => !!cell?.querySelector('[data-testid$="-unfollow"], [data-testid$="-cancel"]'),
      scroll: () => scrollBy(0, innerHeight * 0.85),
      login: () => document.cookie.includes('twid='),
      pathLock: true,
    },
  };
  const DIALOG_SITE = { instagram: ['인스타그램', 150, [8000, 12000]], threads: ['스레드', 150, [8000, 12000]], tiktok: ['틱톡', 200, [5000, 8000]], douyin: ['더우인', 200, [5000, 8000]], weibo: ['웨이보', 200, [5000, 8000]], bilibili: ['빌리빌리', 200, [4000, 7000]], xiaohongshu: ['샤오홍슈', 150, [6000, 10000]], pinterest: ['핀터레스트', 200, [4000, 7000]], kuaishou: ['콰이쇼우', 200, [5000, 8000]], other: ['이 사이트', 150, [6000, 10000]] };
  for (const [id, [name, cap, gap]] of Object.entries(DIALOG_SITE)) {
    CLICK[id] = {
      name, cap, gap,
      active: () => !!listDialog(),
      buttons: () => {
        const d = listDialog();
        return d ? textButtons(d) : [];
      },
      cell: (b) => b.parentElement,
      done: (b) => !b.isConnected || DONE_TXT.test(txt(b)) || !FOLLOW_TXT.test(txt(b)),
      scroll: () => {
        const d = listDialog();
        const sc = d && scrollerIn(d);
        if (sc) sc.scrollTop += sc.clientHeight * 0.85;
      },
      login: () => true,
    };
  }
  const cfg = CLICK[site];

  const dayKey = `followAllDay_${site === 'other' ? H : site}`;
  // 하루 팔로우 수: 확장 저장소(연결이 끊기면 페이지 저장소)에 기록. 기록 실패가 팔로우를 막지 않게 한다.
  const lsKey = `smd_${dayKey}`;
  const readLs = () => {
    try {
      return JSON.parse(localStorage.getItem(lsKey) || 'null');
    } catch {
      return null;
    }
  };
  async function dailyCount() {
    const today = new Date().toISOString().slice(0, 10);
    let v = null;
    try {
      v = (await chrome.storage.local.get(dayKey))[dayKey];
    } catch {}
    const l = readLs();
    const c1 = v?.date === today ? v.count : 0;
    const c2 = l?.date === today ? l.count : 0;
    return Math.max(c1, c2);
  }
  async function addCount(n) {
    const today = new Date().toISOString().slice(0, 10);
    const rec = { date: today, count: (await dailyCount()) + n };
    try {
      localStorage.setItem(lsKey, JSON.stringify(rec));
    } catch {}
    try {
      await chrome.storage.local.set({ [dayKey]: rec });
    } catch {}
  }
  async function runClicks() {
    if (!cfg.login()) throw { step: '로그인 확인', reason: `${cfg.name} 에 로그인되어 있지 않습니다`, action: `${cfg.name} 에 로그인한 뒤 새로고침하세요.` };
    const done0 = await dailyCount();
    const room = cfg.cap - done0;
    if (room <= 0) throw { step: '하루 한도 확인', reason: `오늘 이미 ${done0}명을 팔로우했습니다 (${cfg.name} 하루 한도 ${cfg.cap}명)`, action: '내일 다시 누르면 이어서 팔로우합니다.' };
    if (!cfg.buttons().length) return say('화면에 팔로우할 계정이 없습니다 (모두 팔로우 중이거나 목록이 아직 안 불러와짐).\n목록이 보인 뒤 다시 누르세요.', true);
    // 확인 창 없이 바로 시작(사용자 요청)
    const startPath = location.pathname;
    let ok = 0;
    let fail = 0;
    let idleScrolls = 0;
    try {
      while (ok < room) {
        if (run.stop) return say(`중지했습니다. ${ok}명 팔로우 · 실패 ${fail}명`);
        if (cfg.pathLock && location.pathname !== startPath) return say(`화면을 옮겨서 멈췄습니다. ${ok}명 팔로우 · 실패 ${fail}명\n목록 화면에서 다시 누르면 이어서 합니다.`, true);
        if (!cfg.active()) return say(`목록 창이 닫혀서 멈췄습니다. ${ok}명 팔로우 · 실패 ${fail}명\n목록을 다시 열고 누르면 이어서 합니다.`, true);
        const b = cfg.buttons()[0];
        if (!b) {
          if (idleScrolls >= 4) break;
          idleScrolls++;
          say(`다음 계정 불러오는 중… (성공 ${ok})`);
          cfg.scroll();
          await sleep(1800);
          continue;
        }
        idleScrolls = 0;
        b.dataset.smdTried = '1';
        const cell = cfg.cell(b);
        const name = (cell?.querySelector('a[href] span, a[href]')?.textContent || '').trim().slice(0, 40);
        b.scrollIntoView({ block: 'center' });
        await sleep(300);
        say(`팔로우 중 · 성공 ${ok} · 실패 ${fail} · 오늘 남은 한도 ${room - ok}\n${name}`);
        b.click();
        // 버튼이 '팔로잉'·'요청됨' 등으로 바뀌면 성공
        let changed = false;
        for (let t = 0; t < 25; t++) {
          await sleep(200);
          if (cfg.done(b, cell)) {
            changed = true;
            break;
          }
          if (limitNotice()) break;
        }
        const notice = limitNotice();
        if (notice) throw { step: `팔로우 (${ok}명 성공 후)`, reason: `${cfg.name}에서 팔로우를 막았습니다: "${notice}"`, action: `${cfg.name}에서 정한 제한이 풀릴 때까지(보통 몇 시간~하루) 기다린 뒤 다시 누르세요.` };
        if (changed) ok++;
        else fail++;
        if (fail >= 5 && ok === 0) throw { step: '팔로우', reason: `팔로우 버튼을 눌러도 상태가 바뀌지 않습니다 (${cfg.name} 화면 구조가 바뀌었거나 제한 중)`, action: `${cfg.name} 화면에서 직접 한 명 팔로우가 되는지 확인한 뒤 다시 시도하세요.` };
        await sleep(cfg.gap[0] + Math.random() * (cfg.gap[1] - cfg.gap[0]));
      }
    } finally {
      await addCount(ok);
    }
    say(ok >= room ? `오늘 한도(${cfg.cap}명)까지 팔로우했습니다: ${ok}명${fail ? ` · 실패 ${fail}명` : ''}\n내일 다시 누르면 이어서 합니다.` : `완료: ${ok}명 팔로우${fail ? ` · 실패 ${fail}명 (버튼이 바뀌지 않음)` : ''}`);
  }

  // 사이트 안에서 화면이 바뀌어도(주소만 바뀜) 버튼을 띄우고 숨긴다
  let lastState = '';
  setInterval(() => {
    if (!alive()) {
      if (host?.isConnected && !run && !ui.go.hidden) {
        ui.go.hidden = true;
        say(`${DEAD.reason}.\n${DEAD.action}`, true);
      }
      return;
    }
    const st = `${location.pathname}|${site === 'bsky' || site === 'x' ? '' : !!listDialog()}`;
    if (st !== lastState) {
      lastState = st;
      tick();
    }
  }, 700);
})();
