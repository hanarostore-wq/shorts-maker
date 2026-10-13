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
      <label class="row-toggle">
        <div><b>구글 검색 결과는 새 탭으로</b><small>구글에서 검색한 뒤 결과 사이트를 누르면 항상 새 탭으로 엽니다 (구글 메뉴·다음 쪽은 그대로)</small></div>
        <input type="checkbox" id="blackGoogleNewTab" /><span class="sw"><i></i></span>
      </label>
      <label class="row-toggle">
        <div><b>북마크바 아이콘만</b><small>북마크바에 바로 있는 북마크의 이름을 숨기고 아이콘만 보이게 합니다. 원래 이름은 보관했다가 끄면 그대로 되돌립니다 (처음 켤 때 북마크 권한을 묻습니다 · 동기화 중이면 다른 기기 크롬에도 같이 적용)</small></div>
        <input type="checkbox" id="blackBmIcons" /><span class="sw"><i></i></span>
      </label>
      <label class="row-toggle">
        <div><b>폴더 이름도 숨기기</b><small>북마크바의 폴더도 아이콘만 보이게 합니다 (위 스위치가 켜져 있을 때)</small></div>
        <input type="checkbox" id="blackBmFolders" /><span class="sw"><i></i></span>
      </label>
      <p class="note" id="blackBmMsg" style="white-space:pre-line" hidden></p>
    </div>
    <div class="card">
      <div class="card-head"><div class="grow"><strong>비밀번호 관리</strong><small>크롬처럼 로그인하면 아이디·비밀번호를 저장하고, 다음에 그 사이트에서 자동으로 채웁니다. 이 PC 에만 보관합니다(동기화·설정 내보내기에 들어가지 않음, 잠금 없음)</small></div></div>
      <label class="row-toggle">
        <div><b>비밀번호 자동 입력</b><small>저장된 계정이 하나면 바로 채우고, 여러 개면 칸을 누를 때 고릅니다</small></div>
        <input type="checkbox" id="blackPwOn" /><span class="sw"><i></i></span>
      </label>
      <label class="row-toggle">
        <div><b>로그인하면 자동 저장</b><small>로그인하는 순간 저장하고 화면 아래에 [되돌리기] 알림을 띄웁니다 (확인 창 없음)</small></div>
        <input type="checkbox" id="blackPwSave" /><span class="sw"><i></i></span>
      </label>
      <div class="btns" style="display:flex;gap:8px;margin:8px 0">
        <button class="btn" type="button" id="pwImport">CSV 불러오기</button>
        <input type="file" id="pwFile" accept=".csv,text/csv" hidden />
        <input type="search" id="pwSearch" placeholder="사이트·아이디 찾기" style="flex:1;min-width:0" />
      </div>
      <p class="note" id="pwMsg" style="white-space:pre-line" hidden></p>
      <div id="pwCount" class="note"></div>
      <ul id="pwList" style="list-style:none;margin:0;padding:0;max-height:260px;overflow:auto"></ul>
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
  // 구글 검색 결과 새 탭
  const gt = pane.querySelector('#blackGoogleNewTab');
  chrome.storage.local.get('settings').then((r) => (gt.checked = r.settings?.blackGoogleNewTab !== false), () => {});
  gt.addEventListener('change', async () => {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...(settings || {}), blackGoogleNewTab: gt.checked } });
      say(gt.checked ? '구글 검색 결과 새 탭: 켜짐 (열린 구글 탭에도 바로 적용)' : '구글 검색 결과 새 탭: 꺼짐');
    } catch (err) {
      gt.checked = !gt.checked;
      say(`저장 실패 — 단계: 설정 저장 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`);
    }
  });

  // 비밀번호 관리
  {
    const on = pane.querySelector('#blackPwOn');
    const sv = pane.querySelector('#blackPwSave');
    const msgEl = pane.querySelector('#pwMsg');
    const list = pane.querySelector('#pwList');
    const search = pane.querySelector('#pwSearch');
    const pwSay = (t, err = false) => {
      msgEl.hidden = !t;
      msgEl.textContent = t;
      msgEl.style.color = err ? '#ff6b81' : '';
    };
    const errText = (what, e) => `${what} 실패\n단계: ${e.step}\n원인: ${e.reason}\n조치: ${e.action || '팝업을 닫았다 다시 여세요.'}`;
    chrome.storage.local.get('settings').then((r) => {
      on.checked = r.settings?.blackPwOn !== false;
      sv.checked = r.settings?.blackPwSave !== false;
    }, () => {});
    for (const [el, k] of [[on, 'blackPwOn'], [sv, 'blackPwSave']]) {
      el.addEventListener('change', async () => {
        try {
          const { settings } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({ settings: { ...(settings || {}), [k]: el.checked } });
        } catch (err) {
          el.checked = !el.checked;
          pwSay(errText('설정 저장', { step: '설정 저장', reason: err?.message || err }), true);
        }
      });
    }
    let items = [];
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const shownItems = items.filter((i) => !q || i.host.includes(q) || (i.username || '').toLowerCase().includes(q)).sort((a, b) => a.host.localeCompare(b.host));
      pane.querySelector('#pwCount').textContent = `저장된 비밀번호 ${items.length}개${q ? ` · 찾은 것 ${shownItems.length}개` : ''}`;
      list.innerHTML = '';
      for (const it of shownItems.slice(0, 300)) {
        const li = document.createElement('li');
        li.className = 'pw-item';
        li.style.cssText = 'display:flex;gap:6px;align-items:center;padding:6px 0;border-top:1px solid rgba(127,127,127,.15);font-size:12px';
        li.innerHTML = '<div style="flex:1;min-width:0;overflow:hidden"><b class="h" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></b><small class="u" style="display:block;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></small><code class="p" style="opacity:.8">●●●●●●</code></div><button type="button" class="link pw-show">보기</button><button type="button" class="link pw-del">지우기</button>';
        li.querySelector('.h').textContent = it.host;
        li.querySelector('.u').textContent = it.username || '(아이디 없음)';
        li.querySelector('.pw-show').addEventListener('click', (e) => {
          const p = li.querySelector('.p');
          const showing = e.target.textContent === '숨기기';
          p.textContent = showing ? '●●●●●●' : it.password;
          e.target.textContent = showing ? '보기' : '숨기기';
        });
        li.querySelector('.pw-del').addEventListener('click', async () => {
          try {
            const r = await chrome.runtime.sendMessage({ type: 'smd:pw-delete', id: it.id });
            if (r?.error) return pwSay(errText('지우기', r.error), true);
            items = items.filter((x) => x.id !== it.id);
            pwSay(`지웠습니다: ${it.host} ${it.username || ''}`);
            render();
          } catch (err) {
            pwSay(errText('지우기', { step: '확장 백그라운드 연결', reason: err?.message || err }), true);
          }
        });
        list.appendChild(li);
      }
    };
    const loadList = async () => {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'smd:pw-list' });
        if (r?.error) return pwSay(errText('비밀번호 목록', r.error), true);
        items = r.items || [];
        render();
      } catch (err) {
        pwSay(errText('비밀번호 목록', { step: '확장 백그라운드 연결', reason: err?.message || err }), true);
      }
    };
    search.addEventListener('input', render);
    tab.addEventListener('click', loadList);
    if (document.querySelector('.tab.on')?.dataset.tab === 'black') loadList();
    const file = pane.querySelector('#pwFile');
    pane.querySelector('#pwImport').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      pwSay('불러오는 중…');
      let text;
      try {
        text = await f.text();
      } catch (err) {
        return pwSay(errText('CSV 불러오기', { step: '파일 읽기', reason: err?.message || err, action: '파일을 다른 프로그램이 쓰고 있지 않은지 확인한 뒤 다시 고르세요.' }), true);
      }
      try {
        const r = await chrome.runtime.sendMessage({ type: 'smd:pw-import', text });
        if (r?.error) return pwSay(errText('CSV 불러오기', r.error), true);
        const sk = r.skipped?.length ? `\n건너뜀 ${r.skipped.length}줄: ${r.skipped.slice(0, 5).map((x) => `${x.line}째 줄(${x.why})`).join(', ')}${r.skipped.length > 5 ? ' …' : ''}` : '';
        pwSay(`불러오기 완료: 새로 ${r.added}개, 비밀번호 바뀜 ${r.updated}개, 이미 있음 ${r.same}개 (전체 ${r.total}개)${sk}\n※ CSV 파일에는 비밀번호가 그대로 적혀 있으니 바로 지우고 휴지통도 비우세요.`);
        loadList();
      } catch (err) {
        pwSay(errText('CSV 불러오기', { step: '확장 백그라운드 연결', reason: err?.message || err }), true);
      }
    });
  }

  // 북마크바 아이콘만
  const bm = pane.querySelector('#blackBmIcons');
  const bf = pane.querySelector('#blackBmFolders');
  const bmMsg = pane.querySelector('#blackBmMsg');
  const bmSay = (t, err = false) => {
    bmMsg.hidden = !t;
    bmMsg.textContent = t;
    bmMsg.style.color = err ? '#ff6b81' : '';
  };
  const showStatus = (st) => {
    if (!st) return;
    if (st.error) bmSay(`북마크바 아이콘만 실패\n단계: ${st.error.step}\n원인: ${st.error.reason}\n조치: ${st.error.action}`, true);
    else if (st.on) bmSay(`켜짐: 북마크바 ${st.hidden}개를 아이콘만 보이게 했습니다 (원래 이름 보관 중)`);
    else bmSay(st.restored ? `꺼짐: ${st.restored}개 이름을 되돌렸습니다` : '꺼짐');
  };
  chrome.storage.local.get(['settings', 'blackBmStatus']).then((r) => {
    bm.checked = r.settings?.blackBmIcons === true;
    bf.checked = r.settings?.blackBmFolders === true;
    if (bm.checked || r.blackBmStatus?.error) showStatus(r.blackBmStatus);
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.blackBmStatus && showStatus(c.blackBmStatus.newValue));
  const saveKey = async (k, v) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings || {}), [k]: v } });
  };
  bm.addEventListener('change', async () => {
    const want = bm.checked;
    try {
      // 권한 묻기는 누른 그 순간에 해야 한다(다른 기다림보다 먼저)
      if (want && !(await chrome.permissions.request({ permissions: ['bookmarks'] }))) {
        bm.checked = false;
        return bmSay("북마크바 아이콘만 실패\n단계: 북마크 권한 요청\n원인: 북마크 권한을 허용하지 않았습니다\n조치: 다시 켜고 묻는 창에서 '허용'을 누르세요.", true);
      }
      bmSay(want ? '바꾸는 중…' : '되돌리는 중…');
      await saveKey('blackBmIcons', want);
    } catch (err) {
      bm.checked = !want;
      bmSay(`북마크바 아이콘만 실패\n단계: ${want ? '북마크 권한 요청' : '설정 저장'}\n원인: ${err?.message || err}\n조치: 팝업을 닫았다 다시 열고 누르세요.`, true);
    }
  });
  bf.addEventListener('change', async () => {
    try {
      await saveKey('blackBmFolders', bf.checked);
    } catch (err) {
      bf.checked = !bf.checked;
      bmSay(`폴더 설정 저장 실패\n단계: 설정 저장\n원인: ${err?.message || err}\n조치: 팝업을 닫았다 다시 여세요.`, true);
    }
  });

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
