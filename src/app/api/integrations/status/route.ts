import { NextResponse } from "next/server";
import { isNaverConfigured } from "@/lib/integrations/naver";
import { isCoupangConfigured } from "@/lib/integrations/coupang";
import { isVercelConfigured } from "@/lib/integrations/vercel";

export async function GET() {
  return NextResponse.json({
    naver: isNaverConfigured(),
    coupang: isCoupangConfigured(),
    vercel: isVercelConfigured(),
  });
}
