const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SUPPORTED_EXTENSIONS = new Set([".mp4"]);

function resolveBinaries() {
  const bundledFfmpeg = require("ffmpeg-static");
  const bundledFfprobe = require("ffprobe-static").path;
  const explicitFfmpeg = process.env.MONEYOS_FFMPEG_PATH;
  const systemFfmpeg = process.platform === "win32" ? "C:\\ffmpeg\\bin\\ffmpeg.exe" : null;
  const preferredFfmpeg = [explicitFfmpeg, systemFfmpeg, bundledFfmpeg].find((candidate) => typeof candidate === "string" && fssync.existsSync(candidate)) || bundledFfmpeg;
  const siblingFfprobe = typeof preferredFfmpeg === "string" ? path.join(path.dirname(preferredFfmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : null;
  const preferredFfprobe = [siblingFfprobe, bundledFfprobe].find((candidate) => typeof candidate === "string" && fssync.existsSync(candidate)) || bundledFfprobe;
  return { ffmpeg: preferredFfmpeg, ffprobe: preferredFfprobe };
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

function capture(executable, args) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(executable, args, { windowsHide: true }); }
    catch (error) { reject(error); return; }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(`${stdout}\n${stderr}`) : reject(new Error(stderr.trim() || `${executable} 종료 코드: ${code}`)));
  });
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

const hardwareEncoders = [
  { id: "nvidia", encoder: "h264_nvenc", label: "NVIDIA NVENC", args: ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-pix_fmt", "yuv420p"] },
  { id: "intel", encoder: "h264_qsv", label: "Intel Quick Sync", args: ["-c:v", "h264_qsv", "-global_quality", "20", "-look_ahead", "0", "-pix_fmt", "nv12"] },
  { id: "amd", encoder: "h264_amf", label: "AMD AMF", args: ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-pix_fmt", "yuv420p"] },
];

async function encoderWorks(ffmpeg, plan) {
  try {
    await capture(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=0.1", "-frames:v", "1", ...plan.args, "-f", "null", "-"]);
    return true;
  } catch { return false; }
}

async function selectEncoderPlan(binaries, acceleration) {
  const requested = acceleration || "auto";
  if (requested === "cpu") return { id: "cpu", label: "CPU 고화질", ffmpeg: binaries.ffmpeg, hardware: false, args: ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p"] };
  const candidates = unique([
    process.env.MONEYOS_FFMPEG_PATH,
    process.platform === "win32" ? path.join(__dirname, "tools", "ffmpeg", "bin", "ffmpeg.exe") : null,
    "ffmpeg",
    binaries.ffmpeg,
  ]);
  for (const ffmpeg of candidates) {
    let encoders = "";
    try { encoders = await capture(ffmpeg, ["-hide_banner", "-encoders"]); }
    catch { continue; }
    const plans = requested === "auto" ? hardwareEncoders : hardwareEncoders.filter((plan) => plan.id === requested);
    for (const plan of plans) {
      if (!encoders.includes(plan.encoder)) continue;
      if (await encoderWorks(ffmpeg, plan)) return { ...plan, ffmpeg, hardware: true };
    }
  }
  if (requested !== "auto") {
    const label = hardwareEncoders.find((plan) => plan.id === requested)?.label ?? requested;
    throw new Error(`${label} 하드웨어 인코더를 사용할 수 없습니다. 드라이버와 GPU 지원 FFmpeg를 확인하거나 가속 옵션을 자동·CPU로 바꾸세요.`);
  }
  return { id: "cpu", label: "CPU 고화질", ffmpeg: binaries.ffmpeg, hardware: false, args: ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p"] };
}

function readableProcessError(error, toolName) {
  if (error?.code === "ENAMETOOLONG") {
    return new Error(`${toolName} 명령줄이 너무 깁니다. 파일 수와 경로를 묶음 처리해야 합니다.`);
  }
  if (error?.code === "ENOENT") return new Error(`${toolName} 실행 파일을 찾을 수 없습니다. PC 작업자를 업데이트한 뒤 다시 실행하세요.`);
  return error instanceof Error ? error : new Error(String(error));
}

function cancellationError() {
  const error = new Error("사용자 요청으로 이어붙이기 작업을 취소했습니다.");
  error.code = "CONCAT_CANCELED";
  return error;
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else {
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 1500).unref();
  }
}

function run(executable, args, { onProgress, totalDuration = 0, baseProgress = 0, progressSpan = 1, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let canceled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      if (!child) {
        finish(reject, cancellationError());
        return;
      }
      canceled = true;
      terminateProcessTree(child);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      child = spawn(executable, args, { windowsHide: true });
    } catch (error) {
      finish(reject, readableProcessError(error, "FFmpeg"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    let progressBuffer = "";
    const startedAt = Date.now();
    const emitProgress = (seconds) => {
      if (!onProgress || !totalDuration || !Number.isFinite(seconds)) return;
      const ratio = Math.max(0, Math.min(1, seconds / totalDuration));
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const overall = Math.max(0, Math.min(0.995, baseProgress + ratio * progressSpan));
      const etaSeconds = ratio > 0.01 ? Math.max(0, Math.round((elapsedSeconds / ratio) * (1 - ratio))) : undefined;
      onProgress({ progress: overall, etaSeconds });
    };
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      progressBuffer += text;
      let newline = progressBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = progressBuffer.slice(0, newline).trim();
        progressBuffer = progressBuffer.slice(newline + 1);
        const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line);
        if (match) emitProgress(Number(match[1]) / 1_000_000);
        newline = progressBuffer.indexOf("\n");
      }
    });
    child.once("error", (error) => finish(reject, readableProcessError(error, "FFmpeg")));
    child.once("close", (code) => canceled ? finish(reject, cancellationError()) : code === 0 ? finish(resolve, stderr) : finish(reject, new Error(stderr.trim() || `FFmpeg 종료 코드: ${code}`)));
  });
}

async function probe(filePath, binaries = resolveBinaries()) {
  const output = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binaries.ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { windowsHide: true });
    } catch (error) {
      reject(readableProcessError(error, "FFprobe"));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => reject(readableProcessError(error, "FFprobe")));
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `FFprobe 종료 코드: ${code}`)));
  });
  return JSON.parse(output);
}

