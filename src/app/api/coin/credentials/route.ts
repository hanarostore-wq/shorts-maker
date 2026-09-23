import { NextResponse } from "next/server";
import { hasUpbitCredentials } from "@/lib/coinCredentials";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, configured: await hasUpbitCredentials() });
  } catch (error) {
    return NextResponse.json({ ok: false, configured: false, error: `업비트 키 저장 상태 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}` }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
