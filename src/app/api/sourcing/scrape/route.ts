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

// 확장프로그램은 지금 보고 있는 페이지의 원본 HTML만 보내고,
// 사이트별 파싱 규칙은 여기(서버)에서 처리한다. 규칙을 새로 추가/수정할
// 때 확장프로그램을 다시 설치할 필요가 없도록 하기 위함.
export async function POST(request: Request) {
  const { url, html } = await request.json();

  if (!url || !html) {
    return NextResponse.json(
      { error: "url, html이 필요합니다." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // 목록/상세 여부를 서버에서 판단한다: 상품처럼 보이는 링크가
    // 2개 이상이면 목록 페이지로, 아니면 상세 페이지로 처리한다.
    const listProducts = parseListProducts(html, url);

    if (listProducts.length >= 2) {
      const added = await addSourcedProducts(listProducts);
      return NextResponse.json(
        {
          ok: true,
          mode: "list",
          foundCount: listProducts.length,
          addedCount: added.length,
          skippedCount: listProducts.length - added.length,
        },
        { headers: CORS_HEADERS },
      );
    }

    const product = parseSingleProduct(html, url);
    const added = await addSourcedProducts([product]);
    return NextResponse.json(
      {
        ok: true,
        mode: "single",
        product,
        addedCount: added.length,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "분석 실패" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