function streamSignature(metadata) {
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  const audioTracks = (metadata.streams ?? [])
    .filter((stream) => stream.codec_type === "audio")
    .map((stream) => ({
      streamIndex: stream.index,
      codec: stream.codec_name,
      sampleRate: stream.sample_rate || null,
      channels: stream.channels || null,
      layout: stream.channel_layout || null,
    }));
  if (!video) throw new Error(`${path.basename(metadata.filePath)}: 영상 스트림이 없습니다.`);
  return {
    video: { codec: video.codec_name, profile: video.profile || null, width: video.width, height: video.height, pixelFormat: video.pix_fmt || null, frameRate: video.r_frame_rate || null },
    audioTracks,
  };
}

function sameSignature(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function sameOutputContent(left, right) {
  const normalized = (signature) => ({
    video: {
      codec: signature.video.codec,
      profile: signature.video.profile,
      width: signature.video.width,
      height: signature.video.height,
      pixelFormat: signature.video.pixelFormat,
    },
    audioTracks: signature.audioTracks.map(({ streamIndex: _streamIndex, ...track }) => track),
  });
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function safeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 2) throw new Error("각 원본은 앞뒤 1초를 자른 뒤에도 남는 길이가 있도록 2초보다 길어야 합니다.");
  return duration;
}

function concatEscape(filePath) { return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''"); }
function even(value) { return Math.ceil(value / 2) * 2; }
function rate(value) {
  const [numerator, denominator] = String(value || "30/1").split("/").map(Number);
  const parsed = denominator ? numerator / denominator : numerator;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(120, Math.max(1, parsed)) : 30;
}
function outputPathFor(firstFile) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return path.join(path.dirname(firstFile), `이어붙임_${stamp}.mp4`);
}

