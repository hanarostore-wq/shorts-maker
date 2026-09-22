const API_BASE = "https://shorts-maker-omega.vercel.app";
const statusEl = document.getElementById("status");
const scrapeBtn = document.getElementById("scrapeBtn");

function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.style.color = error ? "#fca5a5" : "#a7f3d0";
}

// Manus 제작 규칙: 현재 브라우저에 로드된 화면만 읽는다.
// 자동 스크롤, lazy-load 유도, 무한 펼치기, 탭 자동 클릭은 하지 않는다.
async function captureFrame() {
  const renderedImages = [];
  for (const image of document.images) {
    const rect = image.getBoundingClientRect();
    const src = image.currentSrc || image.src;
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    if (!visible || !src || src.startsWith("data:")) continue;
    const width = image.naturalWidth || rect.width;
    const height = image.naturalHeight || rect.height;
    if (width < 100 && height < 100) continue;
    renderedImages.push({
      src,
      width: Math.round(width),
      height: Math.round(height),
      alt: (image.alt || "").slice(0, 200),
      areaNames: [],
    });
    if (renderedImages.length >= 200) break;
  }

  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, link[rel='stylesheet'], svg").forEach((el) => el.remove());
  const MAX_HTML = 400000;
  let html = clone.outerHTML;
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);

  return {
    url: location.href,
    isTopFrame: window.top === window.self,
    html,
    renderedImages,
  };
}

async function captureAllFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: captureFrame,
  });
  const frames = results.map((result) => result.result).filter((frame) => frame && frame.html);
  if (!frames.length) return null;
  const main = frames.find((frame) => frame.isTopFrame) || frames[0];
  return {
    url: main.url,
    html: main.html,
    frames: frames.map((frame) => ({
      url: frame.url,
      isTopFrame: frame.isTopFrame,
      html: frame.html,
      renderedImages: frame.renderedImages,
    })),
  };
}

scrapeBtn.addEventListener("click", async () => {
  scrapeBtn.disabled = true;
  setStatus("현재 화면을 분석하는 중...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("현재 탭을 찾지 못했습니다.");
    const payload = await captureAllFrames(tab.id);
    if (!payload) throw new Error("페이지 내용을 가져오지 못했습니다.");

    setStatus(`현재 화면 ${payload.frames.length}개를 서버로 보내는 중...`);
    const response = await fetch(`${API_BASE}/api/sourcing/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `서버 오류 ${response.status}`);

    if (data.mode === "list") {
      setStatus(`완료: 현재 화면 상품 ${data.foundCount}건 확인\n신규 ${data.addedCount}건 · 갱신 ${data.updatedCount}건`);
    } else {
      setStatus(`완료: ${data.addedCount > 0 ? "신규 수집" : "상품 갱신"}\n${data.product?.title || "상품 1건"}`);
    }
  } catch (error) {
    setStatus(`실패: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    scrapeBtn.disabled = false;
  }
});
