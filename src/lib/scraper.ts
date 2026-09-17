import * as cheerio from "cheerio";

export interface ScrapedProduct {
  url: string;
  title: string;
  price: string | null;
  image: string | null;
}

const PRICE_PATTERN = /(\d{1,3}(?:,\d{3})+|\d{4,})\s*원?/;

function pickMeta($: cheerio.CheerioAPI, ...names: string[]): string | null {
  for (const name of names) {
    const byProperty = $(`meta[property="${name}"]`).attr("content");
    if (byProperty) return byProperty;
    const byName = $(`meta[name="${name}"]`).attr("content");
    if (byName) return byName;
  }
  return null;
}

// 특정 쇼핑몰 구조에 맞춘 게 아니라, 대부분의 쇼핑몰이 공통으로 갖고 있는
// Open Graph 메타태그(og:title, og:image 등)를 기준으로 최대한 일반적으로 추출한다.
// 가격은 og 태그에 없는 경우가 많아 본문 텍스트에서 숫자+원 패턴을 보조로 찾는다.
export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`페이지를 불러오지 못했습니다 (${res.status})`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const title =
    pickMeta($, "og:title", "twitter:title") ??
    $("title").first().text().trim() ??
    "이름 확인 불가";

  const image = pickMeta($, "og:image", "twitter:image");

  const ogPrice = pickMeta(
    $,
    "product:price:amount",
    "og:price:amount",
    "twitter:data1",
  );

  let price: string | null = ogPrice;
  if (!price) {
    const bodyText = $("body").text();
    const match = bodyText.match(PRICE_PATTERN);
    price = match ? match[0] : null;
  }

  return { url, title: title.trim(), price, image };
}
