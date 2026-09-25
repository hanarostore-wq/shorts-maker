import { NextResponse } from "next/server";
import { hasNaverBlogCredentials, saveNaverBlogCredentials } from "@/lib/naverBlogCredentials";

const API_HUB_BASE_URL = "https://naverapihub.apigw.ntruss.com";
const DATALAB_URL = `${API_HUB_BASE_URL}/search-trend/v1/search`;
const SEARCH_URL = `${API_HUB_BASE_URL}/search/v1/blog?query=%EC%9E%90%EB%8F%99%ED%99%94&display=1&sort=date&format=json`;

function errorResponse(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function classifyNaverError(message: string) {
  if (message.includes("NAVER_DATALAB_401") || message.includes("NAVER_SEARCH_401")) {
    return { code: "NAVER_API_HUB_AUTH_401", message: "NAVER API HUB 인증에 실패했습니다. 콘솔의 Application > 인증 정보에서 발급한 Client ID와 Client Secret을 정확히 함께 입력하고, 해당 앱에 검색어 트렌드와 블로그 검색 API가 등록되어 있는지 확인하세요." };
  }
  if (message.includes("NAVER_DATALAB_403")) {
    return { code: "NAVER_DATALAB_PERMISSION_403", message: "NAVER API HUB Application에 검색어 트렌드 API를 등록하고 이용 신청 상태인지 확인하세요." };
  }
  if (message.includes("NAVER_SEARCH_403")) {
    return { code: "NAVER_SEARCH_PERMISSION_403", message: "NAVER API HUB Application에 블로그 검색 API를 등록하고 이용 신청 상태인지 확인하세요." };
  }
  return { code: message.split(":")[0] || "NAVER_CONNECTION_ERROR", message };
}

async function checkNaverApi(clientId: string, clientSecret: string) {
  const headers = { "X-NCP-APIGW-API-KEY-ID": clientId, "X-NCP-APIGW-API-KEY": clientSecret, "Content-Type": "application/json" };
  const dataLabResponse = await fetch(DATALAB_URL, { method: "POST", headers, body: JSON.stringify({ startDate: "2025-01-01", endDate: "2025-01-07", timeUnit: "date", keywordGroups: [{ groupName: "머니OS 연결 테스트", keywords: ["자동화"] }] }), cache: "no-store" });
  const dataLabBody = await dataLabResponse.json().catch(() => ({}));
  if (!dataLabResponse.ok) throw new Error(`NAVER_DATALAB_${dataLabResponse.status}: ${dataLabBody?.errorMessage || "DataLab 요청 실패"}`);
  const searchResponse = await fetch(SEARCH_URL, { headers: { "X-NCP-APIGW-API-KEY-ID": clientId, "X-NCP-APIGW-API-KEY": clientSecret }, cache: "no-store" });
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
    const classified = classifyNaverError(message);
    return errorResponse(classified.code, classified.message, 502);
  }
}
