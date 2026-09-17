import { ProxyAgent } from "undici";

// 쿠팡/네이버는 IP 화이트리스트를 요구하는데, Vercel 서버는 요청마다
// 나가는 IP가 바뀐다. 고정 IP 프록시(FIXED_IP_PROXY_URL)가 설정돼 있으면
// 모든 외부 요청이 그 프록시를 거치도록 강제해서 항상 같은 IP로 나가게 한다.
export async function fetchViaFixedIp(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const proxyUrl = process.env.FIXED_IP_PROXY_URL;
  if (!proxyUrl) {
    return fetch(input, init);
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  // @ts-expect-error - Next.js의 fetch(undici 기반)는 dispatcher 옵션을 지원하지만
  // 표준 RequestInit 타입에는 아직 없다.
  return fetch(input, { ...init, dispatcher });
}

export function isFixedIpProxyConfigured(): boolean {
  return Boolean(process.env.FIXED_IP_PROXY_URL);
}
