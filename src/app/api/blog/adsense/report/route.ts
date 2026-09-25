import { NextResponse } from "next/server";
import { getAdsenseDashboard } from "@/lib/adsenseApi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try { return NextResponse.json(await getAdsenseDashboard(url.searchParams.get("from"), url.searchParams.get("to")), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const message = error instanceof Error ? error.message : "AdSense 보고서 조회 실패"; return NextResponse.json({ configured: true, ok: false, code: message.split(":")[0], error: message }, { status: 502 }); }
}
