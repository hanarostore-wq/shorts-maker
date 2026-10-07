const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { concatOriginalQuality } = require("./videoConcat");

const CONTROL_URL = process.env.CONTROL_URL || "https://shorts-maker-omega.vercel.app";
let workerWindow = null;
let isRunning = false;

function publish(payload) {
  if (workerWindow && !workerWindow.isDestroyed()) workerWindow.webContents.send("concat-worker:progress", payload);
}

function curlPatch(url, payload) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" ? "curl.exe" : "curl";
    const child = spawn(executable, ["--http1.1", "--silent", "--show-error", "--fail", "-X", "PATCH", "-H", "Content-Type: application/json", "--data-binary", "@-", url], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `curl 종료 코드: ${code}`)));
    child.stdin.end(JSON.stringify(payload));
  });
}

async function updateRemoteStatus(job, status, extra = {}) {
  if (!job?.id || !job?.token) return;
  const url = `${CONTROL_URL.replace(/\/$/, "")}/api/concat/jobs/${encodeURIComponent(job.id)}`;
  const payload = { token: job.token, status, ...extra };
  try {
    const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`상태 저장 HTTP ${response.status}`);
  } catch (error) {
    try { await curlPatch(url, payload); }
    catch (curlError) { console.error("[concat-worker] 상태 저장 실패", error instanceof Error ? error.message : error, curlError instanceof Error ? curlError.message : curlError); }
  }
}

async function openProgressWindow() {
  workerWindow = new BrowserWindow({ width: 520, height: 270, resizable: false, maximizable: false, minimizable: true, autoHideMenuBar: true, backgroundColor: "#07090d", title: "이어붙이기 · 로컬 처리 중", webPreferences: { preload: path.join(__dirname, "concat-worker-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  workerWindow.on("close", (event) => { if (isRunning) { event.preventDefault(); workerWindow.hide(); } });
  await workerWindow.loadFile(path.join(__dirname, "concat-worker.html"));
  return workerWindow;
}

async function runLocalConcatWorker({ jobId = null, token = null, processingMode = "copy" } = {}) {
  const job = jobId && token ? { id: jobId, token } : null;
  const selection = await dialog.showOpenDialog({ title: "이어붙일 원본 MP4 선택", properties: ["openFile", "multiSelections"], filters: [{ name: "MP4 파일", extensions: ["mp4"] }] });
  if (selection.canceled || selection.filePaths.length < 2) {
    await updateRemoteStatus(job, "canceled");
    app.quit();
    return;
  }

  let sourceBytes = 0;
  let startedAt = 0;
  let statusQueue = Promise.resolve();
  let lastProgressReport = 0;
  const queueStatus = (status, extra = {}) => {
    statusQueue = statusQueue.then(() => updateRemoteStatus(job, status, extra));
    return statusQueue;
  };
  const reportProgress = (payload) => {
    const now = Date.now();
    const progress = Number.isFinite(payload.progress) ? Math.max(0, Math.min(1, payload.progress)) : undefined;
    const elapsedSeconds = startedAt ? (now - startedAt) / 1000 : 0;
    const etaSeconds = progress && progress > 0.02 ? Math.max(0, Math.round((elapsedSeconds / progress) * (1 - progress))) : undefined;
    const enriched = { ...payload, progress, etaSeconds };
    publish(enriched);
    if (now - lastProgressReport < 1300 && payload.phase !== "done") return;
    lastProgressReport = now;
    void queueStatus("working", { sourceBytes, progress, etaSeconds, stage: payload.message });
  };

  try {
    sourceBytes = (await Promise.all(selection.filePaths.map(async (filePath) => (await fs.stat(filePath)).size))).reduce((sum, size) => sum + size, 0);
    await openProgressWindow();
    isRunning = true;
    startedAt = Date.now();
    await queueStatus("working", { sourceBytes, progress: 0, stage: "원본 규격 확인 중" });
    const output = await concatOriginalQuality(selection.filePaths, undefined, { onProgress: reportProgress, processingMode: processingMode === "normalize" ? "normalize" : "copy" });
    const outputBytes = (await fs.stat(output.outputPath)).size;
    publish({ phase: "done", current: output.sourceCount, total: output.sourceCount, progress: 1, etaSeconds: 0, message: "제작완료 · 작업자가 자동으로 종료됩니다." });
    await statusQueue;
    await queueStatus("completed", { outputName: path.basename(output.outputPath), sourceBytes, outputBytes, progress: 1, etaSeconds: 0, stage: "제작완료" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    publish({ phase: "error", current: 0, total: 0, message });
    await statusQueue;
    await queueStatus("failed", { sourceBytes, error: message, stage: "제작실패" });
  } finally {
    isRunning = false;
    if (workerWindow && !workerWindow.isDestroyed()) workerWindow.close();
    app.quit();
  }
}

module.exports = { runLocalConcatWorker };
