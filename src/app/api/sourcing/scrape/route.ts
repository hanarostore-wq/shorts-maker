import { NextResponse } from "next/server";
import { parseListProducts, parseSingleProduct } from "@/lib/siteProfiles";
import { addSourcedProducts } from "@/lib/store";

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
    const { url, html } = await request.json();

    if (!url || !html || typeof html !== "string") {
      return NextResponse.json(
        { error: "url, html이 필요합니다." },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    // 목록/상세 여부를 서버에서 판단한다: 상품처럼 보이는 링크가
    // 2개 이상이면 목록 페이지로, 아니면 상세 페이지로 처리한다.
    const listProducts = parseListProducts(html, url);

    if (listProducts.length >= 2) {
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

    const product = parseSingleProduct(html, url);
    const { added, updatedCount } = await addSourcedProducts([product]);
    return NextResponse.json(
      {
        ok: true,
        mode: "single",
        product,
        addedCount: added.length,
        updatedCount,
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
