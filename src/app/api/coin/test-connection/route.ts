import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { markAgentConnected } from "@/lib/store";
import { saveUpbitCredentials } from "@/lib/coinCredentials";
import { fetchViaFixedIp } from "@/lib/proxyFetch";

function base64url(value: string) { return Buffer.from(value).toString("base64url"); }

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("COIN_CREDENTIALS_ENCRYPTION_KEY")) return { code: "CONFIG_ENCRYPTION_KEY_MISSING", message: "서버 환경변수 COIN_CREDENTIALS_ENCRYPTION_KEY가 없습니다" };
  if (message.includes("공유 Redis")) return { code: "CONFIG_SHARED_REDIS_MISSING", message: "공유 Redis 환경변수(KV_REST_API_URL 또는 KV_REST_API_TOKEN)가 없습니다" };
  if (message.includes("fetch") || message.includes("fetch failed") || message.includes("Proxy")) return { code: "NETWORK_FIXED_IP_PROXY_ERROR", message };
  return { code: "UPBIT_CONNECTION_UNKNOWN", message };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const accessKey = String(body.accessKey || "").trim();
    const secretKey = String(body.secretKey || "").trim();
    if (!accessKey || !secretKey) return NextResponse.json({ ok: false, stage: "input", error: "업비트 API 입력 오류: Access Key와 Secret Key를 모두 입력하세요" }, { status: 400 });
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ access_key: accessKey, nonce: randomUUID() }));
    const signature = createHmac("sha256", secretKey).update(`${header}.${payload}`).digest("base64url");
    const response = await fetchViaFixedIp("https://api.upbit.com/v1/accounts", { headers: { Authorization: `Bearer ${header}.${payload}.${signature}` }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data)) {
      const code = response.status === 401 ? "UPBIT_AUTH_401" : `UPBIT_AUTH_${response.status}`;
      return NextResponse.json({ ok: false, stage: "upbit_auth", code, error: `업비트 API 인증 오류 ${response.status}: ${data?.error?.message || "키 권한 또는 서명을 확인하세요"}` }, { status: 502 });
    }
    await saveUpbitCredentials({ accessKey, secretKey });
    await markAgentConnected("c8", "업비트 API 연결 정상 · 잔고 조회 완료");
    return NextResponse.json({ ok: true, stage: "upbit_auth", message: "업비트 API 연결 정상 · 잔고 조회 성공 · 암호화 저장 완료", accountCount: data.length, currencies: data.map((account) => account.currency).slice(0, 20), credentialsPersisted: true, statusPersisted: true });
  } catch (error) {
    const detail = classifyError(error);
    return NextResponse.json({ ok: false, stage: "server_config", code: detail.code, error: `${detail.code}: ${detail.message}` }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
