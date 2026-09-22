import { NextResponse } from "next/server";
import { addSourcedProducts } from "@/lib/store";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const product = body?.product;
    if (!product?.url || !product?.name) {
      return NextResponse.json(
        { error: "상품 URL과 상품명이 필요합니다." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const images = Array.isArray(product.images)
      ? product.images.map((item: unknown) => typeof item === "string" ? item : (item as { url?: string })?.url).filter((item: unknown): item is string => typeof item === "string")
      : [];
    const result = await addSourcedProducts([{
      url: String(product.url),
      title: String(product.name),
      price: product.cost ? String(product.cost) : null,
      image: images[0] ?? null,
      images,
      options: product.options ? [String(product.options)] : [],
      description: product.description ? String(product.description) : null,
    }]);

    return NextResponse.json({ ok: true, ...result }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "상품 저장에 실패했습니다." },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
