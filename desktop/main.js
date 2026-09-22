const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require("electron");
const path = require("node:path");
const { startAgentRuntime, stopAgentRuntime } = require("./agent/runtime");

// 관제실 주소. 배포본을 그대로 쓰되, 로컬 개발 중엔 CONTROL_URL로 바꿔 띄운다.
const CONTROL_URL = process.env.CONTROL_URL || "https://shorts-maker-omega.vercel.app";

// 로그인 세션이 앱을 껐다 켜도 유지되도록 영속 파티션을 쓴다. 이게 이
// 브라우저의 핵심이다 — 에이전트는 담당자가 이미 로그인해 둔 세션 위에서
// 일한다. 자격증명을 코드나 환경변수로 들고 있지 않는다.
const PARTITION = "persist:unyoung";

const CHROME_HEIGHT = 106; // 탭 바 + 주소창 + 에이전트 상태줄 (renderer/index.html과 맞춰야 함)

/** @type {BrowserWindow | null} */
let win = null;

/**
 * 열려 있는 탭들.
 * @type {Array<{ id: number, view: WebContentsView, pinned: boolean }>}
 */
const tabs = [];
let activeTabId = null;
let nextTabId = 1;

function isControlUrl(url) {
  try {
    return new URL(url).origin === new URL(CONTROL_URL).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#000000",
    title: "운영본부 브라우저",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.on("resize", layoutActiveTab);
  win.on("closed", () => {
    win = null;
  });
}

/** 활성 탭을 크롬(탭바/주소창) 아래 영역에 꽉 채운다. */
function layoutActiveTab() {
  if (!win) return;
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  const { width, height } = win.getContentBounds();
  tab.view.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width,
    height: Math.max(0, height - CHROME_HEIGHT),
  });
}

function sendTabState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(
    "tabs:state",
    tabs.map((t) => ({
      id: t.id,
      pinned: t.pinned,
      active: t.id === activeTabId,
      title: t.view.webContents.getTitle() || "새 탭",
      url: t.view.webContents.getURL(),
      loading: t.view.webContents.isLoading(),
      canGoBack: t.view.webContents.navigationHistory.canGoBack(),
      canGoForward: t.view.webContents.navigationHistory.canGoForward(),
    })),
  );
}

function createTab(url, { pinned = false } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      // 외부 사이트가 로드되는 뷰다. 셸의 preload(IPC 통로)를 절대 붙이지
      // 않는다. 붙이면 아무 웹페이지나 앱 내부 기능을 호출할 수 있게 된다.
      session: session.fromPartition(PARTITION),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const tab = { id: nextTabId++, view, pinned };
  tabs.push(tab);

  const wc = view.webContents;
  for (const event of ["page-title-updated", "did-navigate", "did-navigate-in-page", "did-finish-load", "did-start-loading", "did-stop-loading"]) {
    wc.on(event, sendTabState);
  }

  // 새 창을 여는 링크는 창 대신 새 탭으로 연다. 단 외부 앱으로 넘어가는
  // 스킴(mailto: 등)은 OS에 맡긴다.
  wc.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) {
      createTab(target);
      return { action: "deny" };
    }
    shell.openExternal(target).catch(() => null);
    return { action: "deny" };
  });

  wc.loadURL(url).catch(() => null);
  return tab;
}

function activateTab(id) {
  if (!win) return;
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  for (const other of tabs) {
    if (other.id !== id) win.contentView.removeChildView(other.view);
  }
  win.contentView.addChildView(tab.view);
  activeTabId = id;
  layoutActiveTab();
  sendTabState();
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  // 관제실 탭은 이 브라우저의 홈이므로 닫지 못하게 한다.
  if (tabs[index].pinned) return;

  const [tab] = tabs.splice(index, 1);
  if (win) win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();

  if (activeTabId === id) {
    const fallback = tabs[index] ?? tabs[index - 1] ?? tabs[0];
    if (fallback) activateTab(fallback.id);
  }
  sendTabState();
}

/** 주소창에 입력한 값을 URL로 해석한다. 주소가 아니면 검색으로 넘긴다. */
function toUrl(input) {
  const text = String(input || "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

app.whenReady().then(() => {
  createWindow();

  // 관제실을 첫 번째 고정 탭으로 심는다. 앱을 켜면 항상 여기서 시작한다.
  const home = createTab(CONTROL_URL, { pinned: true });
  activateTab(home.id);

  // 관제실에서 내려온 작업을 실제로 수행하는 워커. 담당자가 로그인해 둔
  // 세션을 그대로 쓰도록 탭과 같은 파티션을 넘긴다.
  startAgentRuntime({
    controlUrl: CONTROL_URL,
    partition: PARTITION,
    // 지시에 주소가 적혀 있으면 거기서, 없으면 담당자가 지금 보고 있는
    // 화면에서 이어서 시작한다. 관제실 탭은 업무 화면이 아니므로 뺀다.
    getStartUrl: (instruction) => {
      const inUrl = String(instruction || "").match(/https?:\/\/[^\s,]+/);
      if (inUrl) return inUrl[0];
      const active = tabs.find((t) => t.id === activeTabId);
      const url = active?.view.webContents.getURL() ?? "";
      return url && !isControlUrl(url) ? url : null;
    },
    log: (message) => {
      console.log(`[agent] ${message}`);
      if (win && !win.isDestroyed()) win.webContents.send("agent:log", message);
    },
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopAgentRuntime);

// --- 셸(renderer)이 부르는 기능들 ---

ipcMain.handle("tabs:list", () => {
  sendTabState();
});

ipcMain.handle("tabs:new", (_e, url) => {
  const tab = createTab(toUrl(url) || CONTROL_URL);
  activateTab(tab.id);
});

ipcMain.handle("tabs:activate", (_e, id) => activateTab(id));
ipcMain.handle("tabs:close", (_e, id) => closeTab(id));

ipcMain.handle("tabs:navigate", (_e, { id, url }) => {
  const tab = tabs.find((t) => t.id === id);
  const target = toUrl(url);
  if (!tab || !target) return;
  tab.view.webContents.loadURL(target).catch(() => null);
});

ipcMain.handle("tabs:back", (_e, id) => {
  const tab = tabs.find((t) => t.id === id);
  if (tab?.view.webContents.navigationHistory.canGoBack()) {
    tab.view.webContents.navigationHistory.goBack();
  }
});

ipcMain.handle("tabs:forward", (_e, id) => {
  const tab = tabs.find((t) => t.id === id);
  if (tab?.view.webContents.navigationHistory.canGoForward()) {
    tab.view.webContents.navigationHistory.goForward();
  }
});

ipcMain.handle("tabs:reload", (_e, id) => {
  const tab = tabs.find((t) => t.id === id);
  tab?.view.webContents.reload();
});

ipcMain.handle("app:info", () => ({
  controlUrl: CONTROL_URL,
  isControlTabPinned: tabs.some((t) => t.pinned && isControlUrl(t.view.webContents.getURL())),
}));
