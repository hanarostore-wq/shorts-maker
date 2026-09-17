const BASE_URL = "https://api.vercel.com";

interface VercelDeployment {
  uid: string;
  name: string;
  state: string; // BUILDING | READY | ERROR | QUEUED | CANCELED
  target: string | null;
  createdAt: number;
}

function getCredentials() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    throw new Error("VERCEL_TOKEN / VERCEL_PROJECT_ID 환경변수가 설정되지 않았습니다.");
  }
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID };
}

export async function fetchLatestDeployment(): Promise<VercelDeployment> {
  const { token, projectId, teamId } = getCredentials();
  const params = new URLSearchParams({ projectId, limit: "1" });
  if (teamId) params.set("teamId", teamId);

  const res = await fetch(`${BASE_URL}/v6/deployments?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel 배포 조회 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  const deployment = data.deployments?.[0];
  if (!deployment) {
    throw new Error("배포 기록이 없습니다.");
  }
  return deployment;
}

export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
}

export function describeState(state: string): string {
  switch (state) {
    case "BUILDING":
      return "빌드 중";
    case "QUEUED":
      return "대기열";
    case "READY":
      return "배포 완료";
    case "ERROR":
      return "빌드 실패";
    case "CANCELED":
      return "취소됨";
    default:
      return state;
  }
}
