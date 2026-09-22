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
  if (products.length === 0) return <p className="text-[11px] text-zinc-600">관리할 소싱 상품이 없습니다. 상품소싱이 작업을 먼저 실행하세요.</p>;

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <span className="text-sm font-bold text-zinc-300">소싱 상품 관리</span>
          <span className="text-[10px] text-zinc-500">총 {products.length}건 · 상품을 클릭하세요</span>
        </div>
        <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {products.map((product) => (
            <button key={product.id} onClick={() => setSelected(product)} className="flex gap-2 border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-emerald-700">
              {product.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image} alt="" className="h-16 w-16 shrink-0 object-cover" />
              ) : <span className="flex h-16 w-16 shrink-0 items-center justify-center bg-zinc-800 text-[9px] text-zinc-600">이미지 없음</span>}
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 text-[11px] font-bold text-zinc-200">{product.title}</span>
                <span className="text-[10px] text-emerald-400">{product.price ?? "가격 미확인"}</span>
                <span className="text-[9px] text-zinc-600">대표 1장 · 상세 {(product.detailImages ?? []).length || Math.max((product.images ?? []).length - 1, 0)}장 · 옵션 {(product.optionGroups ?? []).length || (product.options ?? []).length}개</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelected(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto border-2 border-zinc-600 bg-zinc-950 p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-sm font-bold text-zinc-100">쇼핑몰 상품 상세 미리보기</span>
              <button onClick={() => setSelected(null)} className="text-xs text-zinc-500 hover:text-zinc-200">✕ 닫기</button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[190px_1fr]">
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-zinc-500">대표이미지</span>
                {selected.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.image} alt={selected.title} className="aspect-square w-full object-cover" />
                ) : <div className="flex aspect-square items-center justify-center bg-zinc-800 text-xs text-zinc-600">대표이미지 없음</div>}
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-base font-bold text-zinc-100">{selected.title}</h3>
                  <p className="mt-1 text-sm font-bold text-emerald-400">{selected.price ?? "가격 미확인"}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-zinc-400">옵션</span>
                  {(selected.optionGroups ?? []).length > 0 ? (selected.optionGroups ?? []).map((group) => (
                    <div key={group.name} className="border border-zinc-800 bg-zinc-900 p-2">
                      <span className="text-[10px] text-zinc-500">{group.name}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {group.values.map((value) => <span key={value.label} className={`border px-2 py-1 text-[10px] ${value.availability === "out_of_stock" ? "border-rose-900 text-rose-400 line-through" : "border-zinc-700 text-zinc-300"}`}>{value.label}{value.stock_quantity != null ? ` · ${value.stock_quantity}개` : ""}</span>)}
                      </div>
                    </div>
                  )) : <p className="text-[10px] text-zinc-500">{selected.options?.join(" / ") || "추출된 옵션 없음"}</p>}
                </div>
                {(selected.variants ?? []).length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-zinc-400">확인된 상품 조합</span>
                    <div className="flex flex-col gap-1">{selected.variants?.slice(0, 20).map((variant, index) => <span key={index} className="border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400">{Object.entries(variant.attributes).map(([key, value]) => `${key} ${value}`).join(" · ") || "단일 상품"}{variant.price ? ` · ${variant.price}원` : ""}{variant.availability === "out_of_stock" ? " · 품절" : ""}</span>)}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
              <span className="text-[11px] font-bold text-zinc-400">상세페이지 이미지</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(selected.detailImages?.length ? selected.detailImages : (selected.images ?? []).filter((image) => image !== selected.image)).map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={image} src={image} alt="상세페이지" className="w-full border border-zinc-800 object-contain" />
                ))}
              </div>
              {!selected.detailImages?.length && !(selected.images ?? []).filter((image) => image !== selected.image).length && <p className="text-[10px] text-zinc-600">상세페이지 이미지를 찾지 못했습니다.</p>}
            </div>

            {selected.description && <div className="flex flex-col gap-1 border-t border-zinc-800 pt-3"><span className="text-[11px] font-bold text-zinc-400">상세 설명</span><p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{selected.description}</p></div>}
            {selected.specs && Object.keys(selected.specs).length > 0 && <div className="flex flex-col gap-1 border-t border-zinc-800 pt-3"><span className="text-[11px] font-bold text-zinc-400">상품 고시정보</span>{Object.entries(selected.specs).map(([key, value]) => <div key={key} className="flex gap-2 text-[10px]"><span className="w-32 shrink-0 text-zinc-600">{key}</span><span className="text-zinc-400">{value}</span></div>)}</div>}
            <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
              {/^https?:\/\//.test(selected.url) && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="border border-zinc-600 px-3 py-1 text-[11px] text-zinc-300">원본 상품 페이지 열기</a>}
              <button onClick={() => remove(selected.id)} className="border border-rose-700 px-3 py-1 text-[11px] text-rose-400">상품 삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
