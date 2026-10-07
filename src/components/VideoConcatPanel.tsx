"use client";

export function VideoConcatPanel() {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <section className="control-room-panel border-l-2 border-l-[var(--control-cyan)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] tracking-[.16em] text-[var(--control-cyan)]">MONEYOS // WEB TRIGGER · LOCAL WORKER</p>
            <h3 className="mt-1 text-sm font-bold text-zinc-100">이어붙이기</h3>
          </div>
          <span className="border border-[var(--control-line-strong)] bg-[var(--control-surface-raised)] px-2 py-1 font-mono text-[10px] text-emerald-300">NO VIDEO UPLOAD</span>
        </div>
        <p className="mt-3 leading-5 text-[var(--control-muted)]">이 화면은 시작 버튼만 보냅니다. 원본 영상은 PC의 로컬 작업자가 직접 선택하고 처리하며, 작업이 끝나면 작업자 프로세스와 창이 자동으로 종료됩니다.</p>
      </section>

      <section className="control-room-panel grid gap-2 p-4 text-[11px] leading-5 text-zinc-300 sm:grid-cols-2">
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">웹·서버로 영상 파일을 전송하거나 보관하지 않음</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">PC에서 복수 원본 선택 · 순서는 선택 순서대로 적용</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">모든 원본의 앞·뒤 1초만 제거 · 음성도 보존</div>
        <div className="border border-[var(--control-line)] bg-[var(--control-bg)] px-3 py-2">스트림 복사에 컷 오차가 있으면 자동으로 무손실 MKV 전환</div>
      </section>

      <section className="control-room-panel flex flex-col gap-3 p-4">
        <div>
          <h4 className="font-bold text-zinc-100">내 PC에서 이어붙이기 시작</h4>
          <p className="mt-1 text-[10px] leading-5 text-zinc-500">최초 한 번 PC의 install-concat-worker.ps1로 로컬 작업자를 등록하면, 이후 이 버튼만 누르면 됩니다. 출력은 첫 번째 원본 폴더에 저장됩니다.</p>
        </div>
        <a className="control-room-button px-3 py-2 text-center text-xs font-bold" href="clipjoin://run">원본 영상 여러 개 선택 ↗</a>
      </section>
    </div>
  );
}
