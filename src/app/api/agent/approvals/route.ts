import { NextResponse } from "next/server";
import { decideApproval, listApprovals } from "@/lib/agent/store";
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

  return NextResponse.json({ ok: true, approval: result.approval });
}
