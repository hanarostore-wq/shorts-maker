import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { getSharedRedis } from "./store";

const KEY_NAME = "moneyos:credentials:namuh-plug:v1";
type StockCredentials = { appKey: string; appSecret: string };

function encryptionKey() {
  const seed = process.env.STOCK_CREDENTIALS_ENCRYPTION_KEY ?? process.env.COIN_CREDENTIALS_ENCRYPTION_KEY ?? process.env.CRON_SECRET;
  if (!seed) throw new Error("NAMUH_ENCRYPTION_KEY_MISSING: STOCK_CREDENTIALS_ENCRYPTION_KEY 또는 COIN_CREDENTIALS_ENCRYPTION_KEY 환경변수가 없습니다");
  return createHash("sha256").update(seed).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export async function saveStockCredentials(credentials: StockCredentials) {
  if (!credentials.appKey.trim() || !credentials.appSecret.trim()) throw new Error("NAMUH_CREDENTIALS_REQUIRED: App Key와 App Secret을 모두 입력하세요");
  const redis = getSharedRedis();
  if (!redis) throw new Error("NAMUH_REDIS_MISSING: 공유 Redis가 연결되지 않았습니다");
  await redis.set(KEY_NAME, encrypt(JSON.stringify(credentials)));
}

export async function hasStockCredentials() {
  const redis = getSharedRedis();
  return Boolean(redis && await redis.exists(KEY_NAME));
}

export async function getStockCredentialStatus() {
  return { configured: await hasStockCredentials(), keyName: KEY_NAME };
}

export type { StockCredentials };
export { KEY_NAME };
