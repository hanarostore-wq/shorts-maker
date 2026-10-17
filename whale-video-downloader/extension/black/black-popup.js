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
        <div><b>픽팍 재생 버튼 → 팟플레이어 (원본 화질)</b><small>mypikpak.com 의 내 파일(모든 파일)에서 영상 카드의 ▶ 를 누르면 픽팍 기본 플레이어 대신 팟플레이어로 바로 재생합니다. 화질은 원본만, 선택 창 없음. 원본 항목을 못 찾거나 권한이 없으면 이유를 알려 주고 [기본 플레이어로 재생]을 고를 수 있게 합니다. Shift·Ctrl·Alt 를 누르고 누르면 원래대로 (처음 한 번 크롬이 "외부 프로그램 열기"를 물으면 허용 · 팟플레이어가 설치되어 있어야 하고, 영상 주소를 클립보드에 쓰므로 클립보드가 바뀝니다 · 바꾼 뒤 픽팍 탭 새로고침)</small></div>
        <input type="checkbox" id="blackPikpak" /><span class="sw"><i></i></span>
      </label>
      <label class="row-toggle">
        <div><b>픽팍 폴더 뒤로가기 → 스크롤 위치 복원</b><small>픽팍에서 폴더에 들어갔다가 뒤로가기를 하면 목록이 맨 위로 가 버리는 것을, 떠나기 전 위치로 되돌립니다. 복원하는 동안 목록을 잠깐(최대 2.5초) 숨겨 내려가는 모습이 보이지 않게 합니다 (바꾼 뒤 픽팍 탭 새로고침)</small></div>
        <input type="checkbox" id="blackPikpakScroll" /><span class="sw"><i></i></span>
      </label>
      <label class="row-toggle">
        <div><b>픽팍 카드 × 표시 (폴더·영상)</b><small>카드에 마우스를 올리면 오른쪽 위에 × 가 나옵니다. 내 드라이브에서는 누르면 그 파일·폴더를 휴지통으로 보냅니다(확인창 없음 · 휴지통에서 복구 가능 · 영구 삭제 아님). 공유 링크에서는 서버에 아무 일도 없이 내 화면에서만 가려지고(이 브라우저에 기억), 왼쪽 아래 [가린 N개 · 모두 보기]로 되돌립니다 (바꾼 뒤 픽팍 탭 새로고침)</small></div>
        <input type="checkbox" id="blackPikpakX" /><span class="sw"><i></i></span>
      </label>
      <label class="row-toggle">
        <div><b>픽팍 사진 누르면 뷰어 닫기</b><small>픽팍(내 드라이브·공유 링크)의 사진 뷰어에서 사진을 누르면 확대하지 않고 뷰어를 닫습니다. 끌어서 옮기는 동작·아래 조절 막대·단추는 그대로입니다 (바꾼 뒤 픽팍 탭 새로고침)</small></div>
        <input type="checkbox" id="blackPikpakPhoto" /><span class="sw"><i></i></span>
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
      <div class="card-head"><div class="grow"><strong>마우스 제스처</strong><small>마우스 오른쪽 버튼을 누른 채 끌면 동작합니다. 끄는 동안 선과 동작 이름이 보이고, 버튼을 떼면 바로 실행됩니다. 가만히 누르면 원래 오른쪽 클릭 메뉴, Shift·Ctrl·Alt 를 누른 채면 제스처 없이 원래대로 동작합니다</small></div></div>
      <label class="row-toggle">
        <div><b>마우스 제스처 사용</b><small>켜면 모든 사이트에서 오른쪽 드래그로 동작합니다 (열려 있던 탭은 새로고침(F5) 한 번 뒤부터)</small></div>
        <input type="checkbox" id="blackGesture" /><span class="sw"><i></i></span>
      </label>
      <div id="gestRows" style="display:grid;gap:6px;margin:8px 0"></div>
      <div class="btns" style="display:flex;gap:8px"><button class="btn ghost" type="button" id="gestReset">기본값으로</button></div>
      <p class="note" id="gestMsg" style="white-space:pre-line" hidden></p>
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
  // 픽팍 팟플레이어 재생
  {
    const pk = pane.querySelector('#blackPikpak');
    chrome.storage.local.get('settings').then((r) => (pk.checked = r.settings?.blackPikpak !== false), () => {});
    pk.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...(settings || {}), blackPikpak: pk.checked } });
        say(pk.checked ? '픽팍 팟플레이어 재생: 켜짐 (열려 있는 픽팍 탭에도 바로 적용)' : '픽팍 팟플레이어 재생: 꺼짐');
      } catch (err) {
        pk.checked = !pk.checked;
        say(`저장 실패 — 단계: 설정 저장 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`);
      }
    });
  }

  // 픽팍 폴더 뒤로가기 스크롤 복원
  {
    const ps = pane.querySelector('#blackPikpakScroll');
    chrome.storage.local.get('settings').then((r) => (ps.checked = r.settings?.blackPikpakScroll !== false), () => {});
    ps.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...(settings || {}), blackPikpakScroll: ps.checked } });
        say(ps.checked ? '픽팍 스크롤 위치 복원: 켜짐 (열려 있는 픽팍 탭에도 바로 적용)' : '픽팍 스크롤 위치 복원: 꺼짐');
      } catch (err) {
        ps.checked = !ps.checked;
        say(`저장 실패 — 단계: 설정 저장 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`);
      }
    });
  }

  // 픽팍 카드 × 표시
  {
    const px = pane.querySelector('#blackPikpakX');
    chrome.storage.local.get('settings').then((r) => (px.checked = r.settings?.blackPikpakX !== false), () => {});
    px.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...(settings || {}), blackPikpakX: px.checked } });
        say(px.checked ? '픽팍 카드 ×: 켜짐 (열려 있는 픽팍 탭에도 바로 적용)' : '픽팍 카드 ×: 꺼짐');
      } catch (err) {
        px.checked = !px.checked;
        say(`저장 실패 — 단계: 설정 저장 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`);
      }
    });
  }

  // 픽팍 사진 누르면 뷰어 닫기
  {
    const pp = pane.querySelector('#blackPikpakPhoto');
    chrome.storage.local.get('settings').then((r) => (pp.checked = r.settings?.blackPikpakPhoto !== false), () => {});
    pp.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...(settings || {}), blackPikpakPhoto: pp.checked } });
        say(pp.checked ? '픽팍 사진 뷰어 닫기: 켜짐 (열려 있는 픽팍 탭에도 바로 적용)' : '픽팍 사진 뷰어 닫기: 꺼짐');
      } catch (err) {
        pp.checked = !pp.checked;
        say(`저장 실패 — 단계: 설정 저장 / 원인: ${err?.message || err} / 조치: 팝업을 닫았다 다시 여세요.`);
      }
    });
  }

  // 마우스 제스처
  {
    const core = globalThis.__SMD_GESTURE_CORE;
    const on = pane.querySelector('#blackGesture');
    const rows = pane.querySelector('#gestRows');
    const gMsg = pane.querySelector('#gestMsg');
    const gSay = (t, err = false) => {
      gMsg.hidden = !t;
      gMsg.textContent = t;
      gMsg.style.color = err ? '#ff6b81' : '';
    };
    const gErr = (what, err) => `${what} 실패\n단계: 설정 저장\n원인: ${err?.message || err}\n조치: 팝업을 닫았다 다시 여세요.`;
    if (!core) {
      gSay('제스처 계산 파일을 읽지 못했습니다\n단계: 팝업 열기\n원인: black-gesture-core.js 가 없습니다\n조치: 확장프로그램을 다시 설치(업데이트 bat 실행)하세요.', true);
    } else {
      let map = core.sanitizeMap(null);
      const draw = () => {
        rows.innerHTML = '';
        for (const k of Object.keys(core.DEFAULT_MAP)) {
          const r = document.createElement('label');
          r.style.cssText = 'display:flex;align-items:center;gap:10px';
          const sel = document.createElement('select');
          sel.style.cssText = 'flex:1;min-width:0;width:auto';
          for (const [v, name] of Object.entries(core.ACTIONS)) sel.add(new Option(name, v));
          sel.value = map[k];
          sel.addEventListener('change', async () => {
            const prev = map[k];
            try {
              map = { ...map, [k]: sel.value };
              const { settings } = await chrome.storage.local.get('settings');
              await chrome.storage.local.set({ settings: { ...(settings || {}), blackGestureMap: map } });
              gSay(`${core.arrows(k)} → ${core.ACTIONS[sel.value]} (열려 있는 탭에도 바로 적용)`);
            } catch (err) {
              map[k] = sel.value = prev;
              gSay(gErr('제스처 동작 저장', err), true);
            }
          });
          const lab = document.createElement('span');
          lab.textContent = core.arrows(k);
          lab.style.cssText = 'width:44px;font-weight:800;font-size:15px;text-align:center';
          r.append(lab, sel);
          rows.appendChild(r);
        }
      };
      chrome.storage.local.get('settings').then(
        (r) => {
          on.checked = r.settings?.blackGesture !== false;
          map = core.sanitizeMap(r.settings?.blackGestureMap);
          draw();
        },
        (err) => gSay(`설정 읽기 실패\n단계: 설정 불러오기\n원인: ${err?.message || err}\n조치: 팝업을 닫았다 다시 여세요.`, true),
      );
      on.addEventListener('change', async () => {
        try {
          const { settings } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({ settings: { ...(settings || {}), blackGesture: on.checked } });
          gSay(on.checked ? '제스처를 켰습니다.' : '제스처를 껐습니다.');
        } catch (err) {
          on.checked = !on.checked;
          gSay(gErr('제스처 켜고 끄기 저장', err), true);
        }
      });
      pane.querySelector('#gestReset').addEventListener('click', async () => {
        try {
          const { settings } = await chrome.storage.local.get('settings');
          const next = { ...(settings || {}) };
          delete next.blackGestureMap;
          await chrome.storage.local.set({ settings: next });
          map = core.sanitizeMap(null);
          draw();
          gSay('제스처 동작을 기본값으로 되돌렸습니다.');
        } catch (err) {
          gSay(gErr('기본값 되돌리기', err), true);
        }
      });
    }
  }
})();
