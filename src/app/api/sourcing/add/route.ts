import { NextResponse } from "next/server";
import {
  addSourcedProducts,
  getSourcedProducts,
  removeSourcedProduct,
  removeSourcedProductImage,
} from "@/lib/store";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
  images?: string[];
  options?: string[];
  description?: string | null;
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
      images: p.images,
      options: p.options,
      description: p.description,
    }));

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "url, title이 있는 상품이 최소 1개 필요합니다." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { added, updatedCount } = await addSourcedProducts(valid);
  return NextResponse.json(
    { ok: true, addedCount: added.length, updatedCount },
    { headers: CORS_HEADERS },
  );
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400, headers: CORS_HEADERS });
  }

  // image가 함께 오면 상품 전체가 아니라 그 사진 한 장만 지운다.
  const image = searchParams.get("image");
  if (image) {
    const removedImage = await removeSourcedProductImage(id, image);
    if (!removedImage) {
      return NextResponse.json(
        { error: "해당 사진을 찾을 수 없습니다." },
        { status: 404, headers: CORS_HEADERS },
      );
    }
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  const removed = await removeSourcedProduct(id);
  if (!removed) {
    return NextResponse.json({ error: "해당 상품을 찾을 수 없습니다." }, { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
