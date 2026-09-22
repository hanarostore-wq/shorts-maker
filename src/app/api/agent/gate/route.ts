import { NextResponse } from "next/server";
import { isSharedStorageConfigured } from "@/lib/store";

/**
 * 에이전트 승인 관문이 연결되기 전까지는 모든 쓰기 동작을 통과시키지 않는다.
 * 에이전트 승인 시스템이 main에 통합되면 이 fail-closed 경로를 실제 gateAction
 * 호출로 교체해야 하며, Redis가 끊긴 경우의 차단 조건은 유지해야 한다.
 */
export async function POST() {
  if (!isSharedStorageConfigured()) {
    return NextResponse.json(
      {
        allowed: false,
        error: "공유저장소 미연결 상태에서는 쓰기 동작을 실행할 수 없습니다.",
        code: "SHARED_STORAGE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      allowed: false,
      error: "에이전트 승인 관문이 아직 활성화되지 않았습니다.",
      code: "AGENT_GATE_NOT_ACTIVE",
    },
    { status: 501 },
  );
}
