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

// 확장프로그램이 프레임(바깥 페이지 + 안쪽 iframe들)마다 보내주는 정보.
export interface CapturedFrame {
  url: string;
  isTopFrame: boolean;
  html: string;
  renderedImages?: Array<{
    src: string;
    width: number;
    height: number;
    alt?: string;
    areaNames?: string[];
  }>;
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

// 추천상품/최근 본 상품/리뷰/메뉴/푸터 영역은 항상 지금 보고 있는 상품과
// 무관한 다른 상품 정보(엉뚱한 가격·사진)를 담고 있을 수 있으므로,
// 가격·사진·옵션을 찾을 때 이 영역 안에 있는 요소는 후보에서 제외한다.
const IRRELEVANT_AREA_PATTERN = /recommend|related|recent|review|banner/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInIrrelevantArea($: cheerio.CheerioAPI, el: any): boolean {
  const $el = $(el);
  if ($el.closest("header, nav, footer").length > 0) return true;
  if ($el.closest('[class*="recommend" i], [id*="recommend" i]').length > 0) return true;
  if ($el.closest('[class*="related" i], [id*="related" i]').length > 0) return true;
  if ($el.closest('[class*="recent" i], [id*="recent" i]').length > 0) return true;
  if ($el.closest('[class*="review" i], [id*="review" i]').length > 0) return true;
  return IRRELEVANT_AREA_PATTERN.test($el.attr("class") ?? "") ||
    IRRELEVANT_AREA_PATTERN.test($el.attr("id") ?? "");
}

// 쇼핑몰이 검색엔진 노출을 위해 넣어두는 표준 상품 정보(JSON-LD Product).
// 페이지 레이아웃과 무관하게 항상 정확한 가격/이름/사진을 담고 있는 경우가
// 많아서, 있으면 이걸 최우선으로 쓰고 없을 때만 화면 구조를 직접 분석한다.
interface StructuredProduct {
  name: string | null;
  image: string | null;
  price: number | null;
}
function extractStructuredProduct($: cheerio.CheerioAPI, base: string): StructuredProduct | null {
  let result: StructuredProduct | null = null;

  const visit = (node: unknown) => {
    if (result || !node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("Product")) {
      const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
      const offerObj = (offers ?? {}) as Record<string, unknown>;
      const rawPrice = offerObj.price ?? offerObj.priceSpecification;
      const priceValue =
        typeof rawPrice === "object" && rawPrice !== null
          ? Number((rawPrice as Record<string, unknown>).price)
          : Number(rawPrice);
      const rawImage = Array.isArray(obj.image) ? obj.image[0] : obj.image;
      result = {
        name: typeof obj.name === "string" ? obj.name : null,
        image: abs(typeof rawImage === "string" ? rawImage : null, base),
        price: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
      };
      return;
    }
    if (Array.isArray(obj["@graph"])) visit(obj["@graph"]);
    if (Array.isArray(node)) (node as unknown[]).forEach(visit);
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return;
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // 형식이 깨진 JSON-LD는 무시하고 화면 구조 분석으로 넘어간다.
    }
  });

  return result;
}

// 사이트마다 다른 HTML 구조에 맞춰 상세 페이지를 파싱하는 규칙.
// 새 쇼핑몰을 추가할 땐 hostname 조건을 늘리고 이 패턴을 참고해서 작성한다.
interface SiteProfile {
  matches: (hostname: string) => boolean;
  parseSingle: ($: cheerio.CheerioAPI, url: string) => ScrapedSingleProduct;
}

