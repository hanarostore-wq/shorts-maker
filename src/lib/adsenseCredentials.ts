import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSharedRedis } from "./store";

const TOKEN_KEY = "moneyos:credentials:adsense:v1";
const STATE_KEY = "moneyos:oauth:adsense:state:v1";
type AdsCredentials = { accessToken: string; refreshToken?: string; expiryDate?: number; scope?: string };
let memoryToken: string | null = null;
let memoryState: string | null = null;

function encryptionKey() {
  const seed = process.env.ADSENSE_CREDENTIALS_ENCRYPTION_KEY ?? process.env.NAVER_BLOG_CREDENTIALS_ENCRYPTION_KEY ?? process.env.CRON_SECRET;
  if (!seed) throw new Error("ADSENSE_CREDENTIALS_ENCRYPTION_KEY_MISSING: 서버 암호화 키 환경변수가 없습니다");
  return createHash("sha256").update(seed).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decrypt(value: string) {
  const [ivText, tagText, dataText] = value.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("ADSENSE_CREDENTIALS_FORMAT_ERROR: 암호화 데이터 형식이 올바르지 않습니다");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function saveAdsenseCredentials(credentials: AdsCredentials) {
  const value = encrypt(JSON.stringify(credentials)); const redis = getSharedRedis();
  if (!redis) { memoryToken = value; return; }
  await redis.set(TOKEN_KEY, value);
}
export async function loadAdsenseCredentials(): Promise<AdsCredentials | null> {
  const redis = getSharedRedis(); const value = redis ? await redis.get<string>(TOKEN_KEY) : memoryToken;
  return value ? JSON.parse(decrypt(value)) as AdsCredentials : null;
}
export async function hasAdsenseCredentials() {
  const redis = getSharedRedis(); return Boolean(redis ? await redis.exists(TOKEN_KEY) : memoryToken);
}
export async function saveAdsenseOAuthState(state: string) {
  const value = `${state}:${Date.now()}`; const redis = getSharedRedis();
  if (!redis) { memoryState = value; return; }
  await redis.set(STATE_KEY, value);
}
export async function consumeAdsenseOAuthState(state: string) {
  const redis = getSharedRedis(); const value = redis ? await redis.get<string>(STATE_KEY) : memoryState;
  if (redis) await redis.del(STATE_KEY); else memoryState = null;
  if (!value) return false;
  const [saved, created] = value.split(":");
  return saved === state && Date.now() - Number(created) < 10 * 60 * 1000;
}
export async function clearAdsenseCredentials() {
  const redis = getSharedRedis(); if (redis) await redis.del(TOKEN_KEY); else memoryToken = null;
}
export type { AdsCredentials };
