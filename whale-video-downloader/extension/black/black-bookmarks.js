// 블랙전용(개인용 기능) — 북마크바 아이콘만 보이기. 유료판에서는 tools/make-paid.mjs 가 이 파일과 import 줄, 'bookmarks' 권한을 뺀다.
//  - 켜면(blackBmIcons) 북마크바 바로 아래 북마크의 제목을 확장 저장소(blackBmTitles)에 보관하고 이름을 비운다 → 아이콘만 보임
//  - 끄면 보관한 제목으로 되돌린다. 켜 둔 동안 북마크바에 새로 넣거나 옮겨 온 북마크도 이름을 비운다(이름을 새로 쓰면 그 이름을 보관)
//  - 폴더 이름도 비우기(blackBmFolders, 기본 끔)
//  - 결과·오류는 blackBmStatus 에 남겨 팝업이 보여 준다(단계·원인·조치)
const KEY = 'blackBmTitles';
const STATUS = 'blackBmStatus';
let busy = Promise.resolve();
const queue = (fn) => (busy = busy.then(fn, fn).catch(() => {}));
const ourEdits = new Set(); // 우리가 이름을 바꾼 북마크(그 변경 알림은 무시)

const setStatus = (s) => chrome.storage.local.set({ [STATUS]: { ...s, at: Date.now() } }).catch(() => {});
async function cfg() {
  const { settings } = await chrome.storage.local.get('settings');
  return { on: settings?.blackBmIcons === true, folders: settings?.blackBmFolders === true };
}
async function barNode() {
  const [root] = await chrome.bookmarks.getTree();
  return root.children.find((c) => c.folderType === 'bookmarks-bar') || root.children[0];
}
async function rename(id, title) {
  ourEdits.add(id);
  try {
    await chrome.bookmarks.update(id, { title });
  } finally {
    setTimeout(() => ourEdits.delete(id), 500);
  }
}
const wanted = (node, folders) => (node.url ? true : folders);

async function applyAll() {
  const c = await cfg();
  if (!chrome.bookmarks) {
    if (c.on) await setStatus({ error: { step: '북마크 권한 확인', reason: '북마크를 바꿀 권한이 없습니다', action: "팝업 '블랙전용'에서 스위치를 끈 뒤 다시 켜고, 묻는 창에서 '허용'을 누르세요." } });
    return;
  }
  const saved = (await chrome.storage.local.get(KEY))[KEY] || {};
  const bar = await barNode();
  const kids = bar.children || [];
  // 1) 되돌릴 것: 꺼졌거나, 폴더 비우기를 껐는데 폴더가 비워져 있거나, 북마크바 밖으로 옮겨진 것
  const inBar = new Map(kids.map((k) => [k.id, k]));
  let restored = 0;
  for (const [id, title] of Object.entries(saved)) {
    const node = inBar.get(id);
    if (c.on && node && wanted(node, c.folders)) continue;
    try {
      const [cur] = await chrome.bookmarks.get(id);
      if (cur && cur.title === '') {
        await rename(id, title);
        restored++;
      }
    } catch {} // 지워진 북마크
    delete saved[id];
  }
  // 2) 비울 것
  let hidden = 0;
  if (c.on) {
    for (const k of kids) {
      if (!wanted(k, c.folders) || k.title === '') continue;
      saved[k.id] = k.title;
      await rename(k.id, '');
      hidden++;
    }
  }
  await chrome.storage.local.set({ [KEY]: saved });
  await setStatus({ ok: true, on: c.on, hidden: Object.keys(saved).length, changed: hidden, restored });
}
const run = () =>
  queue(() =>
    applyAll().catch((err) =>
      setStatus({ error: { step: '북마크 이름 바꾸기', reason: `브라우저가 북마크를 바꾸지 못했습니다 (${err?.message || err})`, action: "스위치를 껐다 다시 켜 보세요. 계속 그러면 북마크 관리자(Ctrl+Shift+O)에서 북마크바가 있는지 확인하세요." } }),
    ),
  );

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.settings) return;
  const o = ch.settings.oldValue || {};
  const n = ch.settings.newValue || {};
  if (o.blackBmIcons !== n.blackBmIcons || o.blackBmFolders !== n.blackBmFolders) run();
});

// 북마크 이벤트: 권한이 나중에 생겨도 듣도록, 권한이 생기면 붙인다
let hooked = false;
function hook() {
  if (hooked || !chrome.bookmarks) return;
  hooked = true;
  chrome.bookmarks.onCreated.addListener(() => run());
  chrome.bookmarks.onMoved.addListener(() => run());
  chrome.bookmarks.onChanged.addListener((id, info) => {
    if (ourEdits.has(id)) return;
    // 켜 둔 동안 사용자가 북마크바 북마크 이름을 새로 쓰면 그 이름을 보관하고 다시 비운다
    if (info.title)
      queue(async () => {
        const c = await cfg();
        if (!c.on) return;
        const saved = (await chrome.storage.local.get(KEY))[KEY] || {};
        if (id in saved) {
          saved[id] = info.title;
          await chrome.storage.local.set({ [KEY]: saved });
          await rename(id, '');
        }
      }).then(run);
  });
}
hook();
chrome.permissions?.onAdded?.addListener(() => {
  hook();
  run();
});
chrome.permissions?.onRemoved?.addListener(() => run());
run();
