import { NextResponse } from "next/server";
import { decideApproval, listApprovals, removeApproval } from "@/lib/agent/store";
import type { ApprovalRequest } from "@/lib/agent/types";

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

  // 실제 실행은 데스크톱 워커가 브라우저에서 한다. 승인하면 그 작업이 다시
  // 큐에 올라가고, 워커가 이어받아 승인받은 동작을 수행한다.
  return NextResponse.json({
    ok: true,
    approval: result.approval,
    resumed: result.approval.state === "approved",
  });
}

/** 승인 목록에서 X로 제거한다. 연결된 대기 작업도 재실행되지 않도록 취소한다. */
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const approvalId = typeof body?.approvalId === "string" ? body.approvalId : "";
  if (!approvalId) {
    return NextResponse.json({ error: "approvalId는 필수입니다." }, { status: 400 });
  }
  const removed = await removeApproval(approvalId);
  if (!removed) {
    return NextResponse.json({ error: "해당 승인 요청을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, removedApprovalId: removed.id });
}
