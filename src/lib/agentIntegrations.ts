export type Platform = "naver" | "coupang" | "vercel";

export const AGENT_PLATFORMS: Record<string, Platform[]> = {
  s6: ["coupang"],
  s10: ["naver"],
  o4: ["vercel"],
};

export type AgentTool =
  | "approvals"
  | "tasks"
  | "policy"
  | "storage"
  | "sourcingWorker"
  | "sourcingManagement"
  | "tradingEvidence"
  | "tradingAnalytics"
  | "coinTrading"
  | "stockTrading"
  | "assetManagement"
  | "profitRealization"
  | "liveTrading"
  | "shortsStudio"
  | "naverBlog";

export const AGENT_TOOLS: Record<string, AgentTool> = {
  c_analytics: "tradingAnalytics",
  t_analytics: "tradingAnalytics",
  o5: "storage",
  s1: "sourcingWorker",
  s11: "sourcingManagement",
  s7: "approvals",
  s8: "tasks",
  s9: "policy",
  c_selection: "tradingEvidence",
  t_selection: "tradingEvidence",
  c_entry: "tradingEvidence",
  t_entry: "tradingEvidence",
  c_exit: "tradingEvidence",
  t_exit: "tradingEvidence",
  c_trend: "tradingEvidence",
  t_trend: "tradingEvidence",
  c_flow: "tradingEvidence",
  t_flow: "tradingEvidence",
  c_liquidity: "tradingEvidence",
  t_liquidity: "tradingEvidence",
  c_sizing: "tradingEvidence",
  t_sizing: "tradingEvidence",
  c_risk: "tradingEvidence",
  t_risk: "tradingEvidence",
  c4: "coinTrading",
  c7: "coinTrading",
  c8: "coinTrading",
  t4: "stockTrading",
  t7: "stockTrading",
  t8: "stockTrading",
  c11: "assetManagement",
  c12: "profitRealization",
  c13: "liveTrading",
  t11: "assetManagement",
  t12: "profitRealization",
  t13: "liveTrading",
  v1: "shortsStudio",
  v2: "shortsStudio",
  v3: "shortsStudio",
  v4: "shortsStudio",
  v5: "shortsStudio",
  v6: "shortsStudio",
  b_naver: "naverBlog",
};

export const SHORTS_AGENT_STEP_MAP: Record<string, string> = {
  v5: "search",
  v2: "analyze",
  v4: "ideate",
  v6: "select",
  v1: "script",
  v3: "prompts",
};

export function getAgentPlatforms(agentId: string): Platform[] {
  return AGENT_PLATFORMS[agentId] ?? [];
}

export function getAgentTool(agentId: string): AgentTool | null {
  return AGENT_TOOLS[agentId] ?? null;
}

export function isAgentClickable(agentId: string): boolean {
  return (
    getAgentPlatforms(agentId).length > 0 ||
    getAgentTool(agentId) !== null
  );
}
