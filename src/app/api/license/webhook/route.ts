import crypto from "crypto";
import { NextResponse } from "next/server";
import { extendLicense, issueLicense, type PaidPlan } from "@/lib/license";

// ───────────────────────────────────────────────────────────────────────────
// 결제 웹훅 - 결제가 끝나면 키를 자동 발급한다.
//
// 결제 업체(레몬스퀴지/검로드/포트원 등)마다 필드 이름이 달라서, 공통으로 쓰는
// 이름들을 폭넓게 받아들이고 HMAC-SHA256 서명으로 위조를 막는다.
// 서명 = HMAC(LICENSE_WEBHOOK_SECRET, 요청 본문 원문), 16진수 문자열.
// ───────────────────────────────────────────────────────────────────────────

const SIGNATURE_HEADERS = ["x-signature", "x-webhook-signature", "x-portone-signature"];

function verifySignature(rawBody: string, request: Request): boolean {
  const secret = process.env.LICENSE_WEBHOOK_SECRET;
  if (!secret) return false;

  const provided =
    SIGNATURE_HEADERS.map((h) => request.headers.get(h)).find((v) => v && v.length > 0) ?? "";
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const cleaned = provided.replace(/^sha256=/i, "").toLowerCase();
  if (cleaned.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cleaned), Buffer.from(expected));
}

interface WebhookPayload {
  event?: string;
  type?: string;
  email?: string;
  buyer_email?: string;
  customer_email?: string;
  plan?: string;
  product?: string;
  product_name?: string;
  variant?: string;
  orderId?: string;
  order_id?: string;
  merchant_uid?: string;
  months?: number;
  licenseKey?: string;
  license_key?: string;
}

function pickEmail(payload: WebhookPayload): string {
  return (payload.email ?? payload.buyer_email ?? payload.customer_email ?? "").trim();
}

function pickOrderId(payload: WebhookPayload): string | null {
  return payload.orderId ?? payload.order_id ?? payload.merchant_uid ?? null;
}

/** 상품명에 "평생/lifetime"이 들어있으면 평생 이용권으로 본다. */
function pickPlan(payload: WebhookPayload): PaidPlan {
  const haystack = [payload.plan, payload.product, payload.product_name, payload.variant]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /lifetime|평생/.test(haystack) ? "lifetime" : "pro";
}

function isRefundEvent(payload: WebhookPayload): boolean {
  const event = `${payload.event ?? ""} ${payload.type ?? ""}`.toLowerCase();
  return /refund|cancel|환불|취소|expired/.test(event);
}

function isRenewalEvent(payload: WebhookPayload): boolean {
  const event = `${payload.event ?? ""} ${payload.type ?? ""}`.toLowerCase();
  return /renew|recurring|재결제|정기/.test(event);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request)) {
    return NextResponse.json({ error: "서명이 올바르지 않습니다." }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const existingKey = payload.licenseKey ?? payload.license_key ?? null;

  try {
    // 환불/해지는 자동으로 키를 없애지 않는다. 잘못된 웹훅 하나로 정상 고객의
    // 키가 날아가는 게 더 큰 사고라, 관리자가 /api/license/issue 로 직접 회수한다.
    if (isRefundEvent(payload)) {
      return NextResponse.json({
        ok: true,
        action: "manual_review",
        message: "환불/해지 이벤트입니다. 키 회수는 관리자가 직접 처리하세요.",
        licenseKey: existingKey,
      });
    }

    if (isRenewalEvent(payload) && existingKey) {
      const record = await extendLicense(existingKey, Number(payload.months ?? 1));
      if (record) return NextResponse.json({ ok: true, action: "extended", license: record });
      // 키를 못 찾으면 아래로 내려가 새로 발급한다.
    }

    const email = pickEmail(payload);
    if (!email.includes("@")) {
      return NextResponse.json({ error: "구매자 이메일을 찾을 수 없습니다." }, { status: 400 });
    }

    const orderId = pickOrderId(payload);
    if (orderId) {
      // 같은 주문으로 웹훅이 두 번 와도 issueLicense가 같은 키를 돌려준다.
      const record = await issueLicense({
        plan: pickPlan(payload),
        email,
        months: payload.months,
        orderId,
        memo: `webhook:${payload.event ?? payload.type ?? "purchase"}`,
      });
      return NextResponse.json({ ok: true, action: "issued", licenseKey: record.key });
    }

    const record = await issueLicense({
      plan: pickPlan(payload),
      email,
      months: payload.months,
      memo: `webhook:${payload.event ?? payload.type ?? "purchase"}`,
    });
    return NextResponse.json({ ok: true, action: "issued", licenseKey: record.key });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// 결제 업체 대시보드에서 "웹훅 주소 살아있나" 확인용으로 GET을 때려보는 경우가 있다.
export async function GET() {
  const configured = Boolean(process.env.LICENSE_WEBHOOK_SECRET);
  return NextResponse.json({ ok: true, webhookSecretConfigured: configured });
}
