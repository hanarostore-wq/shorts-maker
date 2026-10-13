// 블랙전용(개인용 기능) — 서비스워커 쪽. 유료판에서는 tools/make-paid.mjs 가 이 파일과 import 줄을 뺀다.
//  - 'smd:black-close-tab': Alt+W 를 누른 그 탭을 닫는다
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
