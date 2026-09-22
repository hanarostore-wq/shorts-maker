const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// 설치해서 쓰는 앱이므로 .env 파일을 읽을 수 없다. 담당자가 앱 안에서
// 직접 넣은 값을 이 PC에만 저장한다.
//
// API 키는 운영체제의 암호화 기능(safeStorage)으로 잠가서 저장한다.
// 다른 PC로 파일을 옮겨도 풀리지 않는다.

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    // 아직 없거나 깨졌으면 빈 설정으로 시작한다.
    return {};
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2), "utf8");
}

/** 저장된 API 키를 꺼낸다. 없으면 null. */
function getApiKey() {
  // 개발 중에는 환경변수를 그대로 쓸 수 있게 한다.
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  const data = readRaw();
  if (!data.apiKeyEncrypted) return null;

  try {
    return safeStorage.decryptString(Buffer.from(data.apiKeyEncrypted, "base64"));
  } catch {
    // 다른 PC에서 만든 파일이거나 잠금이 풀리지 않는 경우.
    return null;
  }
}

/** API 키를 저장한다. 빈 값을 넣으면 지운다. */
function setApiKey(key) {
  const data = readRaw();
  const trimmed = String(key ?? "").trim();

  if (!trimmed) {
    delete data.apiKeyEncrypted;
    writeRaw(data);
    return { ok: true, hasKey: false };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // 암호화를 쓸 수 없는 환경이면 저장하지 않는다. 키를 평문으로
    // 남기느니 저장하지 않는 편이 낫다.
    return {
      ok: false,
      hasKey: false,
      error: "이 PC에서는 키를 안전하게 저장할 수 없습니다. 관리자에게 문의하세요.",
    };
  }

  data.apiKeyEncrypted = safeStorage.encryptString(trimmed).toString("base64");
  writeRaw(data);
  return { ok: true, hasKey: true };
}

/** 관제실 주소. 비워두면 기본 배포본을 쓴다. */
function getControlUrl(fallback) {
  return process.env.CONTROL_URL || readRaw().controlUrl || fallback;
}

function setControlUrl(url) {
  const data = readRaw();
  const trimmed = String(url ?? "").trim();
  if (trimmed) data.controlUrl = trimmed;
  else delete data.controlUrl;
  writeRaw(data);
  return { ok: true };
}

/** 화면에 보여줄 현재 설정 상태 (키 자체는 절대 내보내지 않는다). */
function describe(fallbackUrl) {
  return {
    hasKey: Boolean(getApiKey()),
    controlUrl: getControlUrl(fallbackUrl),
    canStoreKey: safeStorage.isEncryptionAvailable(),
  };
}

module.exports = { getApiKey, setApiKey, getControlUrl, setControlUrl, describe };
