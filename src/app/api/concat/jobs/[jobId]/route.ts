import { NextRequest, NextResponse } from "next/server";
import { getLocalConcatJob, updateLocalConcatJob, type LocalConcatJobStatus } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ jobId: string }> };
const statuses = new Set<LocalConcatJobStatus>(["queued", "working", "completed", "failed", "canceled"]);

export async function GET(request: NextRequest, context: Context) {
  const { jobId } = await context.params;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const job = await getLocalConcatJob(jobId, token);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: Context) {
  const { jobId } = await context.params;
  const body = await request.json().catch(() => null) as { token?: string; status?: string; outputName?: string; error?: string } | null;
  if (!body?.token || !body.status || !statuses.has(body.status as LocalConcatJobStatus)) {
    return NextResponse.json({ error: "유효하지 않은 작업 상태입니다." }, { status: 400 });
  }
  const job = await updateLocalConcatJob({
    id: jobId,
    token: body.token,
    status: body.status as LocalConcatJobStatus,
    outputName: typeof body.outputName === "string" ? body.outputName.slice(0, 180) : undefined,
    error: typeof body.error === "string" ? body.error : undefined,
  });
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
}
