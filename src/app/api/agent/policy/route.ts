import { NextResponse } from "next/server";
import { getPolicy, getUsage, updatePolicy } from "@/lib/agent/store";

export async function GET() {
  const [policy, usage] = await Promise.all([getPolicy(), getUsage()]);
  return NextResponse.json({ policy, usage });
}

/** 관제실에서 자동 승인 on/off·임계값을 바꿀 때. */
export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "변경할 정책을 보내주세요." }, { status: 400 });
  }
  const policy = await updatePolicy(body);
  return NextResponse.json({ ok: true, policy });
}
