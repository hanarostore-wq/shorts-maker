import { NextResponse } from "next/server";
import { enqueueTask, listTasks } from "@/lib/agent/store";

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
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

  const task = await enqueueTask({ departmentId, agentId, instruction });
  return NextResponse.json({ ok: true, task });
}
