export type Platform = "naver" | "coupang" | "vercel";

export const AGENT_PLATFORMS: Record<string, Platform[]> = {
  s6: ["naver", "coupang"],
  o4: ["vercel"],
};

// 연동 상태 조회 버튼은 없지만, 클릭했을 때 별도 보고서(예: 소싱된 상품 목록)를
// 보여줄 직원들.
export const AGENT_REPORTS: Record<string, "sourcing"> = {
  s1: "sourcing",
};

export type AgentTool = "approvals" | "tasks" | "policy" | "storage";

export const AGENT_TOOLS: Record<string, AgentTool> = {
  o5: "storage",
  s7: "approvals",
  s8: "tasks",
  s9: "policy",
};

export function getAgentPlatforms(agentId: string): Platform[] {
  return AGENT_PLATFORMS[agentId] ?? [];
}

export function getAgentReport(agentId: string): "sourcing" | null {
  return AGENT_REPORTS[agentId] ?? null;
}

export function getAgentTool(agentId: string): AgentTool | null {
  return AGENT_TOOLS[agentId] ?? null;
}

export function isAgentClickable(agentId: string): boolean {
  return (
    getAgentPlatforms(agentId).length > 0 ||
    getAgentReport(agentId) !== null ||
    getAgentTool(agentId) !== null
  );
}
