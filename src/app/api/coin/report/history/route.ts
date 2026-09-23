import { NextResponse } from "next/server";
import { listUpbitDailyReports } from "@/lib/upbitReport";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, reports: await listUpbitDailyReports(30) });
  } catch (error) {
    return NextResponse.json({ ok: false, reports: [], error: `업비트 리포트 이력 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}` }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
