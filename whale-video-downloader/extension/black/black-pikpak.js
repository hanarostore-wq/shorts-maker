// 블랙전용(개인용 기능) — 픽팍(mypikpak.com/drive/all 와 공유 링크 /s/…) 영상 카드의 ▶ 를 누르면 픽팍 기본 플레이어 대신 팟플레이어로 바로 재생. 페이지 쪽(MAIN world). 유료판에서는 black/ 째 빠진다.
//  - ▶ 클릭을 문서 맨 앞(capture)에서 가로채 기본 플레이어가 열리지 않게 하고, 사이트가 '외부 플레이어로 열기'에서 쓰는 것과 같은 방법(사이트 모듈 bb: 영상 주소를 클립보드에 쓰고 potplayer:///clipboard 를 연다)을 선택 창 없이 쓴다
//  - 화질은 '원본'(응답의 is_origin === true 인 항목)만. 정확히 하나가 아니면 짐작하지 않고 실패 안내 + [기본 플레이어로 재생] 선택을 보여 준다(몰래 기본 플레이어를 열지 않음)
//  - 카드와 파일을 못 이으면(사이트 구조 변경) 막지 않고 원래 동작으로 둔다. Shift·Ctrl·Alt·Win 클릭, 다른 화면(공유·휴지통·압축 내부·기록)은 건드리지 않는다
//  - 켜고 끄기: 팝업 블랙전용 탭(설정이 <html data-smd-pikpak="0|1"> 로 옴, 기본 켬) · '이 사이트 제외'(<html data-smd-off>)
//  - 영상 주소(서명 포함)는 메모리에서만 쓰고 로그·저장소·오류 안내에 남기지 않는다
(() => {
  'use strict';
  const core = globalThis.__SMD_PIKPAK_CORE;
  if (!core || globalThis.__smdPikpak) return;
  Object.defineProperty(globalThis, '__smdPikpak', { value: true, enumerable: false });
  const { PikpakError } = core;
  const SEL = '.file-explorer .play-icon';
  const root = () => document.documentElement;
  const enabled = () => !root()?.hasAttribute('data-smd-off') && root()?.dataset.smdPikpak !== '0';

  try {
    console.info('[웨일영상다운로더] 픽팍 팟플레이어 연결 준비됨');
  } catch {}
  let busy = false;
  let toastBox = null;
  let toastTimer = 0;
  function toast(lines, { actionLabel = '', onAction = null, ms = 6000 } = {}) {
    toastBox?.remove();
    clearTimeout(toastTimer);
    const box = document.createElement('div');
    box.setAttribute('data-smd-pikpak-toast', '');
    box.style.cssText = 'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:440px;padding:10px 14px;border-radius:12px;background:rgba(24,20,40,.96);border:1px solid #9b5cff;color:#fff;font:600 12.5px/1.5 "Malgun Gothic",system-ui,sans-serif;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.4)';
    box.textContent = lines;
    if (actionLabel && onAction) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.style.cssText = 'all:initial;display:block;margin-top:8px;padding:5px 12px;border-radius:8px;background:#9b5cff;color:#fff;font:700 12px "Malgun Gothic",system-ui,sans-serif;cursor:pointer';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        box.remove();
        onAction();
      });
      box.appendChild(b);
    }
    root().appendChild(box);
    toastBox = box;
    toastTimer = setTimeout(() => box.remove(), ms);
  }

  function launch(href) {
    const a = document.createElement('a');
    a.target = '_blank';
    a.rel = 'noopener';
    a.href = href;
    a.click();
  }

  // 공유 링크(/s/…): 사이트 공유 화면의 파일 조회(share/file_info) → 원본 → 클립보드 → potplayer:///clipboard
  async function playShareInPotPlayer(file) {
    const { shareId, token } = core.shareContext();
    const fn = await core.findShareFileInfo();
    let res;
    try {
      res = await fn({ share_id: shareId, file_id: file.id, pass_code_token: token });
    } catch {
      throw new PikpakError('DETAIL_REQUEST_FAILED', '공유 파일 정보 조회', '픽팍 서버에 연결하지 못했습니다', '인터넷 연결을 확인하거나 페이지를 새로고침한 뒤 다시 누르세요.');
    }
    const { url } = core.pickShareOriginal(res, file.id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      throw new PikpakError('CLIPBOARD_FAILED', '클립보드에 영상 주소 쓰기', '브라우저가 클립보드 쓰기를 막았습니다(버튼을 누른 뒤 시간이 지났거나 페이지가 비활성)', '다시 한 번 눌러 보세요.');
    }
    launch('potplayer:///clipboard');
  }

  // 내 드라이브: 사이트의 파일 상세 → 원본 항목 → 사이트 모듈 bb(클립보드) → potplayer:///clipboard 열기
  async function playInPotPlayer(file) {
    const req = core.captureRequire();
    const UV = core.findUV(req);
    const bb = core.findBB(req);
    if (!UV || !bb) throw new PikpakError('API_INCOMPATIBLE', '사이트 코드 연결', '픽팍 사이트의 파일 조회·팟플레이어 기능을 찾지 못했습니다(사이트가 바뀌었을 수 있음)', '[기본 플레이어로 재생]을 누르세요.');
    let res;
    try {
      res = await UV(file.id, {}); // 사이트의 '외부 플레이어로 열기'와 같은 호출(UV(id,{}))
    } catch {
      throw new PikpakError('DETAIL_REQUEST_FAILED', '파일 정보 조회', '픽팍 서버에 연결하지 못했습니다', '인터넷 연결을 확인하거나 페이지를 새로고침한 뒤 다시 누르세요.');
    }
    if (res?.error?.value) throw new PikpakError('DETAIL_REQUEST_FAILED', '파일 정보 조회', '픽팍이 파일 정보를 주지 않았습니다(로그인 만료·권한 없음일 수 있음)', '페이지를 새로고침하고 로그인 상태를 확인한 뒤 다시 누르세요.');
    const detail = res?.data?.value;
    if (!detail || detail.id !== file.id) throw new PikpakError('DETAIL_UNAVAILABLE', '파일 정보 조회', '받은 파일 정보가 누른 파일과 맞지 않습니다', '다시 눌러 보세요.');
    const { url } = core.pickOriginal(detail);
    let href;
    try {
      href = await bb(url); // 영상 주소를 클립보드에 쓰고 'potplayer:///clipboard' 를 돌려줌(사이트의 외부 플레이어 열기와 같은 함수)
    } catch {
      throw new PikpakError('CLIPBOARD_FAILED', '클립보드에 영상 주소 쓰기', '브라우저가 클립보드 쓰기를 막았습니다(버튼을 누른 뒤 시간이 지났거나 페이지가 비활성)', '다시 한 번 눌러 보세요.');
    }
    if (href !== 'potplayer:///clipboard') throw new PikpakError('LAUNCH_REJECTED', '팟플레이어 열기', '예상하지 못한 연결 주소라서 열지 않았습니다', '[기본 플레이어로 재생]을 누르세요.');
    launch(href);
  }

  document.addEventListener(
    'click',
    (ev) => {
      if (ev.button !== 0 || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || !enabled()) return;
      const btn = ev.target?.closest?.(SEL);
      if (!btn) return;
      const isShare = !!core.sharePathId(location.pathname);
      if (!isShare && !core.pathAllowed(location.pathname)) {
        // 범위 밖 화면(공유·휴지통·압축 내부 등): 건드리지 않지만 왜 팟플레이어로 안 갔는지 알린다
        const where = String(location.pathname).slice(0, 24);
        toast(`이 화면(${where})은 팟플레이어 연결 범위 밖이라 픽팍 기본 동작으로 열었습니다\n단계: 화면 확인\n원인: 지원하는 화면은 내 드라이브 '모든 파일'(/drive/all)·'최근 파일'(/drive/recent)과 공유 링크(/s/…)입니다\n조치: 내 드라이브 모든 파일 화면에서 눌러 보세요.`, { ms: 6000 });
        return;
      }
      let found;
      try {
        found = core.findFileComponent(btn, document, { share: isShare });
      } catch (err) {
        // 카드와 파일을 못 이으면 막지 않는다(픽팍 원래 동작). 대신 왜 안 됐는지 화면에 알린다
        const e = err instanceof PikpakError ? err : new PikpakError('UNKNOWN', '카드 파일 찾기', '예상하지 못한 오류가 났습니다', '이 안내를 개발자에게 알려 주세요.');
        toast(`팟플레이어로 보내지 못해 픽팍 기본 동작으로 넘겼습니다\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action}`, { ms: 12000 });
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (busy) return;
      busy = true;
      toast('팟플레이어로 여는 중…', { ms: 2500 });
      (isShare ? playShareInPotPlayer : playInPotPlayer)(found.file)
        .then(() => {
          // 성공하면 안내를 띄우지 않는다(여는 중 안내도 지움). 실패했을 때만 단계·원인·조치를 보여 준다
          toastBox?.remove();
          clearTimeout(toastTimer);
        })
        .catch((err) => {
          const e = err instanceof PikpakError ? err : new PikpakError('UNKNOWN', '팟플레이어 열기', '예상하지 못한 오류가 났습니다', '다시 눌러 보세요.');
          toast(`팟플레이어로 열지 못했습니다\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action}`, {
            actionLabel: '기본 플레이어로 재생',
            onAction: () => {
              try {
                found.openFile(found.file);
              } catch {
                toast('기본 플레이어도 열지 못했습니다\n단계: 기본 플레이어 열기\n원인: 사이트 함수 호출 실패\n조치: 페이지를 새로고침한 뒤 다시 눌러 보세요.');
              }
            },
            ms: 12000,
          });
        })
        .finally(() => {
          busy = false;
        });
    },
    true,
  );
})();
