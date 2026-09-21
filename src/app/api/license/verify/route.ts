import { NextResponse } from "next/server";
import { PLAN_FEATURES, verifyLicense } from "@/lib/license";

// 확장프로그램(크롬)에서 직접 부르는 주소라 CORS를 열어둔다.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  let body: { key?: string; deviceId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400, headers: CORS_HEADERS });
  }

  const key = typeof body.key === "string" ? body.key : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";

  if (!key || !deviceId) {
    return NextResponse.json(
      { valid: false, plan: "free", features: PLAN_FEATURES.free, reason: "malformed" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const result = await verifyLicense(key, deviceId);
    return NextResponse.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    // 서버 설정 문제로 확인이 안 될 때는 "무효"가 아니라 "확인 불가"로 돌려준다.
    // 확장앱은 이 경우 마지막으로 성공했던 확인 결과를 유예 기간 동안 그대로 쓴다.
    return NextResponse.json(
      {
        valid: false,
        plan: "free",
        features: PLAN_FEATURES.free,
        reason: "storage_unavailable",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}
