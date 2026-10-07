const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SUPPORTED_EXTENSIONS = new Set([".mp4"]);

function resolveBinaries() {
  return { ffmpeg: require("ffmpeg-static"), ffprobe: require("ffprobe-static").path };
}

function run(executable, args, { onProgress, totalDuration = 0, baseProgress = 0, progressSpan = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
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
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(stderr.trim() || `FFmpeg 종료 코드: ${code}`)));
  });
}

async function probe(filePath, binaries = resolveBinaries()) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(binaries.ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `FFprobe 종료 코드: ${code}`)));
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

async function inspectSources(inputPaths, binaries = resolveBinaries()) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) throw new Error("이어붙일 원본 영상을 2개 이상 선택하세요.");
  const sources = [];
  for (const filePath of inputPaths) {
    const absolutePath = path.resolve(String(filePath));
    if (!SUPPORTED_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) throw new Error(`${path.basename(absolutePath)}: MP4 원본만 지원합니다.`);
    if (!fssync.existsSync(absolutePath)) throw new Error(`파일을 찾을 수 없습니다: ${absolutePath}`);
    const metadata = await probe(absolutePath, binaries);
    sources.push({ filePath: absolutePath, duration: safeDuration(metadata.format?.duration), signature: streamSignature({ ...metadata, filePath: absolutePath }) });
  }
  return { sources, streamCopyCompatible: sources.every((source) => sameSignature(source.signature, sources[0].signature)) };
}

async function streamCopyConcat(sources, outputPath, binaries, onProgress, workDir, expectedDuration) {
  const segments = [];
  let completedDuration = 0;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const keptDuration = source.duration - 2;
    const segmentPath = path.join(workDir, `segment-${String(index + 1).padStart(3, "0")}.mp4`);
    onProgress({ phase: "trim", current: index + 1, total: sources.length, progress: completedDuration / expectedDuration, message: `${index + 1}/${sources.length} 원본 스트림 키프레임 컷` });
    await run(binaries.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2", "-ss", "1", "-i", source.filePath, "-t", keptDuration.toFixed(3), "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", "-fflags", "+genpts", segmentPath], {
      totalDuration: keptDuration,
      baseProgress: (completedDuration / expectedDuration) * 0.9,
      progressSpan: (keptDuration / expectedDuration) * 0.9,
      onProgress: (details) => onProgress({ phase: "trim", current: index + 1, total: sources.length, message: `${index + 1}/${sources.length} 원본 스트림 키프레임 컷`, ...details }),
    });
    completedDuration += keptDuration;
    segments.push(segmentPath);
  }
  const listPath = path.join(workDir, "concat-list.txt");
  await fs.writeFile(listPath, segments.map((segment) => `file '${concatEscape(segment)}'`).join("\n"), "utf8");
  onProgress({ phase: "join", current: sources.length, total: sources.length, progress: 0.9, message: "원본 비트스트림 그대로 이어붙이는 중" });
  await run(binaries.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2", "-f", "concat", "-safe", "0", "-i", listPath, "-map", "0", "-c", "copy", "-movflags", "+faststart", outputPath], {
    totalDuration: expectedDuration,
    baseProgress: 0.9,
    progressSpan: 0.1,
    onProgress: (details) => onProgress({ phase: "join", current: sources.length, total: sources.length, message: "원본 비트스트림 그대로 이어붙이는 중", ...details }),
  });
}

