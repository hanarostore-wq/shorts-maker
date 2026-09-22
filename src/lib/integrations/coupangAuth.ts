import crypto from "crypto";
import { fetchViaFixedIp } from "@/lib/proxyFetch";
import { COUPANG_BASE } from "./endpoints";

// 쿠팡 Open API 인증. 상품 조회·주문 조회·발주 확인이 모두 같은 서명 방식을
// 쓰기 때문에 한 곳에 모아둔다.

export function getCoupangCredentials() {
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

/**
 * signed-date는 반드시 yyMMdd'T'HHmmss'Z' (연도 2자리, UTC)여야 한다.
 * 형식이 조금만 달라도 쿠팡은 인증 실패로 응답한다.
 */
export function getSignedDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(now.getUTCFullYear()).slice(-2);
  return (
    `${yy}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/**
 * 서명 대상 문자열은 `signed-date + METHOD + path + query`이다.
 * query에 '?'를 포함하면 서명이 어긋나므로 물음표 없이 넘겨야 한다.
 */
export function buildAuthorization(
  method: string,
  path: string,
  query: string,
  now: Date = new Date(),
): string {
  const { accessKey, secretKey } = getCoupangCredentials();
  const datetime = getSignedDate(now);
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${datetime}${method}${path}${query}`)
    .digest("hex");

  return (
    `CEA algorithm=HmacSHA256, access-key=${accessKey}, ` +
    `signed-date=${datetime}, signature=${signature}`
  );
}

/** HTML 응답이 오면 <title>만 뽑아 요약한다 (로그에 원문을 남기지 않기 위함). */
export function summarize(rawText: string): string {
  const titleMatch = rawText.match(/<title>(.*?)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  return rawText.replace(/\s+/g, " ").slice(0, 120);
}

/**
 * 서명을 붙여 쿠팡 API를 호출하고 JSON을 돌려준다.
 *
 * 응답이 JSON이 아니거나 실패 상태면 그 자리에서 예외를 던진다. 규격이
 * 달라졌을 때 빈 배열을 조용히 돌려주는 것보다 크게 실패하는 편이 낫다.
 */
export async function coupangRequest<T>(options: {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: string;
  body?: unknown;
  label: string;
}): Promise<T> {
  const { method, path, query = "", body, label } = options;

  const url = query ? `${COUPANG_BASE}${path}?${query}` : `${COUPANG_BASE}${path}`;
  const res = await fetchViaFixedIp(url, {
    method,
    headers: {
      Authorization: buildAuthorization(method, path, query),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const rawText = await res.text();

  if (!res.ok) {
    throw new Error(`${label} 실패 (${res.status}): ${summarize(rawText)}`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(`${label} 응답을 읽지 못했습니다 (${res.status}): ${summarize(rawText)}`);
  }
}

export function isCoupangConfigured(): boolean {
  return Boolean(
    process.env.COUPANG_ACCESS_KEY &&
      process.env.COUPANG_SECRET_KEY &&
      process.env.COUPANG_VENDOR_ID,
  );
}
