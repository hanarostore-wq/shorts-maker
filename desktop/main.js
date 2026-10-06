const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

// 관제실 주소. 배포본을 그대로 쓰되, 로컬 개발 중엔 CONTROL_URL로 바꿔 띄운다.
const CONTROL_URL = process.env.CONTROL_URL || "https://shorts-maker-omega.vercel.app";

// MoneyOS 관제실과 일반 탭의 로그인 세션을 앱 종료 뒤에도 유지한다.
// 블로그부서의 실제 자동화는 이 셸에서 재구현하지 않고, 원본 BlogAuto·
// Threads Auto Electron 앱이 각자의 로컬 저장소와 Chrome 연결을 사용한다.
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
const launchedApps = new Map();

function launchFullSourceApp(kind) {
  const folders = { naver: "naverblog-extention", threads: "threads-auto" };
  const folder = folders[kind];
  if (!folder) return;
  const cwd = path.join(__dirname, "apps", folder);
  const announce = (message) => {
    console.log(`[social-app] ${message}`);
    if (win && !win.isDestroyed()) win.webContents.send("agent:log", message);
  };
  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    announce(`${kind} 전체 원본 프로그램이 설치되지 않았습니다. desktop/install-full-source.ps1을 먼저 실행하세요.`);
    return;
  }
  const previous = launchedApps.get(kind);
  if (previous && previous.exitCode === null && !previous.killed) {
    announce(`${kind} 전체 원본 프로그램이 이미 실행 중입니다.`);
    return;
  }
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const childEnvironment = { ...process.env };
  delete childEnvironment.SOCIAL_CONTROL_KEY;
  const child = spawn(executable, ["start"], {
    cwd,
    env: childEnvironment,
    shell: process.platform === "win32",
    windowsHide: false,
    stdio: "ignore",
  });
  launchedApps.set(kind, child);
  child.once("error", (error) => { launchedApps.delete(kind); announce(`${kind} 실행 실패: ${error.message}`); });
  child.once("exit", (code) => { launchedApps.delete(kind); announce(`${kind} 전체 원본 프로그램 종료 (code ${code})`); });
  announce(`${kind} 전체 원본 프로그램 시작 · 별도 창에서 계정과 확장프로그램을 연결하세요.`);
}

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
    if (/^controlroom:\/\/launch\/(naver|threads)\/?$/i.test(target)) {
      if (isControlUrl(wc.getURL())) launchFullSourceApp(new URL(target).pathname.split("/")[1]);
      return { action: "deny" };
    }
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

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
