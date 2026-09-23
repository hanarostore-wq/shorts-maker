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
  | "coinTrading";

export const AGENT_TOOLS: Record<string, AgentTool> = {
  o5: "storage",
  s1: "sourcingWorker",
  s11: "sourcingManagement",
  s7: "approvals",
  s8: "tasks",
  s9: "policy",
  c1: "coinTrading",
  c2: "coinTrading",
  c3: "coinTrading",
  c4: "coinTrading",
  c5: "coinTrading",
  c6: "coinTrading",
  c7: "coinTrading",
  c8: "coinTrading",
  c9: "coinTrading",
  c10: "coinTrading",
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
