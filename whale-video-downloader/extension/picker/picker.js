import { idbGet, idbSet, DIR_KEY } from '../shared/idb.js';
import { saveSettings } from '../shared/settings.js';

const $ = (s) => document.querySelector(s);
const mode = new URLSearchParams(location.search).get('mode') || 'pick';
const action = $('#action');
const msg = $('#msg');

const say = (text, kind = '') => {
  msg.textContent = text;
  msg.className = `msg ${kind}`;
};

async function refresh() {
  const h = await idbGet(DIR_KEY).catch(() => null);
  if (!h) {
    $('#current').textContent = '선택된 폴더 없음';
    $('#state').textContent = '아래 버튼을 눌러 폴더를 고르세요';
    return null;
  }
  const st = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
  $('#current').textContent = h.name;
  $('#state').textContent = st === 'granted' ? '✓ 쓰기 권한 허용됨' : '권한 허용이 필요합니다';
  $('#state').className = st === 'granted' ? 'ok' : 'warn';
  return { h, st };
}

const cur = await refresh();
if (mode === 'regrant' && cur?.h) {
  $('#title').textContent = '저장 폴더 권한 허용';
  action.textContent = cur.st === 'granted' ? '이미 허용됨 · 창 닫기' : `"${cur.h.name}" 폴더 권한 허용`;
}

const done = (text) => {
  say(text, 'ok');
  action.textContent = '완료 · 창 닫기';
  action.onclick = () => window.close();
  setTimeout(() => window.close(), 1600);
};

action.addEventListener('click', async () => {
  if (action.textContent.includes('창 닫기')) return window.close();
  say('');
  try {
    if (mode === 'regrant' && cur?.h) {
      const st = await cur.h.requestPermission({ mode: 'readwrite' });
      await refresh();
      if (st === 'granted') {
        await saveSettings({ saveMode: 'folder', folderName: cur.h.name });
        return done(`"${cur.h.name}" 폴더에 다시 저장할 수 있어요.`);
      }
      return say('권한이 허용되지 않았어요. 버튼을 다시 누르고 브라우저 안내창에서 "허용"을 선택하세요.', 'err');
    }
    if (!window.showDirectoryPicker) {
      return say('이 브라우저 버전은 폴더 직접 선택을 지원하지 않아요. 웨일을 최신 버전으로 업데이트하거나 "다운로드 폴더" 방식을 사용하세요.', 'err');
    }
    const handle = await window.showDirectoryPicker({ id: 'smd-save', mode: 'readwrite', startIn: 'downloads' });
    let st = await handle.queryPermission({ mode: 'readwrite' });
    if (st !== 'granted') st = await handle.requestPermission({ mode: 'readwrite' });
    if (st !== 'granted') return say('폴더 쓰기 권한이 거부됐어요. 다시 선택하고 "파일 수정 허용"을 눌러 주세요.', 'err');
    await idbSet(DIR_KEY, handle);
    await saveSettings({ saveMode: 'folder', folderName: handle.name });
    await refresh();
    done(`"${handle.name}" 폴더에 저장하도록 설정했어요.`);
  } catch (err) {
    if (err?.name === 'AbortError') return say('폴더 선택을 취소했어요. 다시 누르면 고를 수 있어요.', 'err');
    if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
      return say(`이 폴더는 보안 정책상 사용할 수 없어요 (${err.name}). 다운로드 폴더 안에 새 폴더를 만들어 선택하세요.`, 'err');
    }
    say(`폴더를 설정하지 못했어요: ${err?.message || err}. 다시 시도하세요.`, 'err');
  }
});
