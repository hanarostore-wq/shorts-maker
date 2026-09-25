import { NextResponse } from "next/server";
import { isNaverConfigured } from "@/lib/integrations/naver";
import { isCoupangConfigured } from "@/lib/integrations/coupang";
import { isVercelConfigured } from "@/lib/integrations/vercel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({
    naver: isNaverConfigured(),
    coupang: isCoupangConfigured(),
    vercel: isVercelConfigured(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
