import { NextResponse } from "next/server";
import { createLocalConcatJob } from "@/lib/store";

export const runtime = "nodejs";

export async function POST() {
  const job = await createLocalConcatJob("mp4");
  return NextResponse.json({
    job: { id: job.id, status: job.status, outputFormat: job.outputFormat, createdAt: job.createdAt },
    token: job.token,
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
