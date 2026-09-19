const API_BASE = "https://shorts-maker-omega.vercel.app";
const statusEl = document.getElementById("status");
const btn = document.getElementById("scrapeBtn");
const debugBtn = document.getElementById("debugBtn");

// 상세페이지 사진처럼 스크롤해야 불러와지는(lazy-load) 이미지를 놓치지 않도록,
// 캡쳐 전에 페이지 끝까지 자동으로 스크롤하면서 사진이 실제로 다 불러와질
// 시간을 준 다음, 원래 스크롤 위치로 되돌아온다.
async function autoScrollToLoadImages() {
  const originalY = window.scrollY;
  const step = Math.max(window.innerHeight * 0.8, 400);
  let last = -1;

  while (true) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 350));
    const height = document.documentElement.scrollHeight;
    if (height === last) break;
    last = height;
    window.scrollBy(0, step);
    await new Promise((r) => setTimeout(r, 150));
  }

  // 느리게 불러와지는 이미지를 위해 한 번 더 대기
  await new Promise((r) => setTimeout(r, 500));
  window.scrollTo(0, originalY);
  await new Promise((r) => setTimeout(r, 150));
}

// 확장프로그램은 지금 보고 있는 페이지의 전체 HTML(끝까지 스크롤해서 다
// 불러온 뒤)을 서버로 보내고, 실제 사이트별 분석(어떤 게 이미지/옵션/가격인지)은
// 서버에서 처리한다. 이렇게 하면 사이트별 규칙을 바꿀 때 확장프로그램을
// 다시 설치할 필요가 없다.
async function capturePage() {
  await autoScrollToLoadImages();

  const clone = document.documentElement.cloneNode(true);

  return {
    url: location.href,
    html: clone.outerHTML,
  };
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  statusEl.textContent = "페이지 스크롤하며 사진 불러오는 중...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
    });
    statusEl.textContent = "수집 중...";

    const res = await fetch(`${API_BASE}/api/sourcing/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = `❌ 실패: ${data.error ?? "알 수 없는 오류"}`;
    } else if (data.mode === "list") {
      statusEl.textContent = `✅ 신규 ${data.addedCount}건, 갱신 ${data.updatedCount}건\n총 ${data.foundCount}개 발견`;
    } else {
      statusEl.textContent =
        data.addedCount > 0
          ? `✅ "${data.product.title}" 신규 수집 (옵션 ${data.product.options.length}개, 이미지 ${data.product.images.length}장)`
          : `✅ "${data.product.title}" 갱신 완료 (옵션 ${data.product.options.length}개, 이미지 ${data.product.images.length}장) · 관제실 팝업에서 버전 확인 가능`;
    }
  } catch (error) {
    statusEl.textContent = `❌ 오류: ${error instanceof Error ? error.message : error}`;
  } finally {
    btn.disabled = false;
  }
});

// ── 개발용: 페이지 구조를 분석해서 클립보드에 복사 (사이트별 세팅을 만들기 위한 도구) ──
function analyzePageStructure() {
  const guessSelector = (el) => {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === "string" && el.className.trim()) {
      return `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`;
    }
    return el.tagName.toLowerCase();
  };

  const priceRegex = /\d{1,3}(?:,\d{3})+\s*원?/;

  const images = Array.from(document.querySelectorAll("img"))
    .filter((img) => (img.naturalWidth || img.width || 0) > 150)
    .slice(0, 20)
    .map((img) => ({
      selector: guessSelector(img),
      parentSelector: guessSelector(img.parentElement),
      src: img.src,
      alt: img.alt,
    }));

  const priceCandidates = [];
  document.querySelectorAll("body *").forEach((el) => {
    if (priceCandidates.length >= 15) return;
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join("")
      .trim();
    if (ownText && priceRegex.test(ownText)) {
      priceCandidates.push({ selector: guessSelector(el), text: ownText.slice(0, 60) });
    }
  });

  const selects = Array.from(document.querySelectorAll("select")).map((s) => ({
    selector: guessSelector(s),
    sampleOptions: Array.from(s.options).slice(0, 6).map((o) => o.textContent.trim()),
  }));

  const optionLike = Array.from(
    document.querySelectorAll(
      '[class*="option" i], [class*="size" i], [class*="color" i], [id*="option" i]',
    ),
  )
    .slice(0, 15)
    .map((el) => ({
      selector: guessSelector(el),
      tag: el.tagName.toLowerCase(),
      text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 60),
    }));

  const detailLike = Array.from(
    document.querySelectorAll(
      '[class*="detail" i], [class*="desc" i], [id*="detail" i], [id*="desc" i]',
    ),
  )
    .slice(0, 10)
    .map((el) => ({
      selector: guessSelector(el),
      tag: el.tagName.toLowerCase(),
      textLength: el.textContent.trim().length,
    }));

  return {
    hostname: location.hostname,
    url: location.href,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content,
    images,
    priceCandidates,
    selects,
    optionLike,
    detailLike,
  };
}

debugBtn.addEventListener("click", async () => {
  debugBtn.disabled = true;
  statusEl.textContent = "분석 중...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: analyzePageStructure,
    });
    const text = JSON.stringify(result, null, 1);
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "✅ 복사됨! 채팅창에 붙여넣어 주세요.";
  } catch (error) {
    statusEl.textContent = `❌ 오류: ${error instanceof Error ? error.message : error}`;
  } finally {
    debugBtn.disabled = false;
  }
});
