"use client";

import { useEffect, useState } from "react";
import type { SourcedProduct } from "@/lib/store";

export function SourcingReport() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sourcing/add")
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => null);
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
      {products.map((p) => {
        const hasValidLink = /^https?:\/\//.test(p.url);
        const hasDetail = Boolean(
          p.description || (p.options && p.options.length > 0) || (p.images && p.images.length > 1),
        );
        const isExpanded = expandedId === p.id;
        return (
          <div key={p.id} className="border border-zinc-800 bg-zinc-900">
            <div className="flex items-center gap-2 p-1.5">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt={p.title} className="h-10 w-10 shrink-0 object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-zinc-800 text-[8px] text-zinc-600">
                  없음
                </div>
              )}
              <button
                className="flex min-w-0 flex-1 flex-col items-start text-left"
                onClick={() => hasDetail && setExpandedId(isExpanded ? null : p.id)}
              >
                {hasValidLink ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="truncate text-[11px] font-bold text-zinc-200 hover:underline"
                  >
                    {p.title}
                  </a>
                ) : (
                  <span className="truncate text-[11px] font-bold text-zinc-200">{p.title}</span>
                )}
                <span className="text-[10px] text-zinc-500">
                  {p.scrapedAt}
                  {hasDetail ? (isExpanded ? " · 접기 ▲" : " · 상세보기 ▼") : ""}
                </span>
              </button>
              {p.price && (
                <span className="shrink-0 text-[11px] font-bold text-emerald-400">{p.price}</span>
              )}
              <button
                onClick={() => handleRemove(p.id)}
                disabled={removingId === p.id}
                className="shrink-0 text-xs font-bold text-zinc-500 hover:text-rose-400 disabled:opacity-40"
                title="삭제"
              >
                ✕
              </button>
            </div>

            {isExpanded && (
              <div className="flex flex-col gap-2 border-t border-zinc-800 p-2">
                {p.images && p.images.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto">
                    {p.images.map((img, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={img}
                        alt=""
                        className="h-14 w-14 shrink-0 object-cover"
                      />
                    ))}
                  </div>
                )}
                {p.options && p.options.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-zinc-400">옵션</span>
                    <div className="flex flex-wrap gap-1">
                      {p.options.map((opt, i) => (
                        <span
                          key={i}
                          className="border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300"
                        >
                          {opt}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {p.description && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-zinc-400">상세 설명</span>
                    <p className="text-[10px] leading-relaxed text-zinc-400">{p.description}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
