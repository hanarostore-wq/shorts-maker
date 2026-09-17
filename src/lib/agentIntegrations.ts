export type Platform = "naver" | "coupang" | "vercel";

export const AGENT_PLATFORMS: Record<string, Platform[]> = {
  s1: ["naver"],
  s3: ["coupang"],
  s6: ["naver", "coupang"],
  o4: ["vercel"],
};

export function getAgentPlatforms(agentId: string): Platform[] {
  return AGENT_PLATFORMS[agentId] ?? [];
}
