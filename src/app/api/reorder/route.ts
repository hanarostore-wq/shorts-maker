import { NextResponse } from "next/server";
import { reorderAgents } from "@/lib/store";

export async function POST(request: Request) {
  const { departmentId, agentIds } = await request.json();

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
