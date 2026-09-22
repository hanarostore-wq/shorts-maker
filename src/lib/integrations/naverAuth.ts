import { fetchViaFixedIp } from "@/lib/proxyFetch";
import { NAVER_BASE, NAVER_PATHS } from "./endpoints";

// 네이버 커머스 API 인증. 상품·주문 호출이 같은 토큰을 쓰므로 한 곳에 모은다.

export function getNaverCredentials() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.",
    );
  }
  return { clientId, clientSecret };
}

// 발급받은 토큰은 몇 시간 동안 유효하다. 호출마다 새로 받으면 bcrypt 서명이
// 매번 돌아 느려지므로 만료 전까지 재사용한다.
let cachedToken: { value: string; expiresAt: number } | null = null;

// 만료 직전에 쓰다가 거부당하지 않도록 여유를 둔다.
const EXPIRY_MARGIN_MS = 60_000;

export function clearNaverTokenCache(): void {
  cachedToken = null;
}

export async function getNaverAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_MARGIN_MS) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = getNaverCredentials();
  const timestamp = Date.now();

  // clientId + timestamp를 clientSecret을 소금으로 bcrypt 해싱한 뒤 base64로
  // 넘기는 방식이다 (client_credentials).
  const bcrypt = await import("bcryptjs");
  const hashed = bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret);
  const signature = Buffer.from(hashed).toString("base64");

  const res = await fetchViaFixedIp(`${NAVER_BASE}${NAVER_PATHS.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      timestamp: String(timestamp),
      client_secret_sign: signature,
      grant_type: "client_credentials",
      type: "SELF",
    }),
  });

  if (!res.ok) {
    throw new Error(`네이버 토큰 발급 실패 (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const token = data.access_token as string | undefined;
  if (!token) {
    throw new Error("네이버 토큰 응답에 access_token이 없습니다.");
  }

  // expires_in은 초 단위다. 없으면 보수적으로 짧게 잡는다.
  const ttlSeconds = typeof data.expires_in === "number" ? data.expires_in : 600;
  cachedToken = { value: token, expiresAt: Date.now() + ttlSeconds * 1000 };
  return token;
}

/**
 * 토큰을 붙여 네이버 API를 호출한다.
 *
 * 규격이 달라졌을 때 조용히 빈 값을 돌려주지 않고 예외를 던진다.
 */
export async function naverRequest<T>(options: {
  method: "GET" | "POST" | "PUT";
  path: string;
  query?: string;
  body?: unknown;
  label: string;
}): Promise<T> {
  const { method, path, query, body, label } = options;
  const token = await getNaverAccessToken();

  const url = query ? `${NAVER_BASE}${path}?${query}` : `${NAVER_BASE}${path}`;
  const res = await fetchViaFixedIp(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const rawText = await res.text();

  if (!res.ok) {
    // 토큰이 만료돼 거부당한 경우, 캐시를 비워 다음 호출에서 새로 받게 한다.
    if (res.status === 401) clearNaverTokenCache();
    throw new Error(`${label} 실패 (${res.status}): ${rawText.slice(0, 200)}`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(`${label} 응답을 읽지 못했습니다 (${res.status})`);
  }
}

export function isNaverConfigured(): boolean {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}
