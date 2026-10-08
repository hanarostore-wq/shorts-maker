"use client";

import type { Agent } from "@/lib/types";

const managers = new Set(["c_gemini", "c_claude", "c_grok", "c_manus", "c_gpt"]);

export function TradingCollaborationPanel({ agent }: { agent: Agent }) {
  const isManager = managers.has(agent.id);
  return (
    <div className="flex flex-col gap-3 text-white">
      <section className="control-room-panel flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[var(--control-cyan)]">PAPER 자동 협업 상태</span>
          <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${agent.status === "active" ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300" : "border-sky-500/40 bg-sky-950/30 text-sky-300"}`}>{agent.status === "active" ? "작동 중" : "명령 대기"}</span>
        </div>
        <p className="break-words text-xs leading-6 text-zinc-100">{agent.task}</p>
      </section>

      {isManager ? (
        <section className="control-room-panel flex flex-col gap-2 p-3">
          <span className="text-xs font-bold text-zinc-100">슬롯 관리 경로</span>
          <p className="text-[11px] leading-6 text-zinc-300">GitHub 명령 대기열에 슬롯 추가·삭제·적용 JSON을 제출합니다. 서버는 5초 주기로 PAPER 모드·활성 슬롯 해시·YuJin 슬롯 형식을 검사한 뒤 처리합니다.</p>
          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            <a className="rounded border border-sky-500/40 bg-sky-950/20 px-3 py-2 font-bold text-sky-200 hover:bg-sky-900/40" href="https://github.com/hanarostore-wq/obsidian-main/tree/trading-slot-commands/slot-commands/pending" target="_blank" rel="noreferrer">슬롯 명령 대기열 열기</a>
            <a className="rounded border border-emerald-500/40 bg-emerald-950/20 px-3 py-2 font-bold text-emerald-200 hover:bg-emerald-900/40" href="https://github.com/hanarostore-wq/obsidian-main/tree/trading-events/slot-command-results" target="_blank" rel="noreferrer">처리 결과 이력 열기</a>
          </div>
          <p className="break-words text-[10px] leading-5 text-zinc-400">허용: import_apply · apply · remove / 차단: LIVE 명령, stale 해시, 형식 오류</p>
        </section>
      ) : (
        <section className="control-room-panel flex flex-col gap-2 p-3">
          <span className="text-xs font-bold text-zinc-100">체결 자료 검증</span>
          <p className="text-[11px] leading-6 text-zinc-300">PAPER 매수·매도 체결마다 체결 evidence, 진입·매도·익절·손절 근거, 관련 판단, 활성 슬롯, 1분 200봉 차트가 자동 저장됩니다.</p>
          <a className="rounded border border-emerald-500/40 bg-emerald-950/20 px-3 py-2 text-center text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40" href="https://github.com/hanarostore-wq/obsidian-main/tree/trading-events/trading-events" target="_blank" rel="noreferrer">자동 체결·차트 패키지 열기</a>
        </section>
      )}

      <p className="px-1 text-[10px] leading-5 text-zinc-400">자동 적용은 현재 PAPER에만 한정됩니다. LIVE 전환·실주문·비밀정보 전송은 이 모달과 자동화 범위에 포함되지 않습니다.</p>
    </div>
  );
}
