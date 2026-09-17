import { NextResponse } from "next/server";
import { isNaverConfigured } from "@/lib/integrations/naver";
import { isCoupangConfigured } from "@/lib/integrations/coupang";

export async function GET() {
  return NextResponse.json({
    naver: isNaverConfigured(),
    coupang: isCoupangConfigured(),
  });
}
