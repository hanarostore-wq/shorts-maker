"use client";

import { useEffect, useState } from "react";
import type { SourcedProduct } from "@/lib/store";

export function SourcingReport() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = () => {
    fetch("/api/sourcing/add")
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => null);
  };

  useEffect(() => {
    load();
  }, []);

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    setProducts((prev) => prev?.filter((p) => p.id !== id) ?? prev);
    await fetch(`/api/sourcing/add?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    setRemovingId(null);
  };

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
        <div
          key={p.id}
          className="flex items-center gap-2 border border-zinc-800 bg-zinc-900 p-1.5"
        >
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80"
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
          <button
            onClick={() => handleRemove(p.id)}
            disabled={removingId === p.id}
            className="shrink-0 border border-zinc-700 px-1.5 py-1 text-[10px] font-bold text-zinc-500 hover:border-rose-600 hover:text-rose-400 disabled:opacity-40"
          >
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}