function outputCanvas(sources, outputQuality) {
  if (outputQuality === "720p" || outputQuality === "1080p") {
    const portrait = sources[0].signature.video.height > sources[0].signature.video.width;
    const shortSide = outputQuality === "720p" ? 720 : 1080;
    const longSide = outputQuality === "720p" ? 1280 : 1920;
    return portrait ? { width: shortSide, height: longSide, label: outputQuality, resize: true } : { width: longSide, height: shortSide, label: outputQuality, resize: true };
  }
  return {
    width: even(Math.max(...sources.map((source) => source.signature.video.width))),
    height: even(Math.max(...sources.map((source) => source.signature.video.height))),
    label: "원본 최대",
    resize: false,
  };
}

async function inspectSources(inputPaths, binaries = resolveBinaries()) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) throw new Error("이어붙일 원본 영상을 2개 이상 선택하세요.");
  const sources = [];
  for (const filePath of inputPaths) {
    const absolutePath = path.resolve(String(filePath));
    if (!SUPPORTED_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) throw new Error(`${path.basename(absolutePath)}: MP4 원본만 지원합니다.`);
    if (!fssync.existsSync(absolutePath)) throw new Error(`파일을 찾을 수 없습니다: ${absolutePath}`);
    let metadata;
    try { metadata = await probe(absolutePath, binaries); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/moov atom not found|invalid data found/i.test(message)) {
        throw new Error(`${path.basename(absolutePath)}: MP4 헤더를 읽을 수 없습니다. 이전 작업이 중단되어 남은 미완성 파일일 수 있으니 선택에서 제외하고 삭제한 뒤 원본 MP4만 다시 고르세요.`);
      }
      throw new Error(`${path.basename(absolutePath)}: 영상 정보를 읽지 못했습니다. ${message.split("\n").at(-1) || ""}`.trim());
    }
    sources.push({ filePath: absolutePath, duration: safeDuration(metadata.format?.duration), signature: streamSignature({ ...metadata, filePath: absolutePath }) });
  }
  return { sources, streamCopyCompatible: sources.every((source) => sameSignature(source.signature, sources[0].signature)) };
}

async function joinSegmentList(segments, outputPath, binaries, onProgress, expectedDuration, message, baseProgress = 0.9, progressSpan = 0.1, signal) {
  const listPath = path.join(path.dirname(segments[0]), "concat-list.txt");
  await fs.writeFile(listPath, segments.map((segment) => `file '${concatEscape(segment)}'`).join("\n"), "utf8");
  onProgress({ phase: "join", current: segments.length, total: segments.length, progress: baseProgress, message });
  await run(binaries.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2", "-f", "concat", "-safe", "0", "-i", listPath, "-map", "0", "-c", "copy", "-movflags", "+faststart", outputPath], {
    totalDuration: expectedDuration,
    baseProgress,
    progressSpan,
    signal,
    onProgress: (details) => onProgress({ phase: "join", current: segments.length, total: segments.length, message, ...details }),
  });
}

async function streamCopyConcat(sources, outputPath, binaries, onProgress, workDir, expectedDuration, signal) {
  const segments = [];
  let completedDuration = 0;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const keptDuration = source.duration - 2;
    const segmentPath = path.join(workDir, `segment-${String(index + 1).padStart(6, "0")}.mp4`);
    onProgress({ phase: "trim", current: index + 1, total: sources.length, progress: completedDuration / expectedDuration, message: `${index + 1}/${sources.length} 원본 스트림 키프레임 컷` });
    await run(binaries.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2", "-ss", "1", "-i", source.filePath, "-t", keptDuration.toFixed(3), "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", "-fflags", "+genpts", segmentPath], {
      totalDuration: keptDuration,
      baseProgress: (completedDuration / expectedDuration) * 0.9,
      progressSpan: (keptDuration / expectedDuration) * 0.9,
      signal,
      onProgress: (details) => onProgress({ phase: "trim", current: index + 1, total: sources.length, message: `${index + 1}/${sources.length} 원본 스트림 키프레임 컷`, ...details }),
    });
    completedDuration += keptDuration;
    segments.push(segmentPath);
  }
  await joinSegmentList(segments, outputPath, binaries, onProgress, expectedDuration, "원본 비트스트림 그대로 이어붙이는 중", 0.9, 0.1, signal);
}

