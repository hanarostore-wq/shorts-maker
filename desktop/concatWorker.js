const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const { concatOriginalQuality } = require("./videoConcat");

let workerWindow = null;
let isRunning = false;

function publish(payload) {
  if (workerWindow && !workerWindow.isDestroyed()) workerWindow.webContents.send("concat-worker:progress", payload);
}

async function openProgressWindow() {
  workerWindow = new BrowserWindow({
    width: 520,
    height: 270,
    resizable: false,
    maximizable: false,
    minimizable: true,
    autoHideMenuBar: true,
    backgroundColor: "#07090d",
    title: "이어붙이기 · 로컬 처리 중",
    webPreferences: {
      preload: path.join(__dirname, "concat-worker-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  workerWindow.on("close", (event) => {
    if (isRunning) event.preventDefault();
  });
  await workerWindow.loadFile(path.join(__dirname, "concat-worker.html"));
  return workerWindow;
}

async function runLocalConcatWorker() {
  const selection = await dialog.showOpenDialog({
    title: "이어붙일 원본 영상 선택",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "영상 파일", extensions: ["mp4", "m4v", "mov", "mkv", "webm"] }],
  });
  if (selection.canceled || selection.filePaths.length < 2) {
    if (!selection.canceled) await dialog.showMessageBox({ type: "warning", title: "이어붙이기", message: "원본 영상을 2개 이상 선택하세요." });
    app.quit();
    return;
  }

  await openProgressWindow();
  isRunning = true;
  try {
    publish({ phase: "prepare", current: 0, total: selection.filePaths.length, message: "원본 규격을 확인하는 중입니다." });
    const output = await concatOriginalQuality(selection.filePaths, undefined, { onProgress: publish });
    publish({ phase: "done", current: output.sourceCount, total: output.sourceCount, message: "완료했습니다. 출력 폴더를 열었습니다." });
    shell.showItemInFolder(output.outputPath);
    await dialog.showMessageBox(workerWindow, {
      type: "info",
      title: "이어붙이기 완료",
      message: "원본 영상 이어붙이기가 완료됐습니다.",
      detail: output.outputPath,
      buttons: ["확인"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    publish({ phase: "error", current: 0, total: 0, message });
    await dialog.showMessageBox(workerWindow, { type: "error", title: "이어붙이기 실패", message, buttons: ["확인"] });
  } finally {
    isRunning = false;
    if (workerWindow && !workerWindow.isDestroyed()) workerWindow.close();
    app.quit();
  }
}

module.exports = { runLocalConcatWorker };
