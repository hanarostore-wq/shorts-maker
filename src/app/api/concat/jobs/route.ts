import { NextRequest, NextResponse } from "next/server";
import { createLocalConcatJob, isConcatPersistentStorageAvailable } from "@/lib/store";
import { isTrustedConcatBrowserRequest } from "@/lib/concatSecurity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedConcatBrowserRequest(request)) return NextResponse.json({ error: "관제실에서 시작한 요청만 허용됩니다." }, { status: 403 });
  if (!isConcatPersistentStorageAvailable()) return NextResponse.json({ error: "공유 저장소가 연결되지 않아 이어붙이기 작업을 시작할 수 없습니다." }, { status: 503 });
  const body = await request.json().catch(() => null) as { processingMode?: string; outputQuality?: string } | null;
  const processingMode = body?.processingMode === "copy" ? "copy" : "normalize";
  const outputQuality = body?.outputQuality === "720p" || body?.outputQuality === "1080p" ? body.outputQuality : "source";
  const job = await createLocalConcatJob("mp4", processingMode, outputQuality);
  if (!job) return NextResponse.json({ error: "다른 이어붙이기 작업이 진행 중입니다." }, { status: 409 });
  return NextResponse.json({
    job: { id: job.id, status: job.status, outputFormat: job.outputFormat, processingMode: job.processingMode, outputQuality: job.outputQuality, createdAt: job.createdAt },
    token: job.token,
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
