const API_BASE = "https://shorts-maker-omega.vercel.app";

const statusEl = document.getElementById("status");
const upsellEl = document.getElementById("upsell");
const scrapeBtn = document.getElementById("scrapeBtn");
const csvBtn = document.getElementById("csvBtn");
const debugBtn = document.getElementById("debugBtn");
const planBadge = document.getElementById("planBadge");

let licenseState = { plan: "free", features: FREE_FEATURES, key: null };

const setStatus = (text) => {
  statusEl.textContent = text;
};

const showUpsell = (message) => {
  upsellEl.style.display = "block";
  upsellEl.innerHTML = `${message}<br /><a href="${API_BASE}/pro" target="_blank">프로 보러가기 →</a>`;
};

const hideUpsell = () => {
  upsellEl.style.display = "none";
};

// ───────────────────────────────────────────────────────────────────────────
// 탭 전환
// ───────────────────────────────────────────────────────────────────────────

const TABS = [
  ["tabScrape", "paneScrape"],
  ["tabMargin", "paneMargin"],
  ["tabLicense", "paneLicense"],
];

for (const [buttonId, paneId] of TABS) {
  document.getElementById(buttonId).addEventListener("click", () => {
    for (const [b, p] of TABS) {
      document.getElementById(b).classList.toggle("active", b === buttonId);
      document.getElementById(p).classList.toggle("active", p === paneId);
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 라이선스
// ───────────────────────────────────────────────────────────────────────────

const licenseKeyInput = document.getElementById("licenseKey");
const licenseStatusEl = document.getElementById("licenseStatus");
const activateBtn = document.getElementById("activateBtn");
const deactivateBtn = document.getElementById("deactivateBtn");
document.getElementById("buyLink").href = `${API_BASE}/pro`;

const PLAN_LABEL = { free: "무료", pro: "프로", lifetime: "평생" };

const REASON_TEXT = {
  malformed: "키 형식이 올바르지 않습니다. 대시(-)까지 그대로 붙여넣어 주세요.",
  not_found: "등록되지 않은 키입니다.",
  revoked: "회수된 키입니다.",
  expired: "이용 기간이 끝났습니다. 연장 후 다시 등록해 주세요.",
  device_limit: "등록 가능한 기기 수를 넘었습니다. 기존 기기 해제를 요청해 주세요.",
  offline: "지금 서버에 연결할 수 없어 마지막 확인 결과로 동작 중입니다.",
  storage_unavailable: "지금은 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

function renderLicense() {
  const isPaid = licenseState.plan !== "free";
  planBadge.textContent = PLAN_LABEL[licenseState.plan] ?? "무료";
  planBadge.classList.toggle("pro", isPaid);

  csvBtn.disabled = !licenseState.features.csvExport;
  csvBtn.textContent = licenseState.features.csvExport
    ? "📄 CSV로 내보내기"
    : "📄 CSV로 내보내기 (프로)";

  if (isPaid) {
    const until = licenseState.expiresAt
      ? `${new Date(licenseState.expiresAt).toLocaleDateString("ko-KR")}까지`
      : "만료 없음";
    licenseStatusEl.textContent = `✅ ${PLAN_LABEL[licenseState.plan]} 이용 중 · ${until}`;
    if (licenseState.reason === "offline") {
      licenseStatusEl.textContent += `\n${REASON_TEXT.offline}`;
    }
    licenseKeyInput.value = licenseState.key ?? "";
  } else {
    const limit = licenseState.features.dailyScrapeLimit;
    licenseStatusEl.textContent = licenseState.reason
      ? `❌ ${REASON_TEXT[licenseState.reason] ?? "확인하지 못했습니다."}`
      : `무료로 사용 중입니다 (하루 ${limit}건).`;
  }
}

activateBtn.addEventListener("click", async () => {
  const key = licenseKeyInput.value.trim().toUpperCase();
  if (!key) return;
  activateBtn.disabled = true;
  licenseStatusEl.textContent = "확인 중...";
  try {
    licenseState = await verifyWithServer(API_BASE, key);
    renderLicense();
    if (licenseState.plan !== "free") hideUpsell();
  } catch (error) {
    licenseStatusEl.textContent = `❌ 확인 실패: ${error.message ?? error}`;
  } finally {
    activateBtn.disabled = false;
  }
});

deactivateBtn.addEventListener("click", async () => {
  await clearLicense();
  licenseState = { plan: "free", features: FREE_FEATURES, key: null, reason: null };
  licenseKeyInput.value = "";
  renderLicense();
});

// ───────────────────────────────────────────────────────────────────────────
// 마진 계산
// ───────────────────────────────────────────────────────────────────────────

const mEls = {
  cost: document.getElementById("mCost"),
  sell: document.getElementById("mSell"),
  ship: document.getElementById("mShip"),
  extra: document.getElementById("mExtra"),
  channel: document.getElementById("mChannel"),
  fee: document.getElementById("mFee"),
  target: document.getElementById("mTarget"),
  goal: document.getElementById("mGoal"),
  result: document.getElementById("mResult"),
};

for (const preset of CHANNEL_PRESETS) {
  const option = document.createElement("option");
  option.value = preset.id;
  option.textContent = preset.name;
  mEls.channel.appendChild(option);
}

mEls.channel.addEventListener("change", () => {
  const preset = CHANNEL_PRESETS.find((c) => c.id === mEls.channel.value);
  if (preset && preset.id !== "custom") mEls.fee.value = (preset.feeRate * 100).toFixed(2);
  renderMargin();
});

function currentCosts() {
  return {
    cost: Number(mEls.cost.value) || 0,
    extraCost: Number(mEls.extra.value) || 0,
    outboundShipping: Number(mEls.ship.value) || 0,
    feeRate: (Number(mEls.fee.value) || 0) / 100,
  };
}

function renderMargin() {
  const costs = currentCosts();
  const sellPrice = Number(mEls.sell.value) || 0;
  const goal = Number(mEls.goal.value) || 0;
  const target = (Number(mEls.target.value) || 0) / 100;

  const result = calcMargin({ ...costs, sellPrice });
  const suggested = sellPriceForTargetMargin(costs, target);
  const units = unitsForGoal(result.profit, goal);
  const profitClass = result.profit > 0 ? "good" : "bad";

  mEls.result.innerHTML = [
    `수수료 ${formatKRW(result.fee)} · 총원가 ${formatKRW(result.totalCost)}`,
    `건당 순이익 <span class="profit ${profitClass}">${formatKRW(result.profit)}</span>` +
      ` (마진 <span class="${profitClass}">${(result.marginRate * 100).toFixed(1)}%</span>)`,
    suggested !== null
      ? `마진 ${mEls.target.value}% 판매가 <b>${formatKRW(suggested)}</b>`
      : `<span class="bad">수수료가 높아 목표 마진이 불가능합니다</span>`,
    units !== null
      ? `목표 ${formatKRW(goal)}까지 <b>${units.toLocaleString("ko-KR")}개</b> 판매`
      : `<span class="bad">지금 판매가로는 팔수록 손해입니다</span>`,
  ].join("<br />");
}

for (const el of [mEls.cost, mEls.sell, mEls.ship, mEls.extra, mEls.fee, mEls.target, mEls.goal]) {
  el.addEventListener("input", renderMargin);
}

document.getElementById("mApplyBtn").addEventListener("click", () => {
  const suggested = sellPriceForTargetMargin(currentCosts(), (Number(mEls.target.value) || 0) / 100);
  if (suggested !== null) {
    mEls.sell.value = suggested;
    renderMargin();
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 페이지 안에서 실행되는 함수들
//
// 중요: chrome.scripting.executeScript는 여기 지정한 함수 "하나만" 페이지
// 안으로 복사해서 실행한다. 이 파일의 다른 함수를 호출하면 페이지 쪽에는
// 그게 없어서 실패한다. 그래서 주입되는 함수는 전부 자체 완결형으로 쓴다.
// ───────────────────────────────────────────────────────────────────────────

// 지금 보고 있는 화면(과 그 안의 iframe 각각)에서 HTML을 거둬온다.
// 상세페이지 사진은 별도의 iframe 안에 들어있는 경우가 많아서, 바깥 페이지만
// 봐서는 절대 찾을 수 없다. 그래서 모든 프레임에서 각각 실행한다.
async function captureFrame() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 스크롤해야 불러와지는(lazy-load) 사진을 실제로 다 불러오게 만든다.
  const startY = window.scrollY;
  let lastHeight = -1;
  for (let i = 0; i < 30; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(300);
    const height = document.documentElement.scrollHeight;
    if (height === lastHeight) break;
    lastHeight = height;
  }
  await sleep(400);
  window.scrollTo(0, startY);

  // 화면에 실제로 그려진 사진들의 "진짜 주소"를 따로 모아둔다.
  // img.currentSrc는 브라우저가 실제로 불러온 주소라서, lazy-load 때문에
  // HTML의 src가 빈 값/임시 이미지여도 정확한 주소를 얻을 수 있다.
  const renderedImages = [];
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) continue;
    const rect = img.getBoundingClientRect();
    const width = img.naturalWidth || rect.width;
    const height = img.naturalHeight || rect.height;
    if (width < 200 && height < 200) continue;

    const areaNames = [];
    let node = img.parentElement;
    for (let depth = 0; depth < 8 && node; depth++) {
      const name = `${node.className || ""} ${node.id || ""}`.trim();
      if (name) areaNames.push(name.slice(0, 120));
      node = node.parentElement;
    }

    renderedImages.push({
      src,
      width: Math.round(width),
      height: Math.round(height),
      alt: (img.alt || "").slice(0, 200),
      areaNames,
    });
    // 사진이 아주 많은 페이지(추천상품 등)에서 정작 아래쪽에 있는 상세페이지
    // 사진이 잘려나가지 않도록 넉넉하게 잡는다.
    if (renderedImages.length >= 300) break;
  }

  // 분석에 필요 없는 부분(스크립트/스타일 등)은 빼서 용량을 줄인다.
  const clone = document.documentElement.cloneNode(true);
  clone
    .querySelectorAll("script, style, noscript, link[rel='stylesheet'], svg")
    .forEach((el) => el.remove());

  const MAX_HTML = 400_000;
  let html = clone.outerHTML;
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);

  return {
    url: location.href,
    isTopFrame: window.top === window.self,
    html,
    renderedImages,
  };
}

// 모든 프레임에서 실행하고, 결과를 하나로 합친다.
async function captureAllFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: captureFrame,
  });

  const frames = results.map((r) => r.result).filter((f) => f && f.html);
  if (frames.length === 0) return null;

  const main = frames.find((f) => f.isTopFrame) ?? frames[0];
  return {
    url: main.url,
    html: main.html,
    // 바깥 페이지 외의 프레임(= 상세페이지가 들어있을 수 있는 곳)도 함께 보낸다.
    frames: frames.map((f) => ({
      url: f.url,
      isTopFrame: f.isTopFrame,
      html: f.html,
      renderedImages: f.renderedImages,
    })),
  };
}

scrapeBtn.addEventListener("click", async () => {
  scrapeBtn.disabled = true;
  hideUpsell();
  setStatus("페이지를 훑어보는 중... (사진 불러오는 데 몇 초 걸려요)");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const payload = await captureAllFrames(tab.id);

    if (!payload) {
      setStatus("❌ 페이지 내용을 가져오지 못했어요. 새로고침 후 다시 시도해주세요.");
      return;
    }

    setStatus(`수집 중... (화면 ${payload.frames.length}개 분석)`);

    const res = await fetch(`${API_BASE}/api/sourcing/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        licenseKey: licenseState.key,
        deviceId: await getDeviceId(),
      }),
    });

    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      setStatus(`❌ 서버 응답 오류 (상태 ${res.status})\n${rawText.slice(0, 150) || "빈 응답"}`);
      return;
    }

    if (res.status === 402 || data.upgrade) {
      setStatus("");
      showUpsell(data.error ?? "프로 전용 기능입니다.");
      return;
    }

    if (!res.ok) {
      setStatus(`❌ 실패: ${data.error ?? "알 수 없는 오류"}`);
    } else if (data.mode === "list") {
      setStatus(`✅ 신규 ${data.addedCount}건, 갱신 ${data.updatedCount}건 (총 ${data.foundCount}개 발견)`);
    } else {
      const p = data.product;
      const label = data.addedCount > 0 ? "신규 수집" : "갱신 완료";
      const quota =
        data.quota && data.quota.limit
          ? `\n오늘 ${data.quota.used}/${data.quota.limit}건 사용`
          : "";
      setStatus(
        `✅ "${p.title}" ${label}\n가격 ${p.price ?? "확인 불가"} · 옵션 ${p.options.length}개 · 사진 ${p.images.length}장${quota}`,
      );

      // 방금 수집한 가격을 마진 계산기 매입가로 옮겨준다.
      const price = parsePriceToNumber(p.price);
      if (price !== null) {
        mEls.cost.value = price;
        const suggested = sellPriceForTargetMargin(
          currentCosts(),
          (Number(mEls.target.value) || 0) / 100,
        );
        if (suggested !== null) mEls.sell.value = suggested;
        renderMargin();
      }
    }
  } catch (error) {
    setStatus(`❌ 오류: ${error instanceof Error ? error.message : error}`);
  } finally {
    scrapeBtn.disabled = false;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// CSV 내보내기 (프로 전용)
// ───────────────────────────────────────────────────────────────────────────

function toCsv(products) {
  const header = ["상품명", "가격", "매입가(숫자)", "옵션", "사진수", "원본주소", "수집시각"];
  const rows = products.map((p) => [
    p.title ?? "",
    p.price ?? "",
    parsePriceToNumber(p.price) ?? "",
    (p.options ?? []).join(" / "),
    (p.images ?? []).length,
    p.url ?? "",
    p.scrapedAt ?? "",
  ]);
  const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

csvBtn.addEventListener("click", async () => {
  if (!licenseState.features.csvExport) {
    showUpsell("CSV 내보내기는 프로 전용 기능입니다.");
    return;
  }
  csvBtn.disabled = true;
  setStatus("목록을 불러오는 중...");
  try {
    const res = await fetch(`${API_BASE}/api/sourcing/add`);
    const data = await res.json();
    const products = data.products ?? [];
    if (products.length === 0) {
      setStatus("내보낼 상품이 없습니다.");
      return;
    }

    // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다.
    const blob = new Blob(["﻿" + toCsv(products)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `소싱목록-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`✅ ${products.length}건을 CSV로 내보냈습니다.`);
  } catch (error) {
    setStatus(`❌ 오류: ${error instanceof Error ? error.message : error}`);
  } finally {
    csvBtn.disabled = false;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 개발용: 페이지 구조를 분석해 클립보드로 복사 (사이트별 규칙을 만들 때 사용)
// ───────────────────────────────────────────────────────────────────────────

function analyzeFrame() {
  const describe = (el) => {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    const cls = typeof el.className === "string" ? el.className.trim() : "";
    if (cls) return `.${cls.split(/\s+/).slice(0, 3).join(".")}`;
    return el.tagName.toLowerCase();
  };

  const images = Array.from(document.images)
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || 0;
      const height = img.naturalHeight || rect.height || 0;
      const path = [];
      let node = img.parentElement;
      for (let i = 0; i < 5 && node; i++) {
        path.push(describe(node));
        node = node.parentElement;
      }
      return {
        src: img.currentSrc || img.src,
        width: Math.round(width),
        height: Math.round(height),
        alt: img.alt,
        parentPath: path,
      };
    })
    .filter((i) => i.width > 150 || i.height > 150)
    .slice(0, 30);

  const priceRegex = /\d{1,3}(?:,\d{3})+\s*원?/;
  const priceCandidates = [];
  for (const el of document.querySelectorAll("body *")) {
    if (priceCandidates.length >= 15) break;
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join("")
      .trim();
    if (ownText && priceRegex.test(ownText)) {
      priceCandidates.push({ selector: describe(el), text: ownText.slice(0, 60) });
    }
  }

  return {
    frameUrl: location.href,
    isTopFrame: window.top === window.self,
    iframeCount: document.querySelectorAll("iframe").length,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content,
    imageCount: document.images.length,
    images,
    priceCandidates,
  };
}

debugBtn.addEventListener("click", async () => {
  debugBtn.disabled = true;
  setStatus("분석 중...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: analyzeFrame,
    });
    const frames = results.map((r) => r.result).filter(Boolean);
    await navigator.clipboard.writeText(JSON.stringify({ frames }, null, 1));
    setStatus(`✅ 복사됨! (화면 ${frames.length}개 분석) 채팅창에 붙여넣어 주세요.`);
  } catch (error) {
    setStatus(`❌ 오류: ${error instanceof Error ? error.message : error}`);
  } finally {
    debugBtn.disabled = false;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 시작
// ───────────────────────────────────────────────────────────────────────────

(async () => {
  try {
    licenseState = await loadLicenseState(API_BASE);
  } catch {
    licenseState = { plan: "free", features: FREE_FEATURES, key: null, reason: "offline" };
  }
  renderLicense();
  renderMargin();
})();
