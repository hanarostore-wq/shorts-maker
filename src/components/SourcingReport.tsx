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
        const allImages = Array.from(new Set([p.image, ...(p.images ?? [])].filter(Boolean))) as string[];
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
                onClick={() => setExpandedId(isExpanded ? null : p.id)}
              >
                <span className="flex items-center gap-1 truncate text-[11px] font-bold text-zinc-200">
                  {p.title}
                  <span className="shrink-0 rounded-none border border-zinc-700 px-1 text-[9px] font-bold text-emerald-400">
                    v{p.revision ?? 1}
                  </span>
                </span>
                <span className="text-[10px] text-zinc-500">
                  {p.scrapedAt} · 사진 {allImages.length}장 {isExpanded ? "▲" : "▼"}
                </span>
              </button>
              {p.price && (
                <span className="shrink-0 text-[11px] font-bold text-emerald-400">{p.price}</span>
              )}
              {hasValidLink && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                  title="원본 페이지 열기"
                >
                  🔗
                </a>
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
                {allImages.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {allImages.map((img, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={img}
                        alt=""
                        className="h-20 w-20 border border-zinc-800 object-cover"
                      />
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] text-zinc-600">수집된 사진이 없습니다.</span>
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
