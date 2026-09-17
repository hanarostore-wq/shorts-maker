import { NextResponse } from "next/server";
import { fetchViaFixedIp, isFixedIpProxyConfigured } from "@/lib/proxyFetch";

// 쿠팡/네이버 API에 등록할 IP를 확인하기 위한 진단 엔드포인트.
// 고정 IP 프록시가 설정돼 있으면 그 프록시를 거친 IP를, 없으면
// 서버가 지금 우연히 나가고 있는 IP를 보여준다.
export async function GET() {
  try {
    const res = await fetchViaFixedIp("https://api.ipify.org?format=json");
    const data = await res.json();
    return NextResponse.json({
      egressIp: data.ip,
      fixedIpProxyConfigured: isFixedIpProxyConfigured(),
    });
  } catch (error) {
    const err = error as Error & { cause?: unknown };
    return NextResponse.json(
      {
        error: err.message,
        cause: err.cause ? String(err.cause) : undefined,
        fixedIpProxyConfigured: isFixedIpProxyConfigured(),
      },
      { status: 500 },
    );
  }
}
