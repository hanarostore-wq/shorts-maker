import { NextResponse } from "next/server";
import { decideApproval, listApprovals } from "@/lib/agent/store";
import type { ApprovalRequest } from "@/lib/agent/types";
import { executeGatedAction } from "@/lib/integrations/executeAction";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") as ApprovalRequest["state"] | null;
  const approvals = await listApprovals(state ? { state } : undefined);
  return NextResponse.json({ approvals });
}

/** 승인 대기함에서 승인/거부 버튼을 눌렀을 때. */
export async function POST(request: Request) {
  const body = await request.json();
  const { approvalId, approve, decidedBy } = body ?? {};

  if (!approvalId || typeof approve !== "boolean" || !decidedBy) {
    return NextResponse.json(
      { error: "approvalId, approve(boolean), decidedBy는 필수입니다." },
      { status: 400 },
    );
  }

  const result = await decideApproval({ approvalId, approve, decidedBy });
  if (!result) {
    return NextResponse.json({ error: "해당 승인 요청을 찾을 수 없습니다." }, { status: 404 });
  }

  // 이미 다른 담당자가 처리한 건이면 덮어쓰지 않고 현재 상태를 알려준다.
  if (result.alreadyDecided) {
    return NextResponse.json(
      {
        ok: false,
        error: `이미 처리된 요청입니다 (${result.approval.state}, ${result.approval.decidedBy ?? "-"})`,
        approval: result.approval,
      },
      { status: 409 },
    );
  }

  // 승인은 했는데 아무것도 실행되지 않으면 반쪽이다. 승인된 동작을 바로
  // 실행하고 그 결과까지 함께 돌려준다.
  if (result.approval.state !== "approved") {
    return NextResponse.json({ ok: true, approval: result.approval });
  }

  try {
    const executed = await executeGatedAction(result.approval.action);
    return NextResponse.json({
      ok: true,
      approval: result.approval,
      // null이면 이 서버가 직접 실행할 수 있는 종류가 아니라는 뜻이다
      // (예: 브라우저로 수행하는 수집 — 데스크톱 워커가 이어서 처리한다).
      executed: executed ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    // 승인 자체는 이미 기록됐다. 실행이 실패했다는 사실을 분명히 알린다.
    return NextResponse.json(
      {
        ok: true,
        approval: result.approval,
        executed: { ok: false, message: `승인됐지만 실행에 실패했습니다: ${message}` },
      },
      { status: 502 },
    );
  }
}
