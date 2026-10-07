const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SUPPORTED_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm"]);

function resolveBinaries() {
  return {
    ffmpeg: require("ffmpeg-static"),
    ffprobe: require("ffprobe-static").path,
  };
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
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
  const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error(`${path.basename(metadata.filePath)}: 영상 스트림이 없습니다.`);
  return {
    video: {
      codec: video.codec_name,
      profile: video.profile || null,
      width: video.width,
      height: video.height,
      pixelFormat: video.pix_fmt || null,
      frameRate: video.r_frame_rate || null,
    },
    audio: audio ? {
      codec: audio.codec_name,
      sampleRate: audio.sample_rate || null,
      channels: audio.channels || null,
      layout: audio.channel_layout || null,
    } : null,
  };
}

function sameSignature(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameOutputContent(left, right) {
  const withoutContainerFrameRate = (signature) => ({
    video: {
      codec: signature.video.codec,
      profile: signature.video.profile,
      width: signature.video.width,
      height: signature.video.height,
      pixelFormat: signature.video.pixelFormat,
    },
    audio: signature.audio,
  });
  return JSON.stringify(withoutContainerFrameRate(left)) === JSON.stringify(withoutContainerFrameRate(right));
}

function safeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 2) throw new Error("각 원본은 앞뒤 1초를 자른 뒤에도 남는 길이가 있도록 2초보다 길어야 합니다.");
  return duration;
}

function concatEscape(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function even(value) {
  return Math.ceil(value / 2) * 2;
}

function outputPathFor(firstFile, mode) {
  const directory = path.dirname(firstFile);
  const extension = mode === "stream-copy" ? path.extname(firstFile).toLowerCase() : ".mkv";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return path.join(directory, `이어붙임_${stamp}${extension}`);
}

async function inspectSources(inputPaths, binaries = resolveBinaries()) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) throw new Error("이어붙일 원본 영상을 2개 이상 선택하세요.");
  const sources = [];
  for (const filePath of inputPaths) {
    const absolutePath = path.resolve(String(filePath));
    const extension = path.extname(absolutePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`${path.basename(absolutePath)}: MP4, M4V, MOV, MKV, WEBM 원본만 지원합니다.`);
    if (!fssync.existsSync(absolutePath)) throw new Error(`파일을 찾을 수 없습니다: ${absolutePath}`);
    const metadata = await probe(absolutePath, binaries);
    const duration = safeDuration(metadata.format?.duration);
    const signature = streamSignature({ ...metadata, filePath: absolutePath });
    sources.push({ filePath: absolutePath, extension, duration, signature });
  }
  const first = sources[0];
  const streamCopyCompatible = sources.every((source) => source.extension === first.extension && sameSignature(source.signature, first.signature));
  return { sources, mode: streamCopyCompatible ? "stream-copy" : "lossless-normalized" };
}

async function streamCopyConcat(sources, outputPath, binaries, onProgress, workDir) {
  const extension = path.extname(sources[0].filePath).toLowerCase();
  const segments = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const segmentPath = path.join(workDir, `segment-${String(index + 1).padStart(3, "0")}${extension}`);
    onProgress({ phase: "trim", current: index + 1, total: sources.length, message: `${index + 1}/${sources.length} 원본 스트림 키프레임 컷` });
    await run(binaries.ffmpeg, [
      "-hide_banner", "-nostdin", "-y",
      "-ss", "1", "-i", source.filePath,
      "-t", (source.duration - 2).toFixed(3),
      "-map", "0", "-c", "copy",
      "-avoid_negative_ts", "make_zero", "-fflags", "+genpts",
      segmentPath,
    ]);
    segments.push(segmentPath);
  }
  const listPath = path.join(workDir, "concat-list.txt");
  await fs.writeFile(listPath, segments.map((segment) => `file '${concatEscape(segment)}'`).join("\n"), "utf8");
  onProgress({ phase: "join", current: sources.length, total: sources.length, message: "원본 비트스트림 그대로 이어붙이는 중" });
  await run(binaries.ffmpeg, [
    "-hide_banner", "-nostdin", "-y",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-map", "0", "-c", "copy", "-movflags", "+faststart", outputPath,
  ]);
}