function parseAbcmartSingle($: cheerio.CheerioAPI, url: string): ScrapedSingleProduct {
  const meta = (name: string) => $(`meta[property="${name}"]`).attr("content") ?? null;

  // 쇼핑몰이 검색엔진용으로 넣어둔 표준 상품 정보(JSON-LD)가 있으면
  // 화면 구조 분석보다 이걸 우선 신뢰한다 — 레이아웃이 바뀌어도 안 깨지고,
  // 엉뚱한 영역의 가격을 잘못 집을 위험도 없다.
  const structured = extractStructuredProduct($, url);

  const rawTitle =
    structured?.name ?? meta("og:title") ?? $("title").first().text().trim() ?? "이름 확인 불가";
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

  // 구조화 데이터의 대표 이미지가 있으면 가장 먼저 넣어 항상 포함되게 한다.
  if (structured?.image) pushImage(structured.image);

  // 1) 썸네일 갤러리 + 확대 상세컷(밑창/박스 등) — 추천상품/최근 본 상품
  // 영역에 같은 구조의 썸네일이 있을 수 있으므로 그런 영역은 제외한다.
  $(".product-detail-box .detail-thumbs-list img, .product-detail-box .detail-images img").each(
    (_, el) => {
      if (isInIrrelevantArea($, el)) return;
      pushImage($(el).attr("src") ?? $(el).attr("data-src"));
    },
  );
  // 2) 진짜 "상세페이지" — 세로로 긴 배너 이미지 여러 장 (에디터로 작성된 상세설명).
  // .product-detail-box 안으로만 한정하면, 사이트가 그 바깥(별도 탭/섹션)에
  // 상세페이지를 렌더링하는 경우 아예 못 찾으므로, 페이지 전체에서 "상품
  // 이미지 영역처럼 생긴 곳"을 폭넓게 찾되 무관한 영역(추천상품 등)은 뺀다.
  const detailAreaSelectors = [
    "#product-detail-description-wrapper img",
    "[class*='editor' i] img",
    "[class*='detail-desc' i] img",
    "[class*='detail-cont' i] img",
    "[class*='detail-info' i] img",
    "[id*='detail' i] img",
    "[class*='prd-detail' i] img",
    "[class*='goods-detail' i] img",
  ].join(", ");
  $(detailAreaSelectors).each((_, el) => {
    if (isInIrrelevantArea($, el)) return;
    const $el = $(el);
    // 실제 화면 크기(width/height 속성)가 있는데 너무 작으면 아이콘류일
    // 가능성이 높아서 제외한다. 크기 정보가 아예 없으면(대부분의 lazy-load
    // 이미지가 그렇다) 일단 후보로 포함한다.
    const w = Number($el.attr("width") ?? 0);
    const h = Number($el.attr("height") ?? 0);
    if (w > 0 && h > 0 && Math.max(w, h) < 100) return;

    let candidate =
      $el.attr("data-original") ??
      $el.attr("data-src") ??
      $el.attr("data-lazy-src") ??
      $el.attr("data-zoom-image") ??
      $el.attr("src");

    // srcset이 있으면 그중 가장 큰(고화질) 버전을 우선 사용한다.
    const srcset = $el.attr("srcset") ?? $el.attr("data-srcset");
    if (srcset) {
      const largest = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/))
        .sort((a, b) => parseFloat(b[1] ?? "1") - parseFloat(a[1] ?? "1"))[0];
      if (largest?.[0]) candidate = largest[0];
    }

    if (candidate && /logo|icon|sprite|spinner|loading|placeholder/i.test(candidate)) return;
    pushImage(candidate);
  });

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
  // 페이지 전체에서 찾으면 관련상품 목록, 배송비 안내 등 엉뚱한 곳의 작은
  // 금액(예: 배송비 2,000원)을 상품 가격으로 잘못 집을 수 있으므로, 반드시
  // 상단 상품 정보 영역(.detail-box-right) 안에서, 그마저도 추천/리뷰류
  // 영역은 제외하고 찾는다.
  const priceScope = $(".detail-box-right").length > 0 ? $(".detail-box-right") : $("body");
  const prices: number[] = [];
  priceScope.find(".price-cost").each((_, el) => {
    if (isInIrrelevantArea($, el)) return;
    const text = $(el).text().replace(/[^0-9-]/g, "");
    if (!text || text.startsWith("-")) return;
    const value = Number(text);
    if (Number.isFinite(value) && value > 0) prices.push(value);
  });
  const domPrice = prices.length > 0 ? Math.min(...prices) : null;
  // 구조화 데이터가 있으면 최우선으로 쓰고, 없을 때만 화면에서 찾은 값을 쓴다.
  const finalPriceValue = structured?.price ?? domPrice;
  const price = finalPriceValue ? `${finalPriceValue.toLocaleString("ko-KR")}원` : null;

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

// 상세페이지 사진 모으기.
//
// 확장프로그램은 브라우저가 "실제로 화면에 그린" 사진들의 진짜 주소
// (img.currentSrc)와 실제 크기를 함께 보내준다. HTML만 분석할 때와 달리
// 지연로딩(lazy-load)된 사진도 정확히 잡히고, 아이콘처럼 작은 건 크기로
// 걸러낼 수 있다. 상세페이지가 별도의 iframe 안에 들어있는 흔한 경우도
// 이 방식이면 자연스럽게 함께 수집된다.
// 상세페이지 본문이 들어있는 영역. 여기 있는 사진은 크기·모양과 상관없이
// 무조건 상세페이지 사진으로 인정한다. (실제 ABC마트 확인 결과, 상세 배너가
// #product-detail-description-wrapper > .editor-wrap 안에 들어있었다.)
const DETAIL_CONTENT_AREA =
  /editor-wrap|product-detail-description|detail-description|detail-info-img|productInfo/i;
// 상세페이지 영역 안에 있더라도 이건 상품 설명이 아니라 광고/추천이다.
const PROMO_AREA = /detail-info-banner|swiper/i;
const NON_PRODUCT_AREA = /recommend|related|recent|review|banner|gnb|menu|header|footer|nav/i;
const NON_PRODUCT_FILENAME = /logo|icon|sprite|spinner|loading|placeholder|no_image/i;

export function collectDetailImages(
  frames: CapturedFrame[],
  alreadyCollected: string[],
): string[] {
  const basename = (imgUrl: string) => {
    try {
      return new URL(imgUrl).pathname.split("/").pop() ?? imgUrl;
    } catch {
      return imgUrl;
    }
  };

  const seen = new Set(alreadyCollected.map(basename));
  const found: string[] = [];

  for (const frame of frames) {
    for (const image of frame.renderedImages ?? []) {
      if (found.length >= 40) break;
      if (!image.src || NON_PRODUCT_FILENAME.test(image.src)) continue;

      const area = (image.areaNames ?? []).join(" ");

      // 광고/추천 슬라이드는 상세페이지 영역 안에 있더라도 제외한다.
      if (PROMO_AREA.test(area)) continue;

      // 상세설명 본문 영역(에디터로 작성된 상세페이지) 안의 사진은
      // 크기·비율을 따지지 않고 무조건 포함한다. 이게 사용자가 말하는
      // "상세페이지 사진"이다.
      const isDetailContent = DETAIL_CONTENT_AREA.test(area);

      // 그 외에, 바깥 페이지에서는 추천상품/리뷰 같은 영역을 걸러내고
      // "상세페이지 배너"로 볼 만한 큰 사진만 추가한다.
      // 안쪽 iframe은 상세페이지 전용인 경우가 대부분이라 그대로 받는다.
      if (!isDetailContent && frame.isTopFrame) {
        if (NON_PRODUCT_AREA.test(area)) continue;
        const isBannerLike = image.height >= 700 || image.height > image.width * 1.5;
        if (!isBannerLike) continue;
      }

      const key = basename(image.src);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(image.src);
    }
  }

  return found;
}
