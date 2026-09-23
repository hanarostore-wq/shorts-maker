"use client";

import type { Agent } from "@/lib/types";
import type { Department } from "@/lib/types";
import { getAgentPlatforms, getAgentTool } from "@/lib/agentIntegrations";
import { IntegrationPanel } from "./IntegrationPanel";
import { ApprovalInbox } from "./ApprovalInbox";
import { TaskConsole } from "./TaskConsole";
import { PolicyPanel } from "./PolicyPanel";
import { SharedStoragePanel } from "./SharedStoragePanel";
import { SourcingWorkerPanel } from "./SourcingWorkerPanel";
import { SourcingManagementPanel } from "./SourcingManagementPanel";
import { UpbitReportDashboard } from "./UpbitReportDashboard";
import { AssetManagementPanel, LiveTradingPanel, ProfitRealizationPanel } from "./TradingAccountPanels";
import { TradingRolePanel } from "./TradingRolePanel";

export function AgentDetailModal({
  agent,
  departments,
  onClose,
}: {
  agent: Agent;
  departments: Department[];
  onClose: () => void;
}) {
  const platforms = getAgentPlatforms(agent.id);
  const tool = getAgentTool(agent.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 font-mono"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[96vh] w-[calc(100vw-1rem)] ${["c7", "c13", "t7", "t13"].includes(agent.id) ? "max-w-[1600px]" : "max-w-lg"} flex-col gap-3 overflow-hidden border-2 border-zinc-700 bg-zinc-950 p-2 sm:p-4`}
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

        {tool === "approvals" && <ApprovalInbox />}
        {tool === "tasks" && <TaskConsole departments={departments} />}
        {tool === "policy" && <PolicyPanel />}
        {tool === "storage" && <SharedStoragePanel />}
        {tool === "sourcingWorker" && <SourcingWorkerPanel />}
        {tool === "sourcingManagement" && <SourcingManagementPanel />}
        {tool === "coinTrading" && <TradingRolePanel kind="coin" agent={agent} />}
        {agent.id === "c8" && <UpbitReportDashboard />}
        {tool === "stockTrading" && <TradingRolePanel kind="stock" agent={agent} />}
        {tool === "assetManagement" && <AssetManagementPanel asset={agent.id.startsWith("c") ? "coin" : "stock"} />}
        {tool === "profitRealization" && <ProfitRealizationPanel asset={agent.id.startsWith("c") ? "coin" : "stock"} />}
        {tool === "liveTrading" && <LiveTradingPanel asset={agent.id.startsWith("c") ? "coin" : "stock"} />}
        {platforms.length > 0 && <IntegrationPanel platforms={platforms} />}
        {tool === null && platforms.length === 0 && (
          <p className="text-[11px] text-zinc-600">
            이 직원은 아직 실제 연동이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
