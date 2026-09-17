"use client";

import { useEffect, useState } from "react";
import type { SourcedProduct } from "@/lib/store";

export function SourcingReport() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sourcing/add")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setProducts(data.products ?? []);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!products) {
    return <p className="text-[11px] text-zinc-600">불러오는 중...</p>;
  }

  if (products.length === 0) {
    return (
      <p className="text-[11px] text-zinc-600">
        아직 소싱한 상품이 없습니다. 확장프로그램으로 쇼핑몰 페이지에서
        &quot;지금 화면 소싱하기&quot;를 눌러보세요.
      </p>
    );
  }

  return (
    <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
      <span className="text-[11px] text-zinc-500">총 {products.length}건</span>
      {products.map((p) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 border border-zinc-800 bg-zinc-900 p-1.5 hover:border-zinc-600"
        >
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt={p.title} className="h-10 w-10 shrink-0 object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-zinc-800 text-[8px] text-zinc-600">
              없음
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[11px] font-bold text-zinc-200">{p.title}</span>
            <span className="text-[10px] text-zinc-500">{p.scrapedAt}</span>
          </div>
          {p.price && (
            <span className="shrink-0 text-[11px] font-bold text-emerald-400">{p.price}</span>
          )}
        </a>
      ))}
    </div>
  );
}
