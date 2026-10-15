// 블랙전용(개인용 기능) — 서비스워커 쪽. 유료판에서는 tools/make-paid.mjs 가 이 파일과 import 줄을 뺀다.
//  - 'smd:black-close-tab': Alt+W 를 누른 그 탭을 닫는다
import { hostOfUrl, isExcluded } from '../shared/exclude.js';

// 확장을 설치·업데이트하면 이미 열려 있던 탭에는 스크립트가 없어(새로고침 전까지) 제스처가 안 먹는다 → 열린 탭에 바로 넣는다.
//  제외한 사이트와 브라우저 기본 페이지(새 탭·설정·웹스토어 등 확장이 못 들어가는 곳)는 건너뜀
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((t) => {
        const host = hostOfUrl(t.url);
        if (!host || isExcluded(settings?.excludedSites, host)) return null;
        return chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['black/black-gesture-core.js', 'black/black-gesture.js'] }).catch(() => null);
      }),
    );
  } catch {}
});

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type !== 'smd:black-close-tab') return;
  const id = sender.tab?.id;
  if (id == null) {
    send({ error: { step: '탭 찾기', reason: '키를 누른 탭을 브라우저가 알려 주지 않았습니다', action: 'Ctrl+W 로 닫으세요.' } });
    return;
  }
  (async () => {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings?.blackAltW === false) return send({ ok: false, off: true });
    await chrome.tabs.remove(id);
    send({ ok: true });
  })().catch((err) => send({ error: { step: '탭 닫기', reason: `브라우저가 탭을 닫지 못했습니다 (${err?.message || err})`, action: 'Ctrl+W 로 닫으세요. 계속 그러면 확장프로그램을 다시 켜 보세요.' } }));
  return true;
});

// 마우스 제스처(black-gesture.js): 탭 동작을 대신 한다. 켜고 끄기는 설정 blackGesture (기본 켬)
//  빠르게 하려고 설정 읽기를 기다리지 않고 바로 동작하고, 꺼져 있으면 그때 되돌려 보낸다(설정 읽기는 메모리에서 몇 ms)
const gestErr = (step, reason, action) => ({ error: { step, reason, action } });
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type !== 'smd:black-gesture') return;
  const tab = sender.tab;
  if (tab?.id == null) {
    send(gestErr('탭 찾기', '제스처를 한 탭을 브라우저가 알려 주지 않았습니다', '키보드 단축키(Alt+←, Ctrl+W)를 쓰세요.'));
    return;
  }
  (async () => {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings?.blackGesture === false) return send({ ok: false, off: true });
    const id = tab.id;
    switch (msg.action) {
      case 'back':
        await chrome.tabs.goBack(id).catch((err) => {
          throw Object.assign(new Error('이 탭에는 돌아갈 이전 페이지가 없습니다'), { step: '뒤로 가기', hint: '이전 페이지가 있는 탭에서 해 보세요.', raw: err?.message });
        });
        break;
      case 'forward':
        await chrome.tabs.goForward(id).catch((err) => {
          throw Object.assign(new Error('이 탭에는 앞으로 갈 페이지가 없습니다(먼저 뒤로 간 적이 있어야 합니다)'), { step: '앞으로 가기', hint: '뒤로 간 탭에서 해 보세요.', raw: err?.message });
        });
        break;
      case 'close':
        await chrome.tabs.remove(id);
        break;
      case 'reload':
        await chrome.tabs.reload(id);
        break;
      case 'newtab':
        await chrome.tabs.create({ windowId: tab.windowId, index: tab.index + 1 });
        break;
      case 'prevtab':
      case 'nexttab': {
        const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).sort((a, b) => a.index - b.index);
        const i = tabs.findIndex((t) => t.id === id);
        const next = tabs[(i + (msg.action === 'nexttab' ? 1 : -1) + tabs.length) % tabs.length];
        if (next && next.id !== id) await chrome.tabs.update(next.id, { active: true });
        break;
      }
      case 'top':
      case 'bottom':
        // 안쪽 프레임에서 한 스크롤: 맨 위 페이지를 스크롤
        await chrome.scripting.executeScript({
          target: { tabId: id, frameIds: [0] },
          func: (to) => {
            const el = document.scrollingElement || document.documentElement;
            el.scrollTo({ top: to === 'top' ? 0 : el.scrollHeight, behavior: 'instant' });
          },
          args: [msg.action],
        });
        break;
      default:
        return send(gestErr('동작 찾기', `알 수 없는 제스처 동작입니다 (${msg.action})`, '팝업 블랙전용 탭에서 제스처 동작을 다시 고르세요.'));
    }
    send({ ok: true });
  })().catch((err) => send(gestErr(err?.step || '제스처 실행', `${err?.message || err}${err?.raw ? ` (${err.raw})` : ''}`, err?.hint || '다시 해 보세요. 계속 그러면 확장프로그램을 다시 켜 보세요.')));
  return true;
});
