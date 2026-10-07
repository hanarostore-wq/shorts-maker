import { NextRequest, NextResponse } from "next/server";
import { getLocalConcatNotificationConfig, isConcatPersistentStorageAvailable, setLocalConcatNotificationWebhook } from "@/lib/store";
import { isTrustedConcatBrowserRequest } from "@/lib/concatSecurity";

export const runtime = "nodejs";

export async function GET() {
  if (!isConcatPersistentStorageAvailable()) return NextResponse.json({ error: "공유 저장소가 연결되지 않았습니다." }, { status: 503 });
  return NextResponse.json(await getLocalConcatNotificationConfig(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  if (!isTrustedConcatBrowserRequest(request)) return NextResponse.json({ error: "관제실에서 저장한 요청만 허용됩니다." }, { status: 403 });
  if (!isConcatPersistentStorageAvailable()) return NextResponse.json({ error: "공유 저장소가 연결되지 않았습니다." }, { status: 503 });
  const body = await request.json().catch(() => null) as { webhookUrl?: string | null } | null;
  if (!body || !(typeof body.webhookUrl === "string" || body.webhookUrl === null)) {
    return NextResponse.json({ error: "웹훅 주소 형식이 올바르지 않습니다." }, { status: 400 });
  }
  try {
    return NextResponse.json(await setLocalConcatNotificationWebhook(body.webhookUrl), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "웹훅 저장에 실패했습니다." }, { status: 400 });
  }
}
