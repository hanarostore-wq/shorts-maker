import { NextResponse } from "next/server";
import { reportCompletion } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const { departmentId, agentId, message } = body ?? {};

  if (!departmentId || !agentId || !message) {
    return NextResponse.json(
      { error: "departmentId, agentId, message는 필수입니다." },
      { status: 400 },
    );
  }

  const entry = reportCompletion({ departmentId, agentId, message });
  if (!entry) {
    return NextResponse.json({ error: "해당 부서/직원을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, entry });
}
