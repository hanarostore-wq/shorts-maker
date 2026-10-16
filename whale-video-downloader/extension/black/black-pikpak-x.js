// 블랙전용(개인용 기능) — 픽팍 폴더·영상 카드마다 썸네일(회색 칸) 안쪽 오른쪽 가운데에 × 표시(계속 보임, 36px). 페이지 쪽(MAIN world). 유료판에서는 black/ 째 빠진다.
//  - 내 드라이브: × = 사이트의 '휴지통으로 보내기'(files:batchTrash, 되돌릴 수 있음)를 그 카드 파일 하나에 호출하고, 성공하면 카드를 화면에서 치운다. 영구 삭제는 쓰지 않는다. 휴지통 화면에서는 × 를 보이지 않는다
//  - 공유 링크(/s/…): × = 서버에는 아무 일도 하지 않고 내 화면에서만 그 카드를 가린다. 가린 파일 번호는 이 브라우저(localStorage)에 공유 링크별로 남아 새로고침해도 계속 가려지고, 왼쪽 아래 [가린 N개 · 모두 보기]로 되돌린다
//  - 켜고 끄기: 팝업 블랙전용 탭의 '카드 × 표시' 스위치(<html data-smd-pikpak-x="0|1">, 기본 켬) · 픽팍 전체 스위치 · '이 사이트 제외'(<html data-smd-off>)
//  - 실패하면 조용히 넘기지 않고 단계·원인·조치를 보여 준다. 파일 주소·토큰은 다루지 않는다(파일 번호만)
(() => {
  'use strict';
  const core = globalThis.__SMD_PIKPAK_CORE;
  if (!core || globalThis.__smdPikpakX) return;
  Object.defineProperty(globalThis, '__smdPikpakX', { value: true, enumerable: false });
  const { PikpakError } = core;
  const root = () => document.documentElement;
  const enabled = () => !root()?.hasAttribute('data-smd-off') && root()?.dataset.smdPikpak !== '0' && root()?.dataset.smdPikpakX !== '0';
  const CARD_ROOT = '.file-explorer';
  const shareId = () => core.sharePathId(location.pathname);
  const isShare = () => !!shareId();
  const inTrash = () => /^\/drive\/(?:trash|recycle)/.test(location.pathname);
  const hiddenKey = () => `smdHiddenShare:${shareId()}`;

  const loadHidden = () => {
    try {
      const a = JSON.parse(localStorage.getItem(hiddenKey()) || '[]');
      return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  };
  const saveHidden = (set) => {
    try {
      localStorage.setItem(hiddenKey(), JSON.stringify([...set]));
    } catch {}
  };

  // ── 안내(실패 때만) ──
  let toastBox = null;
  let toastTimer = 0;
  function toast(text, ms = 7000) {
    toastBox?.remove();
    clearTimeout(toastTimer);
    const box = document.createElement('div');
    box.setAttribute('data-smd-x-toast', '');
    box.style.cssText = 'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:440px;padding:10px 14px;border-radius:12px;background:rgba(24,20,40,.96);border:1px solid #9b5cff;color:#fff;font:600 12.5px/1.5 "Malgun Gothic",system-ui,sans-serif;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.4)';
    box.textContent = text;
    root().appendChild(box);
    toastBox = box;
    toastTimer = setTimeout(() => box.remove(), ms);
  }

  // ── 카드 찾기 ──
  const cardOf = (t) => t?.closest?.(`${CARD_ROOT} li.row`) || t?.closest?.(`${CARD_ROOT} .file-item`) || t?.closest?.(`${CARD_ROOT} .row`) || null;
  const innerOf = (card) => card.querySelector('.thumbnail-wrap, .file-item, .play-icon, .name') || card.firstElementChild || card;
  function fileOfCard(card) {
    const f = core.findFileComponent(innerOf(card), document, { share: isShare() });
    return f.file;
  }

  // ── × 단추: 카드마다 썸네일(회색 칸) 안쪽 오른쪽 가운데에 계속 띄워 둔다(오른쪽 위 메뉴 단추와 겹치지 않게, 칸 밖으로 안 나가게) ──
  //  카드 안에 직접 붙이므로 스크롤·크기 변화를 따라간다. 사이트가 카드를 새로 그리면 변화 감시가 다시 붙인다
  const mkBtn = () => {
    const b = document.createElement('button');
    b.setAttribute('data-smd-x', '');
    b.type = 'button';
    b.textContent = '×';
    b.title = isShare() ? '내 화면에서 가리기(서버에는 영향 없음)' : '휴지통으로 보내기';
    b.style.cssText = 'all:initial;position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:5;box-sizing:border-box;width:36px;height:36px;border-radius:18px;background:rgba(24,20,40,.9);border:2px solid #9b5cff;color:#fff;font:700 24px/30px "Malgun Gothic",system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.45)';
    return b;
  };
  function syncButtons() {
    syncTimer = 0;
    const on = enabled() && !inTrash();
    if (!on) {
      for (const b of document.querySelectorAll('[data-smd-x]')) b.remove();
      return;
    }
    for (const th of document.querySelectorAll(`${CARD_ROOT} .thumbnail`)) {
      if (th.querySelector(':scope > [data-smd-x]')) continue;
      if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
      th.appendChild(mkBtn());
    }
  }
  let syncTimer = 0;
  const scheduleSync = () => {
    if (!syncTimer) syncTimer = setTimeout(syncButtons, 150);
  };
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target?.closest?.('[data-smd-x]');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onX(cardOf(b));
    },
    true,
  );
  document.addEventListener('mousedown', (e) => e.target?.closest?.('[data-smd-x]') && e.stopPropagation(), true);

  // ── 실행 ──
  let busy = false;
  async function onX(card) {
    if (!card || busy) return;
    let file;
    try {
      file = fileOfCard(card);
    } catch (err) {
      const e = err instanceof PikpakError ? err : new PikpakError('UNKNOWN', '카드 파일 찾기', '예상하지 못한 오류가 났습니다', '이 안내를 개발자에게 알려 주세요.');
      toast(`× 를 처리하지 못했습니다\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action}`);
      return;
    }
    if (isShare()) {
      const set = loadHidden();
      set.add(file.id);
      saveHidden(set);
      card.style.display = 'none';
      updatePill();
      return;
    }
    busy = true;
    try {
      const req = core.captureRequire();
      const trash = core.findTrash(req);
      if (!trash) throw new PikpakError('API_INCOMPATIBLE', '사이트 코드 연결', '픽팍의 휴지통 기능을 찾지 못했습니다(사이트가 바뀌었을 수 있음)', '픽팍에서 직접 삭제하세요. 계속 그러면 확장 업데이트를 기다려 주세요.');
      let res;
      try {
        res = await trash([file.id]);
      } catch {
        throw new PikpakError('TRASH_REQUEST_FAILED', '휴지통으로 보내기', '픽팍 서버에 연결하지 못했습니다', '인터넷 연결을 확인한 뒤 다시 누르세요.');
      }
      if (res?.error?.value) throw new PikpakError('TRASH_REQUEST_FAILED', '휴지통으로 보내기', '픽팍이 휴지통 이동을 받아들이지 않았습니다(로그인 만료·권한 없음일 수 있음)', '페이지를 새로고침하고 로그인 상태를 확인한 뒤 다시 누르세요.');
      card.style.display = 'none'; // 서버에서 휴지통으로 갔으니 화면에서도 치운다(새로고침하면 목록에서 빠짐)
    } catch (err) {
      const e = err instanceof PikpakError ? err : new PikpakError('UNKNOWN', '휴지통으로 보내기', '예상하지 못한 오류가 났습니다', '다시 눌러 보세요.');
      toast(`휴지통으로 보내지 못했습니다(파일은 그대로입니다)\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action}`);
    } finally {
      busy = false;
    }
  }

  // ── 공유 링크: 가린 카드 계속 가리기, 되돌리기 단추 ──
  let pill = null;
  function updatePill() {
    if (!isShare() || !enabled()) return pill?.remove(), (pill = null);
    const n = loadHidden().size;
    if (!n) return pill?.remove(), (pill = null);
    if (!pill) {
      pill = document.createElement('button');
      pill.setAttribute('data-smd-x-pill', '');
      pill.type = 'button';
      pill.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646;padding:6px 12px;border-radius:14px;background:rgba(24,20,40,.92);border:1px solid #9b5cff;color:#fff;font:600 12px "Malgun Gothic",system-ui,sans-serif;cursor:pointer';
      pill.addEventListener('click', () => {
        saveHidden(new Set());
        for (const el of document.querySelectorAll('[data-smd-x-hid]')) {
          el.style.display = '';
          el.removeAttribute('data-smd-x-hid');
        }
        for (const el of document.querySelectorAll('[data-smd-x-ck]')) el.removeAttribute('data-smd-x-ck');
        updatePill();
      });
      root().appendChild(pill);
    }
    const label = `가린 ${n}개 · 모두 보기`;
    if (pill.textContent !== label) pill.textContent = label; // 같은 글자를 다시 쓰면 변화 감시가 또 깨어나므로 바뀔 때만
  }
  let scanTimer = 0;
  function scan() {
    scanTimer = 0;
    if (!isShare() || !enabled()) return;
    const hidden = loadHidden();
    if (!hidden.size) return updatePill();
    const cards = [...document.querySelectorAll(`${CARD_ROOT} li.row, ${CARD_ROOT} .file-item`)].filter((c) => !c.hasAttribute('data-smd-x-ck'));
    if (!cards.length) return updatePill();
    let map;
    try {
      map = core.mapCards(document, { share: true });
    } catch {
      return;
    }
    for (const c of cards) {
      const inner = c.matches('.file-item') ? c : c.querySelector('.file-item');
      const f = inner && map.get(inner);
      if (f) c.setAttribute('data-smd-x-ck', ''); // 파일을 알아낸 카드는 다시 안 본다
      if (f && hidden.has(f.file.id)) {
        c.style.display = 'none';
        c.setAttribute('data-smd-x-hid', '');
      }
    }
    updatePill();
  }
  const schedule = () => {
    scheduleSync();
    if (!scanTimer && isShare()) scanTimer = setTimeout(scan, 250);
  };
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.documentElement || document, { attributes: true, attributeFilter: ['data-smd-pikpak', 'data-smd-pikpak-x', 'data-smd-off'] });
  window.addEventListener('popstate', schedule);
  schedule();
})();
