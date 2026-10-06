import { NextResponse } from "next/server";
import { enqueueTask, listTasks } from "@/lib/agent/store";

export async function GET() {
  const tasks = await listTasks();
  return NextResponse.json({ tasks: tasks.filter((task) => task.agentId !== "b_naver") });
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
  if (agentId === "b_naver") {
    return NextResponse.json({ error: "네이버 발행은 MoneyOS 원본 BlogAuto 앱에서 직접 실행합니다." }, { status: 410 });
  }

  const task = await enqueueTask({ departmentId, agentId, instruction });
  return NextResponse.json({ ok: true, task });
}
