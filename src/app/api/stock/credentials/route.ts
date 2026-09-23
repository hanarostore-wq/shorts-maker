import { NextResponse } from "next/server";
import { getStockCredentialStatus, saveStockCredentials } from "@/lib/stockCredentials";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getStockCredentialStatus()) });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "NAMUH_CREDENTIAL_STATUS_ERROR", error: error instanceof Error ? error.message : "나무플러그 키 상태를 확인하지 못했습니다" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { appKey?: string; appSecret?: string };
    await saveStockCredentials({ appKey: body.appKey ?? "", appSecret: body.appSecret ?? "" });
    return NextResponse.json({ ok: true, configured: true, message: "나무플러그 App Key·App Secret을 암호화 저장했습니다" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "나무플러그 키 저장에 실패했습니다";
    const code = message.split(":")[0] || "NAMUH_CREDENTIAL_SAVE_ERROR";
    return NextResponse.json({ ok: false, code, error: message }, { status: 400 });
  }
}
