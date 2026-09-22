"use client";

import { useState } from "react";

export function SourcingWorkerPanel() {
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    const value = url.trim();
    if (!/^https?:\/\//.test(value)) {
      setNotice("쇼핑몰 주소를 http:// 또는 https://로 입력해 주세요.");
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: "store",
          agentId: "s1",
          instruction: `쇼핑몰 전체 상품 자동 소싱: ${value}`,
        }),
      });
      const data = await res.json();
      setNotice(res.ok ? "자동 소싱 지시가 등록됐습니다." : data.error ?? "등록 실패");
      if (res.ok) setUrl("");
    } catch {
      setNotice("자동 소싱 지시 등록에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-2 border-emerald-900 bg-zinc-950 p-3">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="text-sm font-bold text-emerald-400">상품소싱 임무</span>
        <span className="text-[10px] text-zinc-600">수동 확장프로그램 · 자동 워커</span>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        자동은 쇼핑몰 주소를 받아 워커가 작업 큐에서 실행합니다. 수동 소싱 결과는 소싱관리 직원이 관리합니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !sending) submit(); }}
          placeholder="쇼핑몰 주소"
          className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
        />
        <button
          onClick={submit}
          disabled={sending}
          className="border border-emerald-600 px-3 py-1 text-[11px] font-bold text-emerald-400 disabled:opacity-50"
        >
          {sending ? "등록 중..." : "자동 소싱"}
        </button>
      </div>
      {notice && <span className="text-[10px] text-amber-300">{notice}</span>}
      <div className="border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
        수동 규칙: 확장프로그램 버튼을 눌렀을 때 현재 화면에 보이는 상품만 수집하며 자동 스크롤·무한 펼치기는 사용하지 않습니다.
      </div>
    </div>
  );
}
