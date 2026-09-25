import { NextResponse } from "next/server";
import { hasNaverBlogCredentials, saveNaverBlogCredentials } from "@/lib/naverBlogCredentials";

const DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";
const SEARCH_URL = "https://openapi.naver.com/v1/search/blog.json?query=%EC%9E%90%EB%8F%99%ED%99%94&display=1";

function errorResponse(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

async function checkNaverApi(clientId: string, clientSecret: string) {
  const headers = { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret, "Content-Type": "application/json" };
  const dataLabResponse = await fetch(DATALAB_URL, { method: "POST", headers, body: JSON.stringify({ startDate: "2025-01-01", endDate: "2025-01-07", timeUnit: "date", keywordGroups: [{ groupName: "머니OS 연결 테스트", keywords: ["자동화"] }] }), cache: "no-store" });
  const dataLabBody = await dataLabResponse.json().catch(() => ({}));
  if (!dataLabResponse.ok) throw new Error(`NAVER_DATALAB_${dataLabResponse.status}: ${dataLabBody?.errorMessage || "DataLab 요청 실패"}`);
  const searchResponse = await fetch(SEARCH_URL, { headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret }, cache: "no-store" });
  const searchBody = await searchResponse.json().catch(() => ({}));
  if (!searchResponse.ok) throw new Error(`NAVER_SEARCH_${searchResponse.status}: ${searchBody?.errorMessage || "Blog Search 요청 실패"}`);
  return { dataLab: true, search: true };
}

export async function GET() {
  try { return NextResponse.json({ ok: true, configured: await hasNaverBlogCredentials() }); }
  catch { return NextResponse.json({ ok: false, configured: false, code: "NAVER_CREDENTIAL_STATUS_ERROR", error: "Naver credential 상태를 확인하지 못했습니다." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = String(body.clientId || "").trim();
    const clientSecret = String(body.clientSecret || "").trim();
    if (!clientId || !clientSecret) return errorResponse("NAVER_CREDENTIALS_REQUIRED", "Client ID와 Client Secret을 모두 입력하세요.");
    const checks = await checkNaverApi(clientId, clientSecret);
    await saveNaverBlogCredentials({ clientId, clientSecret });
    return NextResponse.json({ ok: true, configured: true, status: "encrypted", dataLab: checks.dataLab, search: checks.search, message: "Naver DataLab·Search API 정상 · 암호화 저장 완료" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Naver API 연결 실패";
    const code = message.split(":")[0] || "NAVER_CONNECTION_ERROR";
    return errorResponse(code, message, 502);
  }
}
