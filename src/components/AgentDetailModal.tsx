"use client";
import {TradingAnalyticsPanel} from "./TradingAnalyticsPanel";
import { NaverBlogPanel } from "./NaverBlogPanel";
import { BlogReadyPanel } from "./BlogReadyPanel";




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
import {TradingEvidencePanel} from "./TradingEvidencePanel";
import { TradingRolePanel } from "./TradingRolePanel";

export function AgentDetailModal({
  agent,
  departments,
  onClose,
  onOpenShortsStudio,
}: {
  agent: Agent;
  departments: Department[];
  onClose: () => void;
  onOpenShortsStudio?: (agentName: string) => void;
}) {
  const platforms = getAgentPlatforms(agent.id);
  const tool = getAgentTool(agent.id);

  return (
    <div
      className="control-room-modal fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-2 py-2"
      onClick={onClose}
    >
      <div
        className={`control-room-modal-card control-room-scroll flex max-h-[96vh] w-[calc(100vw-1rem)] ${["c7", "c13", "t7", "t13"].includes(agent.id) ? "max-w-[1600px]" : ["tradingEvidence","tradingAnalytics"].includes(tool||"") ? "max-w-5xl" : "max-w-lg"} flex-col gap-3 overflow-y-auto border border-[var(--control-line-strong)] bg-[var(--control-bg)] p-3 shadow-2xl sm:p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--control-line)] pb-2">
          <span className="text-sm font-bold text-zinc-100">{agent.name}</span>
          <button
            onClick={onClose}
            className="text-xs font-bold text-zinc-500 hover:text-zinc-200"
          >
            ✕ 닫기
          </button>
        </div>
        <p className="text-[11px] leading-6 text-[var(--control-muted)]">{agent.task}</p>

        {tool === "approvals" && <ApprovalInbox />}
        {tool === "tasks" && <TaskConsole departments={departments} />}
        {tool === "policy" && <PolicyPanel />}
        {tool === "storage" && <SharedStoragePanel />}
        {tool === "sourcingWorker" && <SourcingWorkerPanel />}
        {tool === "sourcingManagement" && <SourcingManagementPanel />}
        {tool === "tradingAnalytics" && <TradingAnalyticsPanel asset={agent.id.startsWith("c")?"coin":"stock"} />}
        {tool === "tradingEvidence" && <TradingEvidencePanel asset={agent.id.startsWith("c")?"coin":"stock"} category={agent.id.split("_")[1]} />}
        {tool === "coinTrading" && <TradingRolePanel kind="coin" agent={agent} />}
        {agent.id === "c8" && <UpbitReportDashboard />}
        {tool === "stockTrading" && <TradingRolePanel kind="stock" agent={agent} />}
        {tool === "assetManagement" && <AssetManagementPanel asset={agent.id.startsWith("c") ? "coin" : "stock"} />}
        {tool === "profitRealization" && <ProfitRealizationPanel asset={agent.id.startsWith("c") ? "coin" : "stock"} />}
        {tool === "liveTrading" && <LiveTradingPanel asset={agent.id.startsWith("c") ? "coin" : "stock"} />}
        {tool === "blogReady" && <BlogReadyPanel />}
        {tool === "naverBlog" && <NaverBlogPanel />}
        {tool === "shortsStudio" && (
          <div className="flex flex-col gap-3 rounded border border-indigo-800/60 bg-indigo-950/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-300">
                🎬 남다른AI Shorts 분석기 스튜디오
              </span>
              <span className="rounded bg-indigo-900/50 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
                쇼츠부서 팩토리
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              유튜브 바이럴 알고리즘 분석, 11대 성공 메커니즘, 6대 아이디어 도출, 1문장 대본 및 미드저니/Suno 프롬프트를 통합 제작합니다.
            </p>
            <div className="flex gap-2 pt-2">
              {onOpenShortsStudio && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenShortsStudio(agent.name);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 cursor-pointer"
                >
                  🚀 분석기 모달 전체화면 실행
                </button>
              )}
              <a
                href="/shorts/index.html"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                ↗ 새 탭
              </a>
            </div>
          </div>
        )}
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
