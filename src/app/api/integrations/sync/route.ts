import { NextResponse } from "next/server";
import { fetchNaverProducts, isNaverConfigured } from "@/lib/integrations/naver";
import { fetchCoupangProducts, isCoupangConfigured } from "@/lib/integrations/coupang";
import { fetchLatestDeployment, isVercelConfigured, describeState } from "@/lib/integrations/vercel";
import { reportCompletion, reportFailure } from "@/lib/store";

export async function POST(request: Request) {
  const { platform } = await request.json();

  if (platform === "naver") {
    if (!isNaverConfigured()) {
      return NextResponse.json(
        { error: "네이버 API 키가 설정되지 않았습니다." },
        { status: 400 },
      );
    }
    try {
      const products = await fetchNaverProducts();
      await reportCompletion({
        departmentId: "store",
        agentId: "s6",
        message: `스마트스토어 상품 ${products.length}건 조회 완료`,
        incidentKey: "naver",
      });
      return NextResponse.json({ ok: true, count: products.length, products });
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      await reportFailure({
        departmentId: "store",
        agentId: "s6",
        message,
        incidentKey: "naver",
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (platform === "coupang") {
    if (!isCoupangConfigured()) {
      return NextResponse.json(
        { error: "쿠팡 API 키가 설정되지 않았습니다." },
        { status: 400 },
      );
    }
    try {
      const products = await fetchCoupangProducts();
      await reportCompletion({
        departmentId: "store",
        agentId: "s6",
        message: `쿠팡 상품 ${products.length}건 조회 완료`,
        incidentKey: "coupang",
      });
      return NextResponse.json({ ok: true, count: products.length, products });
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      await reportFailure({
        departmentId: "store",
        agentId: "s6",
        message,
        incidentKey: "coupang",
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (platform === "vercel") {
    if (!isVercelConfigured()) {
      return NextResponse.json(
        { error: "Vercel API 토큰이 설정되지 않았습니다." },
        { status: 400 },
      );
    }
    try {
      const deployment = await fetchLatestDeployment();
      const stateLabel = describeState(deployment.state);
      await reportCompletion({
        departmentId: "ops",
        agentId: "o4",
        message: `${deployment.name} - ${stateLabel}`,
        incidentKey: "vercel",
      });
      return NextResponse.json({ ok: true, deployment });
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      await reportFailure({
        departmentId: "ops",
        agentId: "o4",
        message,
        incidentKey: "vercel",
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  return NextResponse.json(
    { error: "platform은 naver, coupang, vercel 중 하나여야 합니다." },
    { status: 400 },
  );
}
