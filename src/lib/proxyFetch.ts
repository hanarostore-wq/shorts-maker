import { fetch as undiciFetch, ProxyAgent } from "undici";

// 쿠팡/네이버는 IP 화이트리스트를 요구하는데, Vercel 서버는 요청마다
// 나가는 IP가 바뀐다. 고정 IP 프록시(FIXED_IP_PROXY_URL)가 설정돼 있으면
// 모든 외부 요청이 그 프록시를 거치도록 강제해서 항상 같은 IP로 나가게 한다.
//
// Next.js의 전역 fetch는 내부적으로 다른 undici 인스턴스를 쓰기 때문에,
// 외부에서 만든 ProxyAgent를 dispatcher로 넘기면 버전이 맞지 않아 깨진다.
// 그래서 프록시가 필요한 경우엔 undici 패키지 자체의 fetch를 그대로 쓴다.
export async function fetchViaFixedIp(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const proxyUrl = process.env.FIXED_IP_PROXY_URL;
  if (!proxyUrl) {
    return fetch(input, init);
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  // undici의 fetch는 표준 fetch와 타입이 100% 같지 않지만 런타임 동작은 호환된다.
  return undiciFetch(input, { ...init, dispatcher } as never) as unknown as Promise<Response>;
}

export function isFixedIpProxyConfigured(): boolean {
  return Boolean(process.env.FIXED_IP_PROXY_URL);
}
