"use client";

import { useEffect, useState } from "react";
import type { SourcedProduct } from "@/lib/store";

export function SourcingManagementPanel() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);
  const [selected, setSelected] = useState<SourcedProduct | null>(null);

  const load = () => {
    fetch("/api/sourcing/add", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => setProducts([]));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const remove = async (id: string) => {
    await fetch(`/api/sourcing/add?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setSelected(null);
    load();
  };

  if (!products) return <p className="text-[11px] text-zinc-600">소싱 상품 불러오는 중...</p>;
  if (products.length === 0) {
    return <p className="text-[11px] text-zinc-600">관리할 소싱 상품이 없습니다. 상품소싱이 작업을 먼저 실행하세요.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <span className="text-sm font-bold text-zinc-300">소싱 상품 관리</span>
          <span className="text-[10px] text-zinc-500">총 {products.length}건 · 상품을 클릭하세요</span>
        </div>
        <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => setSelected(product)}
              className="flex gap-2 border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-emerald-700"
            >
              {product.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image} alt="" className="h-16 w-16 shrink-0 object-cover" />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center bg-zinc-800 text-[9px] text-zinc-600">이미지 없음</span>
              )}
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 text-[11px] font-bold text-zinc-200">{product.title}</span>
                <span className="text-[10px] text-emerald-400">{product.price ?? "가격 미확인"}</span>
                <span className="text-[9px] text-zinc-600">사진 {(product.images ?? []).length}장 · v{product.revision ?? 1}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelected(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto border-2 border-zinc-600 bg-zinc-950 p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-sm font-bold text-zinc-100">상품 상세 미리보기</span>
              <button onClick={() => setSelected(null)} className="text-xs text-zinc-500 hover:text-zinc-200">✕ 닫기</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
              <div className="flex flex-col gap-2">
                {selected.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.image} alt={selected.title} className="aspect-square w-full object-cover" />
                ) : <div className="flex aspect-square items-center justify-center bg-zinc-800 text-xs text-zinc-600">대표이미지 없음</div>}
                <div className="flex flex-wrap gap-1">
                  {(selected.images ?? []).map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={image} src={image} alt="" className="h-10 w-10 object-cover" />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-base font-bold text-zinc-100">{selected.title}</h3>
                  <p className="mt-1 text-sm font-bold text-emerald-400">{selected.price ?? "가격 미확인"}</p>
                </div>
                {selected.options && selected.options.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-zinc-400">옵션</span>
                    <div className="flex flex-wrap gap-1">{selected.options.map((option) => <span key={option} className="border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300">{option}</span>)}</div>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-zinc-400">상세페이지 설명</span>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{selected.description ?? "상세 설명 없음"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/^https?:\/\//.test(selected.url) && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="border border-zinc-600 px-3 py-1 text-[11px] text-zinc-300">원본 페이지 열기</a>}
                  <button onClick={() => remove(selected.id)} className="border border-rose-700 px-3 py-1 text-[11px] text-rose-400">상품 삭제</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
