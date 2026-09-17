"use client";

import { useEffect, useState } from "react";
import type { SourcedProduct } from "@/lib/store";

export function SourcedProductsPanel() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/sourcing/add")
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) setProducts(data.products ?? []);
        })
        .catch(() => null);
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 border-2 border-zinc-700 bg-zinc-950 p-3">
      <span className="text-sm font-bold text-zinc-300">
        소싱된 상품 {products ? `(${products.length}건)` : ""}
      </span>
      {!products || products.length === 0 ? (
        <span className="text-[11px] text-zinc-600">
          아직 수집된 상품이 없습니다. 확장프로그램으로 쇼핑몰 페이지에서 소싱해보세요.
        </span>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {products.slice(0, 24).map((p) => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-1 border border-zinc-800 bg-zinc-900 p-2 hover:border-zinc-600"
            >
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.image}
                  alt={p.title}
                  className="h-16 w-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-full items-center justify-center bg-zinc-800 text-[10px] text-zinc-600">
                  이미지 없음
                </div>
              )}
              <span className="line-clamp-2 text-[10px] font-bold text-zinc-200">
                {p.title}
              </span>
              {p.price && (
                <span className="text-[10px] text-emerald-400">{p.price}</span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
