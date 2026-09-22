import { fetchViaFixedIp } from "@/lib/proxyFetch";

const BASE_URL = "https://api.commerce.naver.com/external";

interface NaverProduct {
  originProductNo: number;
  name: string;
  salePrice: number;
  stockQuantity: number;
}

function getCredentials() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.",
    );
  }
  return { clientId, clientSecret };
}

// 네이버 커머스API는 clientId + timestamp를 clientSecret으로 bcrypt 서명한 값을
// password로 사용하는 client_credentials 방식을 요구한다.
async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const timestamp = Date.now();
  const bcrypt = await import("bcryptjs");
  const hashed = bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret);
  const signature = Buffer.from(hashed).toString("base64");

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: signature,
    grant_type: "client_credentials",
    type: "SELF",
  });

  const res = await fetchViaFixedIp(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 토큰 발급 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

export async function fetchNaverProducts(): Promise<NaverProduct[]> {
  const accessToken = await getAccessToken();

  // 상품 검색은 GET이 아니라 POST + JSON 바디로 조건을 전달해야 한다.
  const res = await fetchViaFixedIp(`${BASE_URL}/v1/products/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page: 1, size: 50 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 상품 조회 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  return (data.contents ?? []).map((item: {
    channelProducts?: Array<{
      originProductNo: number;
      name: string;
      salePrice: number;
      stockQuantity: number;
    }>;
  }) => item.channelProducts?.[0]).filter(Boolean);
}

export function isNaverConfigured(): boolean {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}
