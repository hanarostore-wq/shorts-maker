import { NextResponse } from "next/server";
import { addSourcedProducts, getSourcedProducts } from "@/lib/store";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET() {
  const products = await getSourcedProducts();
  return NextResponse.json({ products }, { headers: CORS_HEADERS });
}

interface RawProduct {
  url?: string;
  title?: string;
  price?: string | null;
  image?: string | null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const items: RawProduct[] = Array.isArray(body?.products)
    ? body.products
    : body?.url
      ? [body]
      : [];

  const valid = items
    .filter((p): p is Required<Pick<RawProduct, "url" | "title">> & RawProduct =>
      Boolean(p.url && p.title),
    )
    .map((p) => ({
      url: p.url!,
      title: p.title!,
      price: p.price ?? null,
      image: p.image ?? null,
    }));

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "url, title이 있는 상품이 최소 1개 필요합니다." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const added = await addSourcedProducts(valid);
  return NextResponse.json(
    { ok: true, addedCount: added.length, skippedCount: valid.length - added.length },
    { headers: CORS_HEADERS },
  );
}
