// 블랙전용(개인용 기능) — 유료판을 만들 때 tools/make-paid.mjs 가 이 폴더(black/)째 빼고, '블랙전용' 표시가 붙은 줄도 지운다.
//  - Alt+W: 지금 보고 있는 탭 닫기 (팝업 '블랙전용' 탭에서 켜고 끄기, 기본 켬)
//    한글 입력 중에도 되도록 글자 대신 키 위치(KeyW)로 본다. 페이지 안의 프레임(유튜브 영상 등)에 커서가 있어도 된다.
(() => {
  'use strict';
  if (globalThis.__SMD_BLACK) return;
  globalThis.__SMD_BLACK = true;
  let on = true;
  // 확장 업데이트 뒤에는 예전 스크립트(연결 끊김)와 새로 넣은 스크립트가 함께 있다.
  // 새 스크립트가 있다는 표시를 문서에 남겨, 예전 스크립트는 오류를 띄우지 않고 새 스크립트에 넘긴다.
  const ME = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    document.documentElement.setAttribute('data-smd-black', ME);
  } catch {}
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  chrome.storage.local.get('settings').then((r) => (on = r.settings?.blackAltW !== false), () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings) on = c.settings.newValue?.blackAltW !== false;
  });

  // 오류 안내(단계·원인·조치) — 화면 아래 가운데, 8초
  function showErr(e) {
    const top = window.top === window ? document : null;
    const doc = top || document;
    const box = doc.createElement('div');
    box.setAttribute('data-smd-black-err', '');
    box.style.cssText = 'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:420px;padding:10px 14px;border-radius:12px;background:rgba(150,20,40,.96);color:#fff;font:600 12.5px/1.5 "Malgun Gothic",system-ui,sans-serif;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.4)';
    box.textContent = `탭 닫기(Alt+W) 실패\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action}`;
    (doc.body || doc.documentElement).appendChild(box);
    setTimeout(() => box.remove(), 8000);
  }

  addEventListener(
    'keydown',
    (ev) => {
      if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.code !== 'KeyW' || ev.repeat) return;
      const dead = !alive();
      if (dead && document.documentElement.getAttribute('data-smd-black') !== ME) return; // 새 스크립트가 처리
      if (!dead && (!on || globalThis.__SMD_OFF)) return; // __SMD_OFF: 이 사이트 제외
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (dead) {
        showErr({ step: '확장프로그램 연결 확인', reason: '확장프로그램이 업데이트(또는 다시 시작)되어 이 페이지와 연결이 끊겼습니다', action: '이 페이지를 새로고침(F5)한 뒤 다시 누르거나, Ctrl+W 로 닫으세요.' });
        return;
      }
      chrome.runtime.sendMessage({ type: 'smd:black-close-tab' }).then(
        (r) => r?.error && showErr(r.error),
        (err) => showErr({ step: '탭 닫기 요청', reason: `확장프로그램 백그라운드에 요청하지 못했습니다 (${err?.message || err})`, action: '이 페이지를 새로고침(F5)한 뒤 다시 누르거나, Ctrl+W 로 닫으세요.' }),
      );
    },
    true,
  );
})();
