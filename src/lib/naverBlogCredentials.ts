import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSharedRedis } from "./store";

export const NAVER_BLOG_CREDENTIAL_KEY = "moneyos:credentials:naver-blog:v1";
type NaverBlogCredentials = { clientId: string; clientSecret: string };

function encryptionKey() {
  const seed = process.env.NAVER_BLOG_CREDENTIALS_ENCRYPTION_KEY ?? process.env.COIN_CREDENTIALS_ENCRYPTION_KEY ?? process.env.CRON_SECRET;
  if (!seed) throw new Error("NAVER_CREDENTIALS_ENCRYPTION_KEY_MISSING: 서버 암호화 키 환경변수가 없습니다");
  return createHash("sha256").update(seed).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decrypt(value: string) {
  const [ivText, tagText, dataText] = value.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("NAVER_CREDENTIALS_FORMAT_ERROR: 암호화 데이터 형식이 올바르지 않습니다");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function saveNaverBlogCredentials(credentials: NaverBlogCredentials) {
  if (!credentials.clientId.trim() || !credentials.clientSecret.trim()) throw new Error("NAVER_CREDENTIALS_REQUIRED: Client ID와 Client Secret을 모두 입력하세요");
  const redis = getSharedRedis();
  if (!redis) throw new Error("NAVER_REDIS_MISSING: 공유 Redis가 연결되지 않았습니다");
  await redis.set(NAVER_BLOG_CREDENTIAL_KEY, encrypt(JSON.stringify({ clientId: credentials.clientId.trim(), clientSecret: credentials.clientSecret.trim() })));
}

export async function loadNaverBlogCredentials(): Promise<NaverBlogCredentials | null> {
  const redis = getSharedRedis();
  if (!redis) return null;
  const value = await redis.get<string>(NAVER_BLOG_CREDENTIAL_KEY);
  return value ? JSON.parse(decrypt(value)) as NaverBlogCredentials : null;
}

export async function hasNaverBlogCredentials() {
  const redis = getSharedRedis();
  return Boolean(redis && await redis.exists(NAVER_BLOG_CREDENTIAL_KEY));
}
