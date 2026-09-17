"use client";

import type { Agent } from "@/lib/types";
import { getAgentPlatforms } from "@/lib/agentIntegrations";
import { IntegrationPanel } from "./IntegrationPanel";

export function AgentDetailModal({
  agent,
  onClose,
}: {
  agent: Agent;
  onClose: () => void;
}) {
  const platforms = getAgentPlatforms(agent.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 font-mono"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 border-2 border-zinc-700 bg-zinc-950 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-zinc-800 pb-2">
          <span className="text-sm font-bold text-zinc-100">{agent.name}</span>
          <button
            onClick={onClose}
            className="text-xs font-bold text-zinc-500 hover:text-zinc-200"
          >
            ✕ 닫기
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">{agent.task}</p>

        {platforms.length > 0 ? (
          <IntegrationPanel platforms={platforms} />
        ) : (
          <p className="text-[11px] text-zinc-600">
            이 직원은 아직 실제 연동이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