async function normalizeConcat(sources, outputPath, binaries, onProgress, expectedDuration) {
  const canvasWidth = even(Math.max(...sources.map((source) => source.signature.video.width)));
  const canvasHeight = even(Math.max(...sources.map((source) => source.signature.video.height)));
  const targetFps = Math.max(...sources.map((source) => rate(source.signature.video.frameRate)));
  const audioTrackCount = sources[0].signature.audioTracks.length;
  if (!sources.every((source) => source.signature.audioTracks.length === audioTrackCount)) {
    throw new Error("원본마다 오디오 트랙 수가 달라 자동 규격 맞춤을 중단했습니다. 소리를 삭제하지 않기 위한 안전 조치입니다.");
  }
  const args = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2"];
  sources.forEach((source) => args.push("-i", source.filePath));
  const filters = [];
  sources.forEach((source, index) => {
    const end = (source.duration - 1).toFixed(3);
    filters.push(`[${index}:v]trim=start=1:end=${end},setpts=PTS-STARTPTS,fps=${targetFps},setsar=1,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v${index}]`);
    source.signature.audioTracks.forEach((track, trackIndex) => {
      filters.push(`[${index}:${track.streamIndex}]atrim=start=1:end=${end},aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}_${trackIndex}]`);
    });
  });
  filters.push(`${sources.map((_source, index) => `[v${index}]`).join("")}concat=n=${sources.length}:v=1:a=0[v]`);
  for (let trackIndex = 0; trackIndex < audioTrackCount; trackIndex += 1) {
    filters.push(`${sources.map((_source, index) => `[a${index}_${trackIndex}]`).join("")}concat=n=${sources.length}:v=0:a=1[aout${trackIndex}]`);
  }
  onProgress({ phase: "normalize", current: 0, total: sources.length, progress: 0, message: `자동 규격 맞춤 · ${canvasWidth}×${canvasHeight} MP4로 처리 중` });
  args.push("-filter_complex", filters.join(";"), "-map", "[v]");
  for (let trackIndex = 0; trackIndex < audioTrackCount; trackIndex += 1) args.push("-map", `[aout${trackIndex}]`);
  args.push("-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p");
  if (audioTrackCount > 0) args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-movflags", "+faststart", outputPath);
  await run(binaries.ffmpeg, args, {
    totalDuration: expectedDuration,
    onProgress: (details) => onProgress({ phase: "normalize", current: sources.length, total: sources.length, message: `자동 규격 맞춤 · ${canvasWidth}×${canvasHeight} MP4로 처리 중`, ...details }),
  });
}

async function concatOriginalQuality(inputPaths, outputPath = null, { onProgress = () => {}, binaries = resolveBinaries(), processingMode = "copy" } = {}) {
  const { sources, streamCopyCompatible } = await inspectSources(inputPaths, binaries);
  const shouldNormalize = processingMode === "normalize" && !streamCopyCompatible;
  if (!streamCopyCompatible && !shouldNormalize) throw new Error("규격이 다른 MP4입니다. 자동 규격 맞춤 MP4 옵션을 선택하세요.");
  const absoluteOutput = path.resolve(outputPath || outputPathFor(sources[0].filePath));
  if (new Set(sources.map((source) => source.filePath)).has(absoluteOutput)) throw new Error("출력 파일은 원본과 다른 이름이어야 합니다.");
  if (path.extname(absoluteOutput).toLowerCase() !== ".mp4") throw new Error("출력은 MP4여야 합니다.");
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "moneyos-concat-"));
  try {
    const expectedDuration = sources.reduce((total, source) => total + source.duration - 2, 0);
    if (shouldNormalize) await normalizeConcat(sources, absoluteOutput, binaries, onProgress, expectedDuration);
    else await streamCopyConcat(sources, absoluteOutput, binaries, onProgress, workDir, expectedDuration);
    const metadata = await probe(absoluteOutput, binaries);
    const signature = streamSignature({ ...metadata, filePath: absoluteOutput });
    if (!shouldNormalize && !sameOutputContent(signature, sources[0].signature)) throw new Error("출력 규격이 원본과 달라져 결과 파일을 보존하지 않았습니다.");
    onProgress({ phase: "done", current: sources.length, total: sources.length, progress: 1, etaSeconds: 0, message: "제작완료" });
    return { outputPath: absoluteOutput, sourceCount: sources.length, keptDuration: expectedDuration, mode: shouldNormalize ? "normalized-mp4" : "source-stream-copy", signature };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

module.exports = { concatOriginalQuality, inspectSources, outputPathFor, sameOutputContent, sameSignature, streamSignature };
