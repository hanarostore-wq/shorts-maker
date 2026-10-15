// '이 사이트 제외' 서비스워커 쪽: 제외한 사이트에만 content/off.js 를 넣어 두고, 팝업의 켜고 끄기 요청을 처리한다.
import { getSettings, saveSettings } from '../shared/settings.js';
import { siteKey, excludePatterns } from '../shared/exclude.js';

const ID = 'smd-off';

// 등록된 것과 같으면 그대로 두고, 다르면 다시 등록
export async function syncExcludeScript(list) {
  const want = excludePatterns(list);
  const cur = await chrome.scripting.getRegisteredContentScripts({ ids: [ID] }).catch(() => []);
  if (JSON.stringify(cur[0]?.matches || []) === JSON.stringify(want)) return;
  if (cur.length) await chrome.scripting.unregisterContentScripts({ ids: [ID] });
  if (want.length) await chrome.scripting.registerContentScripts([{ id: ID, matches: want, js: ['content/off.js'], runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true }]);
}

const fail = (step, reason, action) => ({ error: { step, reason, action } });

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type !== 'smd:exclude-site') return;
  (async () => {
    const key = siteKey(msg.host);
    if (!key) return send(fail('사이트 확인', '웹 페이지(http·https)가 아니라서 제외할 사이트가 없습니다', '영상·사진이 있는 웹 페이지 탭에서 눌러 주세요.'));
    const s = await getSettings();
    const set = new Set((s.excludedSites || []).map(siteKey));
    if (msg.on) set.add(key);
    else set.delete(key);
    const list = [...set];
    await saveSettings({ excludedSites: list });
    try {
      await syncExcludeScript(list);
    } catch (err) {
      return send(fail('제외 표시 등록', `브라우저가 이 사이트에 제외 표시를 등록하지 못했습니다 (${err?.message || err})`, '확장프로그램을 껐다 켠 뒤 다시 눌러 보세요.'));
    }
    // 이미 열려 있는 이 탭은 새로고침해야 적용된다(제외 표시는 문서가 시작될 때 들어감)
    if (msg.tabId) await chrome.tabs.reload(msg.tabId).catch(() => {});
    send({ ok: true, list });
  })().catch((err) => send(fail('설정 저장', `${err?.message || err}`, '팝업을 닫았다 다시 열어 보세요.')));
  return true;
});

// 확장이 켜질 때마다 설정과 등록 상태를 맞춘다(다른 PC 설정 가져오기·초기화 등으로 어긋난 경우)
const resync = () => getSettings().then((s) => syncExcludeScript(s.excludedSites || [])).catch(() => {});
chrome.runtime.onInstalled.addListener(resync);
chrome.runtime.onStartup.addListener(resync);
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.settings && JSON.stringify(c.settings.oldValue?.excludedSites || []) !== JSON.stringify(c.settings.newValue?.excludedSites || [])) resync();
});
