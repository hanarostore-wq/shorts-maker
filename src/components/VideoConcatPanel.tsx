"use client";

import { useSyncExternalStore } from "react";

export function VideoConcatPanel() {
  const desktopBrowser = useSyncExternalStore(
    () => () => {},
    () => navigator.userAgent.includes("Electron/"),
    () => false,
  );
  return (
    <div className="flex flex-col gap-4 text-xs">
      <section className="control-room-panel border-l-2 border-l-[var(--control-cyan)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] tracking-[.16em] text-[var(--control-cyan)]">MONEYOS // LOCAL ORIGINAL MODE</p>
            <h3 className="mt-1 text-sm font-bold text-zinc-100">이어붙이기</h3>
          </div>
          <span className="border border-[var(--control-line-strong)] bg-[var(--control-surface-raised)] px-2 py-1 font-mono text-[10px] text-emerald-300">COPY OR LOSSLESS MKV</span>
        </div>
        <p className="mt-3 leading-5 text-[var(--control-muted)]">로컬에서 원본 영상을 여러 개 선택하면 선택 순서대로 앞·뒤 1초만 자르고 하나로 이어붙입니다. 규격이 달라도 자동 처리합니다.</p>
      </section>

      <section className="control-room-panel grid gap-2 p-4 text-[11px] leading-5 text-zinc-300 sm:grid-cols-2">
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">같은 규격은 원본 해상도·비디오 코덱을 그대로 복사</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">다른 규격은 원본 픽셀·음성을 무손실 H.264/FLAC MKV로 보존</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">원본 선택 순서 유지 · ↑ ↓로 순서 변경 가능</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">작은 원본은 확대·크롭 없이 검은 여백으로 원본 픽셀 유지</div>
      </section>

      <section className="control-room-panel flex flex-col gap-3 p-4">
        <div>
          <h4 className="font-bold text-zinc-100">로컬 원본 이어붙이기 실행</h4>
          <p className="mt-1 text-[10px] leading-5 text-zinc-500">출력은 첫 번째 원본과 같은 폴더에 이어붙임_날짜_시간 이름으로 저장됩니다</p>
        </div>
        {desktopBrowser ? (
          <a className="control-room-button px-3 py-2 text-center text-xs font-bold" href="controlroom://launch/concat" target="_blank" rel="noreferrer">원본 영상 여러 개 선택 ↗</a>
        ) : (
          <p className="border border-amber-800/70 bg-amber-950/20 px-3 py-2 text-[11px] leading-5 text-amber-200">PC 관제 브라우저에서 열면 로컬 파일 선택과 이어붙이기 창이 실행됩니다</p>
        )}
      </section>
    </div>
  );
}
