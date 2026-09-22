import { NextResponse } from "next/server";
import { gateAction } from "@/lib/agent/store";
import type { ActionKind, AgentAction } from "@/lib/agent/types";
import { ACTION_LABELS } from "@/lib/agent/types";

/**
 * 데스크톱 앱의 에이전트가 쓰기 동작을 실행하기 직전에 호출하는 관문.
 *
 * allowed: true 를 받았을 때만 실제로 실행해야 한다. false 면 승인
 * 대기함에 올라갔다는 뜻이므로 그 자리에서 멈춘다.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { taskId, action } = body ?? {};

  if (!taskId || !action?.kind || !action?.summary) {
    return NextResponse.json(
      { error: "taskId와 action(kind, summary)은 필수입니다." },
      { status: 400 },
    );
  }

  if (!(action.kind in ACTION_LABELS)) {
    return NextResponse.json(
      { error: `알 수 없는 동작 종류입니다: ${action.kind}` },
      { status: 400 },
    );
  }

  // 금액·건수는 정책 판정의 핵심 입력이므로 형태를 엄격히 맞춘다.
  // 숫자로 해석되지 않는 금액은 null(=확인 불가)로 두어 사람에게 올라가게 한다.
  const amountKrw =
    typeof action.amountKrw === "number" && Number.isFinite(action.amountKrw)
      ? action.amountKrw
      : null;
  const itemCount =
    typeof action.itemCount === "number" && Number.isFinite(action.itemCount)
      ? Math.max(1, Math.floor(action.itemCount))
      : 1;

  const normalized: AgentAction = {
    id: action.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    kind: action.kind as ActionKind,
    site: action.site ?? "unknown",
    url: action.url ?? "",
    summary: action.summary,
    amountKrw,
    itemCount,
    screenshot: action.screenshot ?? null,
    payload: action.payload ?? undefined,
  };

  const result = await gateAction(taskId, normalized);

  if (result.allowed) {
    return NextResponse.json({ allowed: true, reason: result.reason });
  }

  return NextResponse.json({
    allowed: false,
    reason: result.approval.reason,
    approvalId: result.approval.id,
  });
}
