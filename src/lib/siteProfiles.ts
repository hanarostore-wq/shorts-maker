import * as cheerio from "cheerio";

export interface ScrapedSingleProduct {
  url: string;
  title: string;
  price: string | null;
  image: string | null;
  images: string[];
  options: string[];
  description: string | null;
}

export interface ScrapedListProduct {
  url: string;
  title: string;
  price: string | null;
  image: string | null;
}

const PRICE_REGEX = /\d{1,3}(?:,\d{3})+\s*원?/;
const OFFLINE_OPTION_PATTERN = /매장|픽업|pickup|store\s*pick|방문\s*수령/i;

function abs(url: string | undefined | null, base: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

// 사이트마다 다른 HTML 구조에 맞춰 상세 페이지를 파싱하는 규칙.
// 새 쇼핑몰을 추가할 땐 hostname 조건을 늘리고 이 패턴을 참고해서 작성한다.
interface SiteProfile {
  matches: (hostname: string) => boolean;
  parseSingle: ($: cheerio.CheerioAPI, url: string) => ScrapedSingleProduct;
}

function parseAbcmartSingle($: cheerio.CheerioAPI, url: string): ScrapedSingleProduct {
  const meta = (name: string) => $(`meta[property="${name}"]`).attr("content") ?? null;

  const rawTitle = meta("og:title") ?? $("title").first().text().trim() ?? "이름 확인 불가";
  // "나이키 코트 비전 로우 넥스트 네이처 NIKE COURT VISION LO NN - 나이키" → 끝의 " - 브랜드" 제거
  const title = rawTitle.replace(/\s*-\s*[^-]{1,10}$/, "").trim() || rawTitle;

  // 썸네일 갤러리 + 확대 상세컷(밑창/박스 등)을 모두 가져온다.
  // 같은 사진이 다른 경로(썸네일용 vs 확대용)로 두 번 잡히는 걸 막기 위해
  // 파일 이름(경로 마지막 부분, 쿼리스트링 제외)을 기준으로 중복을 제거한다.
  const imageBasename = (imgUrl: string) => {
    try {
      const { pathname } = new URL(imgUrl);
      return pathname.split("/").pop() ?? imgUrl;
    } catch {
      return imgUrl;
    }
  };

  const images: string[] = [];
  const seenBasenames = new Set<string>();
  const pushImage = (src: string | undefined) => {
    const resolved = abs(src, url);
    if (!resolved) return;
    const key = imageBasename(resolved);
    if (seenBasenames.has(key)) return;
    seenBasenames.add(key);
    images.push(resolved);
  };

  // 1) 썸네일 갤러리 + 확대 상세컷(밑창/박스 등)
  $(".product-detail-box .detail-thumbs-list img, .product-detail-box .detail-images img").each(
    (_, el) => pushImage($(el).attr("src") ?? $(el).attr("data-src")),
  );
  // 2) 진짜 "상세페이지" — 세로로 긴 배너 이미지 여러 장 (에디터로 작성된 상세설명)
  $("#product-detail-description-wrapper img").each((_, el) =>
    pushImage($(el).attr("src") ?? $(el).attr("data-src")),
  );

  const ogImage = abs(meta("og:image"), url);
  const allImages =
    images.length > 0
      ? images
      : (Array.from(new Set([ogImage].filter(Boolean))) as string[]);

  // 사이즈 변환표(KR/US/UK/EU)도 상세페이지의 일부로 텍스트로 담는다.
  const sizeTableLines: string[] = [];
  $(".size-guide-wrap table").each((_, table) => {
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr)
          .find("th, td")
          .map((_, cell) => $(cell).text().trim())
          .get()
          .filter(Boolean);
        if (cells.length > 0) sizeTableLines.push(cells.join(" | "));
      });
  });
  const sizeTableText = sizeTableLines.length > 0 ? sizeTableLines.join("\n") : null;

  // .price-cost 안에 정가/할인가/할인액이 섞여 있어서, 음수(할인액)가 아닌 것 중
  // 가장 작은 값(할인 후 최종가)을 최종 판매가로 판단한다.
  const prices: number[] = [];
  $(".price-cost").each((_, el) => {
    const text = $(el).text().replace(/[^0-9-]/g, "");
    if (!text || text.startsWith("-")) return;
    const value = Number(text);
    if (Number.isFinite(value) && value > 0) prices.push(value);
  });
  const price = prices.length > 0 ? `${Math.min(...prices).toLocaleString("ko-KR")}원` : null;

  // 사이즈 옵션: ul.size-list 안의 li[data-product-type="option"]에
  // 실제 사이즈(data-product-option-name)와 재고 수량이 들어있다.
  // 재고 수량이 0이면 품절로 표시한다.
  const options: string[] = [];
  $('ul.size-list li[data-product-type="option"]').each((_, el) => {
    const $el = $(el);
    const size =
      $el.attr("data-product-option-name") ?? $el.find("button").text().trim();
    if (!size) return;
    const qty = Number($el.attr("data-product-option-quantity") ?? "0");
    options.push(qty > 0 ? size : `${size} (품절)`);
  });

  const description = sizeTableText;

  return {
    url,
    title,
    price,
    image: ogImage,
    images: allImages,
    options: Array.from(new Set(options)).slice(0, 30),
    description,
  };
}