async function losslessNormalizeConcat(sources, outputPath, binaries, onProgress) {
  const canvasWidth = even(Math.max(...sources.map((source) => source.signature.video.width)));
  const canvasHeight = even(Math.max(...sources.map((source) => source.signature.video.height)));
  const args = ["-hide_banner", "-nostdin", "-y"];
  sources.forEach((source) => args.push("-i", source.filePath));

  const filters = [];
  sources.forEach((source, index) => {
    const end = (source.duration - 1).toFixed(3);
    filters.push(`[${index}:v]trim=start=1:end=${end},setpts=PTS-STARTPTS,setsar=1,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[v${index}]`);
    if (source.signature.audio) {
      filters.push(`[${index}:a]atrim=start=1:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${(source.duration - 2).toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`);
    }
  });
  const concatInputs = sources.map((_source, index) => `[v${index}][a${index}]`).join("");
  filters.push(`${concatInputs}concat=n=${sources.length}:v=1:a=1[v][a]`);
  onProgress({ phase: "normalize", current: 0, total: sources.length, message: "규격을 맞추되 원본 화질·음성을 무손실로 보존하는 중" });
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "0", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "flac",
    outputPath,
  );
  await run(binaries.ffmpeg, args);
}

/**
 * 같 은 규격은 원본 비트스트림 복사, 다른 규격은 원본 픽셀·음성을 무손실 H.264/FLAC MKV로 보존한다.
 * 두 경우 모두 앞·뒤 1초만 제거하며, 스트림 복사 모드의 컷은 키프레임 기준이다.
 */
async function concatOriginalQuality(inputPaths, outputPath = null, { onProgress = () => {}, binaries = resolveBinaries() } = {}) {
  const { sources, mode } = await inspectSources(inputPaths, binaries);
  const absoluteOutput = path.resolve(outputPath || outputPathFor(sources[0].filePath, mode));
  const sourcePaths = new Set(sources.map((source) => source.filePath));
  if (sourcePaths.has(absoluteOutput)) throw new Error("출력 파일은 원본과 다른 이름이어야 합니다.");
  if (mode === "stream-copy" && path.extname(absoluteOutput).toLowerCase() !== sources[0].extension) throw new Error(`출력 확장자는 원본과 같은 ${sources[0].extension}이어야 합니다.`);
  if (mode === "lossless-normalized" && path.extname(absoluteOutput).toLowerCase() !== ".mkv") throw new Error("규격이 다른 원본의 무손실 출력은 MKV로 저장됩니다.");

  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "moneyos-concat-"));
  try {
    if (mode === "stream-copy") await streamCopyConcat(sources, absoluteOutput, binaries, onProgress, workDir);
    else await losslessNormalizeConcat(sources, absoluteOutput, binaries, onProgress);

    const outputMetadata = await probe(absoluteOutput, binaries);
    const outputSignature = streamSignature({ ...outputMetadata, filePath: absoluteOutput });
    if (mode === "stream-copy" && !sameOutputContent(outputSignature, sources[0].signature)) throw new Error("출력 규격이 원본과 달라져 결과 파일을 보존하지 않았습니다.");
    onProgress({ phase: "done", current: sources.length, total: sources.length, message: "완료" });
    return {
      outputPath: absoluteOutput,
      sourceCount: sources.length,
      keptDuration: sources.reduce((total, source) => total + source.duration - 2, 0),
      mode,
      signature: outputSignature,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

module.exports = {
  concatOriginalQuality,
  inspectSources,
  outputPathFor,
  sameOutputContent,
  sameSignature,
  streamSignature,
};
