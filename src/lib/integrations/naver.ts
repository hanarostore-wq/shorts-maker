import { NAVER_PATHS } from "./endpoints";
import { naverRequest, isNaverConfigured } from "./naverAuth";

interface NaverProduct {
  originProductNo: number;
  name: string;
  salePrice: number;
  stockQuantity: number;
}

export async function fetchNaverProducts(): Promise<NaverProduct[]> {
  // 상품 검색은 GET이 아니라 POST + JSON 바디로 조건을 전달해야 한다.
  const data = await naverRequest<{
    contents?: Array<{ channelProducts?: NaverProduct[] }>;
  }>({
    method: "POST",
    path: NAVER_PATHS.productSearch,
    body: { page: 1, size: 50 },
    label: "네이버 상품 조회",
  });

  return (data.contents ?? [])
    .map((item) => item.channelProducts?.[0])
    .filter((p): p is NaverProduct => Boolean(p));
}

export { isNaverConfigured };