async function normalizeConcat(sources, outputPath, binaries, onProgress, expectedDuration, workDir, signal, outputQuality, encoderPlan) {
  const canvas = outputCanvas(sources, outputQuality);
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const targetFps = Math.max(...sources.map((source) => rate(source.signature.video.frameRate)));
  const audioTrackCount = sources[0].signature.audioTracks.length;
  if (!sources.every((source) => source.signature.audioTracks.length === audioTrackCount)) {
    throw new Error("원본마다 오디오 트랙 수가 달라 자동 규격 맞춤을 중단했습니다. 소리를 삭제하지 않기 위한 안전 조치입니다.");
  }

  // Windows에는 FFmpeg 명령줄 길이 제한이 있다. 한 파일씩 임시 MP4를 만든 뒤
  // 목록 파일로 합치되, 여유 RAM과 해상도에 맞춰 병렬 수를 제한한다.
  const cpuCount = Math.max(1, os.cpus().length || 1);
  const cpuParallelism = cpuCount >= 12 ? 3 : cpuCount >= 6 ? 2 : 1;
  const estimatedMemoryPerJob = Math.max(512 * MB, canvasWidth * canvasHeight * 80);
  const reservedMemory = Math.max(Math.floor(os.totalmem() * 0.15), 1536 * MB);
  const usableMemory = Math.max(estimatedMemoryPerJob, os.freemem() - reservedMemory);
  const memoryParallelism = Math.max(1, Math.floor(usableMemory / estimatedMemoryPerJob));
  const parallelism = encoderPlan.hardware ? 1 : Math.max(1, Math.min(cpuParallelism, memoryParallelism));
  const threadsPerJob = Math.max(1, Math.floor(cpuCount / parallelism));
  const normalizedSegments = new Array(sources.length);
  const sourceProgress = new Array(sources.length).fill(0);
  const keptDurations = sources.map((source) => source.duration - 2);
  const updateProgress = (index, localProgress, message) => {
    sourceProgress[index] = Math.max(0, Math.min(1, localProgress));
    const completedCount = sourceProgress.filter((value) => value >= 1).length;
    const totalProgress = sourceProgress.reduce((sum, value, sourceIndex) => sum + value * keptDurations[sourceIndex], 0) / expectedDuration;
    onProgress({
      phase: "normalize",
      current: completedCount,
      total: sources.length,
      progress: totalProgress * 0.9,
      message,
    });
  };
  const normalizeOne = async (index) => {
    const source = sources[index];
    const keptDuration = keptDurations[index];
    const end = (source.duration - 1).toFixed(3);
    const segmentPath = path.join(workDir, `normalized-${String(index + 1).padStart(6, "0")}.mp4`);
    const resize = canvas.resize ? `,scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease` : "";
    const filters = [`[0:v]trim=start=1:end=${end},setpts=PTS-STARTPTS,fps=${targetFps}${resize},setsar=1,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v]`];
    for (let trackIndex = 0; trackIndex < audioTrackCount; trackIndex += 1) {
      const track = source.signature.audioTracks[trackIndex];
      filters.push(`[0:${track.streamIndex}]atrim=start=1:end=${end},aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${trackIndex}]`);
    }
    const args = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2", "-i", source.filePath, "-filter_complex", filters.join(";"), "-map", "[v]"];
    for (let trackIndex = 0; trackIndex < audioTrackCount; trackIndex += 1) args.push("-map", `[a${trackIndex}]`);
    args.push(...encoderPlan.args);
    if (!encoderPlan.hardware) args.push("-threads", String(threadsPerJob));
    if (audioTrackCount > 0) args.push("-c:a", "aac", "-b:a", "192k");
    args.push(segmentPath);
    updateProgress(index, 0, `${encoderPlan.label} · ${canvas.label} · ${parallelism}개 동시 처리 중`);
    await run(encoderPlan.ffmpeg, args, {
      totalDuration: keptDuration,
      signal,
      onProgress: (details) => updateProgress(index, details.progress ?? 0, `${encoderPlan.label} · ${canvas.label} · ${parallelism}개 동시 처리 중`),
    });
    normalizedSegments[index] = segmentPath;
    updateProgress(index, 1, `${encoderPlan.label} · ${canvas.label} · ${parallelism}개 동시 처리 중`);
  };
  let nextIndex = 0;
  const normalized = await Promise.allSettled(Array.from({ length: Math.min(parallelism, sources.length) }, async () => {
    while (nextIndex < sources.length) {
      const index = nextIndex;
      nextIndex += 1;
      await normalizeOne(index);
    }
  }));
  if (signal?.aborted) throw cancellationError();
  const failed = normalized.find((item) => item.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  await joinSegmentList(normalizedSegments, outputPath, binaries, onProgress, expectedDuration, "규격을 맞춘 MP4 묶음을 이어붙이는 중", 0.9, 0.1, signal);
}

async function concatOriginalQuality(inputPaths, outputPath = null, { onProgress = () => {}, binaries = resolveBinaries(), processingMode = "normalize", outputQuality = "source", acceleration = "auto", signal } = {}) {
  if (signal?.aborted) throw cancellationError();
  const { sources, streamCopyCompatible } = await inspectSources(inputPaths, binaries);
  const shouldNormalize = processingMode === "normalize" && (!streamCopyCompatible || outputQuality !== "source");
  if (!streamCopyCompatible && !shouldNormalize) throw new Error("규격이 다른 MP4입니다. 자동 규격 맞춤 MP4 옵션을 선택하세요.");
  const absoluteOutput = path.resolve(outputPath || outputPathFor(sources[0].filePath));
  if (new Set(sources.map((source) => source.filePath)).has(absoluteOutput)) throw new Error("출력 파일은 원본과 다른 이름이어야 합니다.");
  if (path.extname(absoluteOutput).toLowerCase() !== ".mp4") throw new Error("출력은 MP4여야 합니다.");
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "moneyos-concat-"));
  const stagedOutput = path.join(path.dirname(absoluteOutput), `.${path.basename(absoluteOutput, ".mp4")}.part-${process.pid}-${Date.now()}.mp4`);
  let completed = false;
  try {
    const expectedDuration = sources.reduce((total, source) => total + source.duration - 2, 0);
    const encoderPlan = shouldNormalize ? await selectEncoderPlan(binaries, acceleration) : null;
    if (shouldNormalize) {
      onProgress({ phase: "normalize", current: 0, total: sources.length, progress: 0, message: `${encoderPlan.label} 인코더 준비 완료` });
      await normalizeConcat(sources, stagedOutput, binaries, onProgress, expectedDuration, workDir, signal, outputQuality, encoderPlan);
    }
    else await streamCopyConcat(sources, stagedOutput, binaries, onProgress, workDir, expectedDuration, signal);
    const metadata = await probe(stagedOutput, binaries);
    const signature = streamSignature({ ...metadata, filePath: stagedOutput });
    if (!shouldNormalize && !sameOutputContent(signature, sources[0].signature)) throw new Error("출력 규격이 원본과 달라져 결과 파일을 보존하지 않았습니다.");
    await fs.rename(stagedOutput, absoluteOutput);
    completed = true;
    onProgress({ phase: "done", current: sources.length, total: sources.length, progress: 1, etaSeconds: 0, message: "제작완료" });
    return { outputPath: absoluteOutput, sourceCount: sources.length, keptDuration: expectedDuration, outputQuality, acceleration: encoderPlan?.id ?? "source-copy", mode: shouldNormalize ? "normalized-mp4" : "source-stream-copy", signature };
  } finally {
    if (!completed) await fs.rm(stagedOutput, { force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

module.exports = { concatOriginalQuality, inspectSources, outputPathFor, sameOutputContent, sameSignature, streamSignature };
