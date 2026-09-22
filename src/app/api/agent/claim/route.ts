import { NextResponse } from "next/server";
import { claimNextTask, setTaskStatus } from "@/lib/agent/store";

/** 데스크톱 워커가 다음 작업을 하나 꺼내간다. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const task = await claimNextTask(body?.agentId);
  return NextResponse.json({ task });
}

/** 워커가 작업을 끝내고 결과를 보고한다. */
export async function PATCH(request: Request) {
  const body = await request.json();
  const { taskId, status, error } = body ?? {};

  if (!taskId || !status) {
    return NextResponse.json({ error: "taskId와 status는 필수입니다." }, { status: 400 });
  }

  const task = await setTaskStatus(taskId, status, error ?? null);
  if (!task) {
    return NextResponse.json({ error: "해당 작업을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, task });
}
