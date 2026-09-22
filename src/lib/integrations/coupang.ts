import { COUPANG_PATHS } from "./endpoints";
import { coupangRequest, getCoupangCredentials, isCoupangConfigured } from "./coupangAuth";

interface CoupangProduct {
  sellerProductId: number;
  sellerProductName: string;
  statusName: string;
}

export async function fetchCoupangProducts(): Promise<CoupangProduct[]> {
  const { vendorId } = getCoupangCredentials();
  const data = await coupangRequest<{ data?: CoupangProduct[] }>({
    method: "GET",
    path: COUPANG_PATHS.sellerProducts,
    query: `vendorId=${vendorId}&nextToken=&maxPerPage=50`,
    label: "쿠팡 상품 조회",
  });
  return data.data ?? [];
}

export { isCoupangConfigured };
