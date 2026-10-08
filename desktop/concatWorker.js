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

function cancellationError() {
  const error = new Error("사용자 요청으로 이어붙이기 작업을 취소했습니다.");
  error.code = "CONCAT_CANCELED";
  return error;
}

function readableWorkerError(error, sourceCount) {
  if (error?.code === "CONCAT_CANCELED") return "사용자 요청으로 작업을 취소했습니다.";
  if (error?.code === "ENAMETOOLONG" || /ENAMETOOLONG/i.test(error?.message || "")) {
    return `${sourceCount}개 파일을 한 번에 FFmpeg에 전달하면서 Windows 명령줄 길이 제한에 도달했습니다. PC 작업자를 업데이트하면 파일을 하나씩 묶음 처리합니다.`;
  }
  if (error?.code === "ENOENT") return "로컬 FFmpeg 실행 파일을 찾지 못했습니다. PC 작업자를 업데이트한 뒤 다시 실행하세요.";
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

function curlRequest(url, args) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" ? "curl.exe" : "curl";
    const child = spawn(executable, ["--http1.1", "--silent", "--show-error", "--fail", ...args, url], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `curl 종료 코드: ${code}`)));
  });
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

async function readRemoteJob(job) {
  if (!job?.id || !job?.token) return null;
  const url = `${CONTROL_URL.replace(/\/$/, "")}/api/concat/jobs/${encodeURIComponent(job.id)}?token=${encodeURIComponent(job.token)}`;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`작업 조회 HTTP ${response.status}`);
    return (await response.json()).job ?? null;
  } catch (error) {
    try { return JSON.parse(await curlRequest(url, []))?.job ?? null; }
    catch (curlError) {
      console.warn("[concat-worker] 취소 상태 조회 실패", error instanceof Error ? error.message : error, curlError instanceof Error ? curlError.message : curlError);
      return null;
    }
  }
}

function watchCancellation(job, controller) {
  if (!job) return () => {};
  let active = true;
  let checking = false;
  const check = async () => {
    if (!active || checking || controller.signal.aborted) return;
    checking = true;
    try {
      const remoteJob = await readRemoteJob(job);
      if (remoteJob?.status === "canceling" || remoteJob?.status === "canceled") controller.abort(cancellationError());
    } finally {
      checking = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), 900);
  return () => { active = false; clearInterval(timer); };
}

async function openProgressWindow() {
  workerWindow = new BrowserWindow({ width: 520, height: 270, resizable: false, maximizable: false, minimizable: true, autoHideMenuBar: true, backgroundColor: "#07090d", title: "이어붙이기 · 로컬 처리 중", webPreferences: { preload: path.join(__dirname, "concat-worker-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  workerWindow.on("close", (event) => { if (isRunning) { event.preventDefault(); workerWindow.hide(); } });
  await workerWindow.loadFile(path.join(__dirname, "concat-worker.html"));
  return workerWindow;
}

async function runLocalConcatWorker({ jobId = null, token = null, processingMode = "normalize", outputQuality = "source" } = {}) {
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
  let failed = false;
  let canceled = false;
  const cancelController = new AbortController();
  let stopCancellationWatch = () => {};
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
    await queueStatus("working", { sourceBytes, progress: 0, stage: `${selection.filePaths.length}개 원본 · ${outputQuality === "source" ? "원본 최대" : outputQuality} 확인 중` });
    stopCancellationWatch = watchCancellation(job, cancelController);
    if (cancelController.signal.aborted) throw cancellationError();
    const output = await concatOriginalQuality(selection.filePaths, undefined, { onProgress: reportProgress, processingMode: processingMode === "normalize" ? "normalize" : "copy", outputQuality, signal: cancelController.signal });
    const outputBytes = (await fs.stat(output.outputPath)).size;
    publish({ phase: "done", current: output.sourceCount, total: output.sourceCount, progress: 1, etaSeconds: 0, message: "제작완료 · 작업자가 자동으로 종료됩니다." });
    await statusQueue;
    await queueStatus("completed", { outputName: path.basename(output.outputPath), sourceBytes, outputBytes, progress: 1, etaSeconds: 0, stage: "제작완료" });
  } catch (error) {
    canceled = cancelController.signal.aborted || error?.code === "CONCAT_CANCELED";
    const message = readableWorkerError(canceled ? cancellationError() : error, selection.filePaths.length);
    if (canceled) {
      console.info("[concat-worker] 작업취소", { sourceCount: selection.filePaths.length, processingMode });
      publish({ phase: "canceled", current: 0, total: selection.filePaths.length, progress: 0, message });
      await statusQueue;
      await queueStatus("canceled", { sourceBytes, progress: 0, etaSeconds: 0, stage: "사용자 요청으로 작업취소" });
    } else {
      failed = true;
      console.error("[concat-worker] 제작실패", { code: error?.code ?? null, sourceCount: selection.filePaths.length, processingMode, message });
      publish({ phase: "error", current: 0, total: selection.filePaths.length, progress: 0, message });
      await statusQueue;
      await queueStatus("failed", { sourceBytes, error: message, stage: `제작실패 · ${selection.filePaths.length}개 파일` });
    }
  } finally {
    stopCancellationWatch();
    isRunning = false;
    if (failed && workerWindow && !workerWindow.isDestroyed()) {
      workerWindow.show();
      workerWindow.focus();
      return;
    }
    if (workerWindow && !workerWindow.isDestroyed()) workerWindow.close();
    app.quit();
  }
}

module.exports = { runLocalConcatWorker };
