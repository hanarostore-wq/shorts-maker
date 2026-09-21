import { NextResponse } from "next/server";
import {
  extendLicense,
  isAdminAuthorized,
  issueLicense,
  listLicenses,
  releaseDevice,
  revokeLicense,
  type PaidPlan,
} from "@/lib/license";

// 계좌이체·토스 송금처럼 사람이 직접 확인하고 파는 경우에 쓰는 발급 창구.
// Authorization: Bearer <LICENSE_ADMIN_TOKEN> 이 있어야 한다.

function unauthorized() {
  return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return unauthorized();
  const licenses = await listLicenses();
  return NextResponse.json({
    count: licenses.length,
    licenses: licenses.map((l) => ({
      ...l,
      // 기기 id 원본은 굳이 밖으로 내보내지 않는다.
      devices: l.devices.map((d) => ({ lastSeenAt: d.lastSeenAt, id: d.id.slice(0, 8) })),
    })),
  });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return unauthorized();

  let body: {
    plan?: string;
    email?: string;
    months?: number;
    orderId?: string;
    memo?: string;
    /** 기존 키 연장 */
    extendKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  try {
    if (body.extendKey) {
      const months = Number(body.months ?? 1);
      if (!Number.isFinite(months) || months <= 0) {
        return NextResponse.json({ error: "months는 1 이상이어야 합니다." }, { status: 400 });
      }
      const record = await extendLicense(body.extendKey, months);
      if (!record) return NextResponse.json({ error: "키를 찾을 수 없습니다." }, { status: 404 });
      return NextResponse.json({ ok: true, license: record });
    }

    const plan = body.plan === "lifetime" ? "lifetime" : "pro";
    const email = (body.email ?? "").trim();
    if (!email.includes("@")) {
      return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
    }

    const record = await issueLicense({
      plan: plan as PaidPlan,
      email,
      months: body.months,
      orderId: body.orderId ?? null,
      memo: body.memo,
    });
    return NextResponse.json({ ok: true, license: record });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isAdminAuthorized(request)) return unauthorized();

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const deviceId = url.searchParams.get("deviceId");
  if (!key) return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });

  // deviceId까지 주면 "키 회수"가 아니라 "그 기기만 해제" (PC를 바꾼 고객 응대용)
  if (deviceId) {
    const released = await releaseDevice(key, deviceId);
    return NextResponse.json({ ok: released });
  }

  const record = await revokeLicense(key);
  if (!record) return NextResponse.json({ error: "키를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, license: record });
}
