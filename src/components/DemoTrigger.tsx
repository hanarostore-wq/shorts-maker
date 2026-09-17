"use client";

import { useState } from "react";
import type { Department } from "@/lib/types";

const sampleMessages = [
  "작업을 완료했습니다",
  "결과물을 업로드했습니다",
  "새 항목을 등록했습니다",
  "검토를 마쳤습니다",
];

export function DemoTrigger({ departments }: { departments: Department[] }) {
  const [loading, setLoading] = useState(false);

  const triggerRandom = async () => {
    setLoading(true);
    const department = departments[Math.floor(Math.random() * departments.length)];
    const agent = department.agents[Math.floor(Math.random() * department.agents.length)];
    const message = sampleMessages[Math.floor(Math.random() * sampleMessages.length)];

    await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        departmentId: department.id,
        agentId: agent.id,
        message: `${agent.task} - ${message}`,
      }),
    });
    setLoading(false);
  };

  return (
    <button
      onClick={triggerRandom}
      disabled={loading}
      className="border-2 border-emerald-500 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
    >
      {loading ? "보고 중..." : "테스트: 작업 완료 보고"}
    </button>
  );
}
