const API_BASE = "https://shorts-maker-omega.vercel.app";
const statusEl = document.getElementById("status");
const btn = document.getElementById("scrapeBtn");

function extractFromPage() {
  const abs = (url) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  };

  const priceRegex = /(\d{1,3}(?:,\d{3})+)\s*원?/;

  // 스크롤해서 화면에 보여준 범위(현재 스크롤+뷰포트 아래)까지만 포함한다.
  const scrolledBottom = window.scrollY + window.innerHeight;

  const anchors = Array.from(document.querySelectorAll("a")).filter((a) => {
    const img = a.querySelector("img");
    if (!img) return false;
    if (!priceRegex.test(a.innerText || "")) return false;
    const rect = a.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    return top <= scrolledBottom;
  });

  const seen = new Set();
  const products = [];
  for (const a of anchors) {
    const url = abs(a.href);
    if (seen.has(url)) continue;
    seen.add(url);
    const img = a.querySelector("img");
    const priceMatch = (a.innerText || "").match(priceRegex);
    const title =
      (img && img.alt && img.alt.trim()) ||
      (a.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] ||
      "이름 확인 불가";
    products.push({
      url,
      title,
      price: priceMatch ? priceMatch[0] : null,
      image: img ? abs(img.src) : null,
    });
  }

  if (products.length >= 2) {
    return { type: "list", products };
  }

  // 목록이 아니라 상품 상세 페이지로 보이는 경우: 메타태그 기반 단건 추출
  const meta = (name) =>
    document.querySelector(`meta[property="${name}"]`)?.content ||
    document.querySelector(`meta[name="${name}"]`)?.content ||
    null;

  const title = meta("og:title") || document.title || "이름 확인 불가";
  const image = meta("og:image");
  const bodyMatch = (document.body.innerText || "").match(priceRegex);

  return {
    type: "single",
    product: {
      url: location.href,
      title,
      price: bodyMatch ? bodyMatch[0] : null,
      image,
    },
  };
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  statusEl.textContent = "수집 중...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFromPage,
    });

    const body =
      result.type === "list"
        ? { products: result.products }
        : result.product;

    const res = await fetch(`${API_BASE}/api/sourcing/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = `❌ 실패: ${data.error ?? "알 수 없는 오류"}`;
    } else if (result.type === "list") {
      statusEl.textContent = `✅ ${data.addedCount}건 수집 완료 (중복 ${data.skippedCount}건 제외)\n총 ${result.products.length}개 발견`;
    } else {
      statusEl.textContent =
        data.addedCount > 0
          ? `✅ "${result.product.title}" 수집 완료`
          : `이미 수집된 상품입니다.`;
    }
  } catch (error) {
    statusEl.textContent = `❌ 오류: ${error instanceof Error ? error.message : error}`;
  } finally {
    btn.disabled = false;
  }
});
