"use client";

import { useSyncExternalStore } from "react";

type Platform = "naver" | "threads";

const SOURCE = {
  naver: {
    name: "BlogAuto",
    label: "NAVER BLOG AUTOMATION",
    repo: "https://github.com/boksajang/naverblog-extention",
    features: ["계정별 Chrome·확장프로그램 연결", "Codex 조사·제목·본문·이미지 파이프라인", "네이버·티스토리 발행과 예약", "작업 이력·재시도·세션 진단"],
    install: "npm ci",
  },
  threads: {
    name: "Threads Auto",
    label: "THREADS CONTENT OPERATIONS",
    repo: "https://github.com/boksajang/threads-auto",
    features: ["다중 계정 페르소나·운영 계획", "Codex 기반 콘텐츠 생성·품질 검수", "Threads 예약·즉시 발행·댓글 관리", "YouTube·블로그·쿠팡·브랜드커넥트 소스와 성과 분석"],
    install: "npm run setup",
  },
} as const;

export function OriginalAppsPanel({ platform }: { platform: Platform }) {
  const desktopBrowser = useSyncExternalStore(
    () => () => {},
    () => navigator.userAgent.includes("Electron/"),
    () => false,
  );
  const app = SOURCE[platform];
  return (
    <div className="flex flex-col gap-4 text-xs">
      <section className="control-room-panel border-l-2 border-l-[var(--control-cyan)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] tracking-[.16em] text-[var(--control-cyan)]">MONEYOS // ORIGINAL APP</p>
            <h3 className="mt-1 text-sm font-bold text-zinc-100">{app.label}</h3>
          </div>
          <span className="border border-[var(--control-line-strong)] bg-[var(--control-surface-raised)] px-2 py-1 font-mono text-[10px] text-emerald-300">UPSTREAM FULL BUILD</span>
        </div>
        <p className="mt-3 leading-5 text-[var(--control-muted)]">
          원본 {app.name}의 생성·발행·예약·확장프로그램·로컬 데이터 구조를 그대로 실행합니다. MoneyOS는 창 디자인과 실행 진입점만 제공합니다.
        </p>
      </section>

      <section className="control-room-panel p-4">
        <h4 className="font-mono text-[11px] font-bold tracking-[.08em] text-zinc-200">원본 기능 전체</h4>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {app.features.map((feature) => (
            <li key={feature} className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2 text-[11px] leading-5 text-zinc-300">{feature}</li>
          ))}
        </ul>
      </section>

      <section className="control-room-panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-zinc-100">원본 프로그램 실행</h4>
            <p className="mt-1 text-[10px] leading-5 text-zinc-500">PC에 원본 저장소 전체와 MoneyOS CSS 오버레이가 설치된 뒤 별도 Electron 창으로 실행됩니다</p>
          </div>
          {desktopBrowser ? (
            <a className="control-room-button px-3 py-2 text-xs font-bold" href={`controlroom://launch/${platform}`} target="_blank" rel="noreferrer">{app.name} 전체 실행 ↗</a>
          ) : (
            <a className="control-room-button px-3 py-2 text-xs font-bold" href="https://github.com/hanarostore-wq/shorts-maker/blob/main/desktop/README.md" target="_blank" rel="noreferrer">PC 설치·실행 안내 ↗</a>
          )}
        </div>
        <div className="border-t border-[var(--control-line)] pt-3 text-[10px] leading-5 text-zinc-500">
          설치 명령: <code className="text-[var(--control-cyan)]">{app.install}</code> · 원본 계정·토큰·Chrome 확장·로컬 데이터는 해당 앱 안에서 직접 관리됩니다
        </div>
      </section>

      <a className="text-[11px] text-[var(--control-cyan)] underline underline-offset-4" href={app.repo} target="_blank" rel="noreferrer">원본 {app.name} 소스 보기 ↗</a>
    </div>
  );
}
