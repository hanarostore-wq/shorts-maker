// 확장프로그램 쪽 라이선스 처리.
//
// 여기서 하는 검사는 "화면을 알맞게 보여주기 위한" 것이고, 실제 한도와
// 유료 기능은 서버에서 한 번 더 막는다. 확장앱 코드는 사용자가 열어볼 수
// 있으므로 여기 검사만 믿어서는 안 된다.

const LICENSE_STORAGE_KEY = "license";
const DEVICE_STORAGE_KEY = "deviceId";
// 인터넷이 끊기거나 서버가 잠깐 죽어도 결제한 사람이 갑자기 무료로
// 떨어지지 않도록, 마지막 확인 결과를 이 기간만큼 그대로 인정한다.
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const FREE_FEATURES = {
  dailyScrapeLimit: 5,
  bulkList: false,
  csvExport: false,
  marginCalculator: true,
  maxDevices: 1,
};

async function getDeviceId() {
  const stored = await chrome.storage.local.get(DEVICE_STORAGE_KEY);
  if (stored[DEVICE_STORAGE_KEY]) return stored[DEVICE_STORAGE_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_STORAGE_KEY]: id });
  return id;
}

async function getStoredLicense() {
  const stored = await chrome.storage.local.get(LICENSE_STORAGE_KEY);
  return stored[LICENSE_STORAGE_KEY] ?? null;
}

async function saveLicense(license) {
  await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license });
}

async function clearLicense() {
  await chrome.storage.local.remove(LICENSE_STORAGE_KEY);
}

function freeState(reason = null) {
  return { plan: "free", features: FREE_FEATURES, key: null, expiresAt: null, reason };
}

/**
 * 서버에 키를 확인하고 결과를 저장한다.
 * 서버에 못 닿으면 마지막으로 성공했던 결과를 유예 기간 안에서 그대로 쓴다.
 */
async function verifyWithServer(apiBase, key) {
  const deviceId = await getDeviceId();
  const res = await fetch(`${apiBase}/api/license/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, deviceId }),
  });
  const data = await res.json();

  if (data.valid) {
    const license = {
      key,
      plan: data.plan,
      features: data.features,
      expiresAt: data.expiresAt ?? null,
      verifiedAt: Date.now(),
      reason: null,
    };
    await saveLicense(license);
    return license;
  }

  // 서버가 "지금은 확인 못 한다"고 한 경우에는 키를 지우지 않는다.
  if (data.reason === "storage_unavailable") {
    const cached = await getStoredLicense();
    if (cached) return { ...cached, reason: "offline" };
  }
  return { ...freeState(data.reason), key };
}

/** 팝업을 열 때마다 부르는 함수. 필요할 때만 서버에 다시 물어본다. */
async function loadLicenseState(apiBase) {
  const cached = await getStoredLicense();
  if (!cached || !cached.key) return freeState();

  const age = Date.now() - (cached.verifiedAt ?? 0);
  const expired = cached.expiresAt && new Date(cached.expiresAt) <= new Date();

  // 하루에 한 번만 다시 확인한다 (열 때마다 서버를 두드리지 않도록).
  if (age < 24 * 60 * 60 * 1000 && !expired) return cached;

  try {
    return await verifyWithServer(apiBase, cached.key);
  } catch {
    if (age < OFFLINE_GRACE_MS && !expired) return { ...cached, reason: "offline" };
    return { ...freeState("offline"), key: cached.key };
  }
}
