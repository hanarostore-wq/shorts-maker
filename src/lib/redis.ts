import { Redis } from "@upstash/redis";

// Upstash 환경변수가 없으면(로컬 개발 등) null을 돌려주고,
// 호출하는 쪽에서 메모리 대체 동작을 하도록 한다.
export function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}
