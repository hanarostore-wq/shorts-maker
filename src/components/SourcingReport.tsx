"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MarginCalculator } from "@/components/MarginCalculator";
import { DEFAULT_GOAL, formatKRW } from "@/lib/margin";
import type { SourcedProduct } from "@/lib/store";

const GOAL_STORAGE_KEY = "shorts-maker:profit-goal";
const GOAL_CHANGED_EVENT = "shorts-maker:profit-goal-changed";

// 목표 금액은 이 브라우저에만 저장한다 (서버 상태를 건드릴 만한 값이 아니다).
// 사생활 보호 모드처럼 저장소를 못 쓰는 환경에서도 화면은 그대로 동작하도록
// 메모리 값을 먼저 두고 저장은 "되면 좋고" 수준으로만 시도한다.
let goalCache: number | null = null;

function readGoal(): number {
  if (goalCache !== null) return goalCache;
  try {
    const saved = Number(window.localStorage.getItem(GOAL_STORAGE_KEY));
    goalCache = Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_GOAL;
  } catch {
    goalCache = DEFAULT_GOAL;
  }
  return goalCache;
}

function writeGoal(value: number) {
  goalCache = Math.max(0, value);
  try {
    window.localStorage.setItem(GOAL_STORAGE_KEY, String(goalCache));
  } catch {
    // 저장에 실패해도 이번 세션 동안은 메모리 값으로 계속 쓴다.
  }
  window.dispatchEvent(new Event(GOAL_CHANGED_EVENT));
}

function subscribeGoal(onChange: () => void) {
  // 다른 탭에서 바꾸면 storage, 이 탭에서 바꾸면 커스텀 이벤트로 전달된다.
  window.addEventListener("storage", onChange);
  window.addEventListener(GOAL_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(GOAL_CHANGED_EVENT, onChange);
  };
}

export function SourcingReport() {
  const [products, setProducts] = useState<SourcedProduct[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const goal = useSyncExternalStore(subscribeGoal, readGoal, () => DEFAULT_GOAL);

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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-zinc-500">총 {products.length}건</span>
        <label className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-500">순이익 목표</span>
          <input
            type="number"
            value={goal}
            step={100000}
            min={0}
            onChange={(e) => writeGoal(Number(e.target.value))}
            className="w-28 border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
          />
          <span className="text-[10px] text-zinc-600">원</span>
        </label>
        <span className="text-[10px] text-zinc-600">
          상품을 펼치면 {formatKRW(goal)}까지 몇 개 팔아야 하는지 계산합니다
        </span>
      </div>
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
                <MarginCalculator priceText={p.price} goal={goal} />
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
    </div>
  );
}
