import { NextResponse } from "next/server";
import {
  collectDetailImages,
  parseListProducts,
  parseSingleProduct,
  type CapturedFrame,
} from "@/lib/siteProfiles";
import { addSourcedProducts } from "@/lib/store";
import {
  consumeDailyQuota,
  isEnforcementEnabled,
  resolveEntitlement,
  PLAN_FEATURES,
  type Entitlement,
} from "@/lib/license";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

// 서버 함수가 처리 시간 제한에 걸려 아무 설명 없이 죽어버리는 걸 막기 위해
// 넉넉하게 시간을 늘려둔다 (Vercel 배포 환경에서 허용하는 한도까지).
export const maxDuration = 60;

// 확장프로그램은 지금 보고 있는 페이지의 원본 HTML만 보내고,
// 사이트별 파싱 규칙은 여기(서버)에서 처리한다. 규칙을 새로 추가/수정할
// 때 확장프로그램을 다시 설치할 필요가 없도록 하기 위함.
export async function POST(request: Request) {
  // 요청을 읽는 부분에서 문제가 생겨도(형식이 깨진 데이터 등) 서버가
  // 설명 없이 죽지 않고, 항상 JSON으로 이유를 응답하도록 이 부분도
  // 오류 처리 범위 안에 둔다.
  try {
    const { url, html, frames, licenseKey, deviceId } = await request.json();

    if (!url || !html || typeof html !== "string") {
      return NextResponse.json(
        { error: "url, html이 필요합니다." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // 유료 기능/한도 확인. 강제 적용을 켜지 않은 동안에는 전부 프로로 취급한다
    // (혼자 쓰던 기존 사용 방식이 그대로 유지되도록).
    const entitlement: Entitlement = isEnforcementEnabled()
      ? await resolveEntitlement(licenseKey, String(deviceId ?? "unknown"))
      : { plan: "lifetime", features: PLAN_FEATURES.lifetime, reason: null };

    // 상세페이지는 별도의 iframe 안에 들어있는 경우가 많다. 확장프로그램이
    // 모든 프레임을 함께 보내주므로, 바깥 페이지에서 못 찾은 상세 사진을
    // 안쪽 프레임에서 마저 찾는다.
    const capturedFrames: CapturedFrame[] = Array.isArray(frames) ? frames : [];
    // 목록/상세 여부를 서버에서 판단한다: 상품처럼 보이는 링크가
    // 2개 이상이면 목록 페이지로, 아니면 상세 페이지로 처리한다.
    const listProducts = parseListProducts(html, url);

    if (listProducts.length >= 2) {
      if (!entitlement.features.bulkList) {
        return NextResponse.json(
          {
            error:
              "목록 페이지를 통째로 수집하는 기능은 프로 전용입니다. 상품 상세 페이지에서는 무료로 사용할 수 있어요.",
            upgrade: true,
            plan: entitlement.plan,
          },
          { status: 402, headers: CORS_HEADERS },
        );
      }
      const { added, updatedCount } = await addSourcedProducts(listProducts);
      return NextResponse.json(
        {
          ok: true,
          mode: "list",
          foundCount: listProducts.length,
          addedCount: added.length,
          updatedCount,
        },
        { headers: CORS_HEADERS },
      );
    }

    const quota = await consumeDailyQuota(
      String(deviceId ?? "unknown"),
      entitlement.features.dailyScrapeLimit,
    );
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `무료 이용은 하루 ${quota.limit}건까지입니다. 프로로 업그레이드하면 무제한으로 쓸 수 있어요.`,
          upgrade: true,
          plan: entitlement.plan,
          used: quota.used,
          limit: quota.limit,
        },
        { status: 402, headers: CORS_HEADERS },
      );
    }

    const parsed = parseSingleProduct(html, url);
    const extraImages = collectDetailImages(capturedFrames, parsed.images);
    const product = { ...parsed, images: [...parsed.images, ...extraImages] };

    const { added, updatedCount } = await addSourcedProducts([product]);
    return NextResponse.json(
      {
        ok: true,
        mode: "single",
        product,
        addedCount: added.length,
        updatedCount,
        plan: entitlement.plan,
        quota: { used: quota.used, limit: quota.limit },
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    console.error("[sourcing/scrape] 처리 실패:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `분석 실패: ${error.message}`
            : "분석 실패: 알 수 없는 오류",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
