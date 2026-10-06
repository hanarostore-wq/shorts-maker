import { NextResponse } from "next/server";
import { enqueueTask, listTasks } from "@/lib/agent/store";
import { isSocialAuthorized } from "@/lib/socialAuth";

export async function GET(request: Request) {
  const tasks = await listTasks();
  return NextResponse.json({ tasks: isSocialAuthorized(request) ? tasks : tasks.filter((task) => task.agentId !== "b_naver") });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { departmentId, agentId, instruction } = body ?? {};

  if (!departmentId || !agentId || !instruction) {
    return NextResponse.json(
      { error: "departmentId, agentId, instruction은 필수입니다." },
      { status: 400 },
    );
  }
  if (agentId === "b_naver" && !isSocialAuthorized(request)) {
    return NextResponse.json({ error: "소셜 작업자 접근키가 필요합니다." }, { status: 401 });
  }

  const task = await enqueueTask({ departmentId, agentId, instruction });
  return NextResponse.json({ ok: true, task });
}
