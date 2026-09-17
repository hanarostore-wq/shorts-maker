import crypto from "crypto";

const BASE_URL = "https://api-gateway.coupang.com";

interface CoupangProduct {
  sellerProductId: number;
  sellerProductName: string;
  statusName: string;
}

function getCredentials() {
  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;
  const vendorId = process.env.COUPANG_VENDOR_ID;
  if (!accessKey || !secretKey || !vendorId) {
    throw new Error(
      "COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY / COUPANG_VENDOR_ID 환경변수가 설정되지 않았습니다.",
    );
  }
  return { accessKey, secretKey, vendorId };
}

// 쿠팡 Open API는 HMAC-SHA256으로 서명한 Authorization 헤더(CEA algorithm)를 요구한다.
function buildAuthorizationHeader(method: string, path: string, query: string) {
  const { accessKey, secretKey } = getCredentials();
  const datetime = new Date()
    .toISOString()
    .replace(/[-:]|\.\d{3}/g, "")
    .slice(0, 15) + "Z";

  const message = `${datetime}${method}${path}${query}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("hex");

  return (
    `CEA algorithm=HmacSHA256, access-key=${accessKey}, ` +
    `signed-date=${datetime}, signature=${signature}`
  );
}

export async function fetchCoupangProducts(): Promise<CoupangProduct[]> {
  const { vendorId } = getCredentials();
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  const query = `vendorId=${vendorId}&nextToken=&maxPerPage=50`;

  const res = await fetch(`${BASE_URL}${path}?${query}`, {
    method: "GET",
    headers: {
      Authorization: buildAuthorizationHeader("GET", path, query),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`쿠팡 상품 조회 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

export function isCoupangConfigured(): boolean {
  return Boolean(
    process.env.COUPANG_ACCESS_KEY &&
      process.env.COUPANG_SECRET_KEY &&
      process.env.COUPANG_VENDOR_ID,
  );
}
