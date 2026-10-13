// 블랙전용(개인용 기능) — 팝업에 '블랙전용' 탭을 붙인다. popup.js 보다 먼저 읽혀야 탭 전환에 같이 들어간다.
// 유료판에서는 tools/make-paid.mjs 가 이 파일과 popup.html 의 <script> 줄을 빼서 탭 자체가 생기지 않는다.
(() => {
  const nav = document.querySelector('.tabs');
  const ink = nav?.querySelector('.tab-ink');
  const main = document.querySelector('main');
  if (!nav || !ink || !main) return;
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.tab = 'black';
  tab.setAttribute('role', 'tab');
  tab.textContent = '블랙전용';
  nav.insertBefore(tab, ink);
  const n = nav.querySelectorAll('.tab').length;
  nav.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  ink.style.width = `calc((100% - 8px) / ${n})`;

  const pane = document.createElement('section');
  pane.className = 'pane';
  pane.dataset.pane = 'black';
  pane.innerHTML = `<div class="card">
      <div class="card-head"><div class="grow"><strong>블랙전용</strong><small>나만 쓰는 기능입니다 (유료판에는 들어가지 않음)</small></div></div>
      <label class="row-toggle">
        <div><b>Alt+W 로 탭 닫기</b><small>지금 보고 있는 탭을 닫습니다. 웨일 기본 페이지(새 탭·설정·확장 스토어)에서는 동작하지 않으니 Ctrl+W 를 쓰세요</small></div>
        <input type="checkbox" id="blackAltW" /><span class="sw"><i></i></span>
      </label>
      <p class="note" id="blackMsg" hidden></p>
    </div>`;
  main.appendChild(pane);

  const cb = pane.querySelector('#blackAltW');
  const msg = pane.querySelector('#blackMsg');
  const say = (t) => {
    msg.hidden = !t;
    msg.textContent = t;
  };
  chrome.storage.local.get('settings').then(
    (r) => (cb.checked = r.settings?.blackAltW !== false),
    (err) => say(`설정 읽기 실패 — 단계: 설정 불러오기 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`),
  );
  cb.addEventListener('change', async () => {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...(settings || {}), blackAltW: cb.checked } });
      say(cb.checked ? '켜졌습니다. 열려 있던 탭은 새로고침(F5) 없이 바로 됩니다.' : '꺼졌습니다.');
    } catch (err) {
      cb.checked = !cb.checked;
      say(`저장 실패 — 단계: 설정 저장 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`);
    }
  });
})();