const profiles: SiteProfile[] = [
  {
    matches: (hostname) => hostname.includes("a-rt.com"),
    parseSingle: parseAbcmartSingle,
  },
];

function genericParseSingle($: cheerio.CheerioAPI, url: string): ScrapedSingleProduct {
  const meta = (name: string) =>
    $(`meta[property="${name}"]`).attr("content") ?? $(`meta[name="${name}"]`).attr("content") ?? null;

  const title = meta("og:title") ?? $("title").first().text().trim() ?? "이름 확인 불가";
  const ogImage = meta("og:image");

  const galleryImages: string[] = [];
  $('[class*="thumb"] img, [class*="gallery"] img, [class*="detail"] img').each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src");
    const resolved = abs(src, url);
    if (resolved) galleryImages.push(resolved);
  });

  const images = Array.from(new Set([abs(ogImage, url), ...galleryImages].filter(Boolean))) as string[];

  const bodyText = $("body").text();
  const priceMatch = bodyText.match(PRICE_REGEX);

  const selectOptions: string[] = [];
  $("select option").each((_, el) => {
    const text = $(el).text().trim();
    if (text && !/선택|choose|select/i.test(text)) selectOptions.push(text);
  });

  const buttonOptions: string[] = [];
  $('[class*="option"] li, [class*="option"] button, [class*="option"] label').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 40) buttonOptions.push(text);
  });

  const options = Array.from(new Set([...selectOptions, ...buttonOptions]))
    .filter((t) => !OFFLINE_OPTION_PATTERN.test(t))
    .slice(0, 30);

  const detailEl = $('[class*="detail"], [class*="description"], [id*="detail"]').first();
  const description = detailEl.length
    ? detailEl.text().replace(/\s+/g, " ").trim().slice(0, 1000) || null
    : null;

  return {
    url,
    title: title.trim(),
    price: priceMatch ? priceMatch[0] : null,
    image: abs(ogImage, url),
    images,
    options,
    description,
  };
}

export function parseSingleProduct(html: string, url: string): ScrapedSingleProduct {
  const $ = cheerio.load(html);
  const hostname = new URL(url).hostname;
  const profile = profiles.find((p) => p.matches(hostname));
  return profile ? profile.parseSingle($, url) : genericParseSingle($, url);
}

// 목록 페이지: 이미지+가격이 함께 있는 링크를 상품 카드로 간주하고,
// scrollY(현재까지 스크롤한 위치) 기준으로 그 안에 있는 것만 포함한다.
// 서버는 좌표(rect) 계산을 할 수 없으므로, 클라이언트에서 이미
// "스크롤한 범위까지"만 추린 HTML 조각을 넘겨받는 것을 전제로 하거나,
// 여기서는 문서 순서상 상위 N개로 근사한다.
export function parseListProducts(html: string, url: string, maxItems = 60): ScrapedListProduct[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const products: ScrapedListProduct[] = [];

  $("a").each((_, el) => {
    if (products.length >= maxItems) return;
    const $a = $(el);
    const href = $a.attr("href");
    const resolvedUrl = abs(href, url);
    if (!resolvedUrl || !/^https?:\/\//.test(resolvedUrl)) return;
    if (seen.has(resolvedUrl)) return;

    const img = $a.find("img").first();
    if (img.length === 0) return;

    const text = $a.text();
    const priceMatch = text.match(PRICE_REGEX);
    if (!priceMatch) return;

    seen.add(resolvedUrl);
    const imgSrc = img.attr("src") ?? img.attr("data-src");
    const title =
      img.attr("alt")?.trim() ||
      text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)[0] ||
      "이름 확인 불가";

    products.push({
      url: resolvedUrl,
      title,
      price: priceMatch[0],
      image: abs(imgSrc, url),
    });
  });

  return products;
}
