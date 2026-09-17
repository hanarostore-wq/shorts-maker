import { NextResponse } from "next/server";

// 쿠팡/네이버 API에 등록할 IP를 확인하기 위한 임시 진단 엔드포인트.
// 서버가 실제로 어떤 IP로 외부에 나가는지 보여준다.
export async function GET() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return NextResponse.json({ egressIp: data.ip });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "조회 실패" },
      { status: 500 },
    );
  }
}
