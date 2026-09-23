import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { markAgentConnected } from "@/lib/store";
import { saveUpbitCredentials } from "@/lib/coinCredentials";
import { fetchViaFixedIp } from "@/lib/proxyFetch";

function base64url(value: string) { return Buffer.from(value).toString("base64url"); }

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
    if (!response.ok || !Array.isArray(data)) return NextResponse.json({ ok: false, stage: "upbit_auth", error: `업비트 API 인증 오류 ${response.status}: ${data?.error?.message || "키 권한 또는 서명을 확인하세요"}` }, { status: 502 });
    await saveUpbitCredentials({ accessKey, secretKey });
    await markAgentConnected("c8", "업비트 API 연결 정상 · 잔고 조회 완료");
    return NextResponse.json({ ok: true, stage: "upbit_auth", message: "업비트 API 연결 정상 · 잔고 조회 성공 · 암호화 저장 완료", accountCount: data.length, currencies: data.map((account) => account.currency).slice(0, 20), credentialsPersisted: true, statusPersisted: true });
  } catch (error) {
    return NextResponse.json({ ok: false, stage: "network", error: `업비트 API 연결 네트워크 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}` }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
