"use client";

import { useEffect, useState } from "react";
import type { SourcedProduct } from "@/lib/store";

export function SourcingReport() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoUrl, setAutoUrl] = useState("");
  const [autoSending, setAutoSending] = useState(false);
  const [autoNotice, setAutoNotice] = useState<string | null>(null);

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

  const handleRemoveImage = async (productId: string, imageUrl: string) => {
    setProducts(
      (prev) =>
        prev?.map((p) =>
          p.id === productId
            ? {
                ...p,
                image: p.image === imageUrl ? null : p.image,
                images: (p.images ?? []).filter((img) => img !== imageUrl),
              }
            : p,
        ) ?? prev,
    );
    await fetch(
      `/api/sourcing/add?id=${encodeURIComponent(productId)}&image=${encodeURIComponent(imageUrl)}`,
      { method: "DELETE" },
    ).catch(() => null);
  };

  const startAutoSourcing = async () => {
    const url = autoUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      setAutoNotice("쇼핑몰 주소를 http:// 또는 https://로 입력해 주세요.");
      return;
    }
    setAutoSending(true);
    setAutoNotice(null);
    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: "store",
          agentId: "s1",
          instruction: `쇼핑몰 전체 상품 자동 소싱: ${url}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAutoNotice(data.error ?? "자동 소싱 작업을 등록하지 못했습니다.");
        return;
      }
      setAutoNotice("자동 소싱 작업을 등록했습니다. Electron 워커가 실행합니다.");
    } catch {
      setAutoNotice("자동 소싱 작업 등록에 실패했습니다.");
    } finally {
      setAutoSending(false);
    }
  };

  const autoBox = (
    <div className="flex flex-col gap-2 border border-emerald-900 bg-zinc-900 p-2">
      <span className="text-[11px] font-bold text-emerald-400">자동 소싱</span>
      <div className="flex flex-wrap gap-2">
        <input
          value={autoUrl}
          onChange={(event) => setAutoUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !autoSending) startAutoSourcing();
          }}
          placeholder="쇼핑몰 주소를 입력하세요"
          className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
        />
        <button
          onClick={startAutoSourcing}
          disabled={autoSending}
          className="border border-emerald-600 px-3 py-1 text-[11px] font-bold text-emerald-400 disabled:opacity-50"
        >
          {autoSending ? "등록 중..." : "자동 소싱"}
        </button>
      </div>
      <span className="text-[10px] leading-relaxed text-zinc-600">
        주소를 입력하면 Electron 워커가 해당 쇼핑몰의 상품을 자동으로 수집합니다.
      </span>
      {autoNotice && <span className="text-[10px] text-amber-300">{autoNotice}</span>}
    </div>
  );

  if (!products) {
    return <div className="flex flex-col gap-2">{autoBox}<p className="text-[11px] text-zinc-600">상품 목록 불러오는 중...</p></div>;
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {autoBox}
        <p className="text-[11px] text-zinc-500">
          수동: 확장프로그램에서 지금 화면 소싱하기 · 자동: Electron 워커가 작업 큐를 실행합니다.
        </p>
        <p className="text-[11px] text-zinc-600">
        아직 소싱한 상품이 없습니다. 확장프로그램으로 쇼핑몰 페이지에서
        &quot;지금 화면 소싱하기&quot;를 눌러보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
      {autoBox}
      <>
        <span className="text-[11px] text-zinc-500">
          총 {products.length}건 · 수동 확장프로그램 / 자동 Electron 워커 공통 결과
        </span>
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
                  <>
                    <span className="text-[10px] text-zinc-500">
                      사진 위 ✕를 눌러 필요 없는 사진을 지우세요
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {allImages.map((img) => (
                        <div key={img} className="group relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img}
                            alt=""
                            className="h-20 w-20 border border-zinc-800 object-cover"
                          />
                          <button
                            onClick={() => handleRemoveImage(p.id, img)}
                            className="absolute right-0 top-0 bg-zinc-950/80 px-1 text-[10px] font-bold text-zinc-400 hover:text-rose-400"
                            title="이 사진 지우기"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
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
      </>
    </div>
  );
}
