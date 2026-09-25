import { NextResponse } from "next/server";
import { moveAgent, reorderAgents } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const { departmentId, agentIds, fromDepartmentId, toDepartmentId, agentId, beforeAgentId } = body ?? {};

  if (fromDepartmentId && toDepartmentId && agentId) {
    const ok = await moveAgent(
      String(fromDepartmentId),
      String(toDepartmentId),
      String(agentId),
      beforeAgentId ? String(beforeAgentId) : null,
    );
    if (!ok) return NextResponse.json({ error: "직원 또는 부서를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, moved: true });
  }

  if (!departmentId || !Array.isArray(agentIds)) {
    return NextResponse.json(
      { error: "departmentId와 agentIds(배열)가 필요합니다." },
      { status: 400 },
    );
  }

  const ok = await reorderAgents(departmentId, agentIds);
  if (!ok) {
    return NextResponse.json({ error: "해당 부서를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
