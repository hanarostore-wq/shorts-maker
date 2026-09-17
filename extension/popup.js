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
    if (!/^https?:\/\//.test(a.href || "")) return false;
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

  // 목록이 아니라 상품 상세 페이지로 보이는 경우: 메타태그 + 옵션/설명까지 최대한 수집
  const meta = (name) =>
    document.querySelector(`meta[property="${name}"]`)?.content ||
    document.querySelector(`meta[name="${name}"]`)?.content ||
    null;

  const title = meta("og:title") || document.title || "이름 확인 불가";
  const image = meta("og:image");
  const bodyText = document.body.innerText || "";
  const bodyMatch = bodyText.match(priceRegex);

  // 추가 이미지: og:image 외 상품 갤러리로 보이는 img들(대표 이미지와 비슷한 위치)
  const galleryImages = Array.from(
    document.querySelectorAll(
      '[class*="thumb" i] img, [class*="gallery" i] img, [class*="detail" i] img',
    ),
  )
    .map((img) => abs(img.src))
    .filter(Boolean);
  const images = Array.from(new Set([image, ...galleryImages].filter(Boolean))).slice(0, 8);

  // 옵션(사이즈/색상 등): <select>의 선택지, 옵션처럼 보이는 버튼/li 텍스트
  const selectOptions = Array.from(document.querySelectorAll("select"))
    .flatMap((select) =>
      Array.from(select.options)
        .map((o) => o.textContent.trim())
        .filter((t) => t && !/선택|choose|select/i.test(t)),
    );
  const buttonOptions = Array.from(
    document.querySelectorAll(
      '[class*="option" i] li, [class*="option" i] button, [class*="option" i] label',
    ),
  )
    .map((el) => el.textContent.trim())
    .filter((t) => t && t.length < 40);
  // 매장 픽업 등 오프라인 전용 옵션은 온라인 판매와 무관하므로 제외한다.
  const excludePattern = /매장|픽업|pickup|store\s*pick|방문\s*수령/i;
  const options = Array.from(new Set([...selectOptions, ...buttonOptions]))
    .filter((t) => !excludePattern.test(t))
    .slice(0, 30);

  // 상세 설명: "detail"/"description" 등이 포함된 영역의 텍스트 일부
  const detailEl = document.querySelector(
    '[class*="detail" i], [class*="description" i], [id*="detail" i]',
  );
  const description = detailEl
    ? detailEl.innerText.replace(/\s+/g, " ").trim().slice(0, 1000)
    : null;

  return {
    type: "single",
    product: {
      url: location.href,
      title,
      price: bodyMatch ? bodyMatch[0] : null,
      image,
      images,
      options,
      description,
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
          ? `✅ "${result.product.title}" 수집 완료 (옵션 ${result.product.options.length}개, 이미지 ${result.product.images.length}장)`
          : `이미 수집된 상품입니다.`;
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

const debugBtn = document.getElementById("debugBtn");
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
