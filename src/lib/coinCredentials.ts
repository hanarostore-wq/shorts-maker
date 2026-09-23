import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSharedRedis } from "./store";

const KEY_NAME = "moneyos:credentials:upbit:v1";

type UpbitCredentials = { accessKey: string; secretKey: string };

function encryptionKey() {
  const seed = process.env.COIN_CREDENTIALS_ENCRYPTION_KEY ?? process.env.CRON_SECRET;
  if (!seed) throw new Error("업비트 키 저장 오류: COIN_CREDENTIALS_ENCRYPTION_KEY 환경변수가 없습니다");
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
  if (!ivText || !tagText || !dataText) throw new Error("업비트 키 저장 오류: 암호화 데이터 형식이 올바르지 않습니다");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function saveUpbitCredentials(credentials: UpbitCredentials) {
  const redis = getSharedRedis();
  if (!redis) throw new Error("업비트 키 저장 오류: 공유 Redis가 연결되지 않았습니다");
  await redis.set(KEY_NAME, encrypt(JSON.stringify(credentials)));
}

export async function loadUpbitCredentials(): Promise<UpbitCredentials | null> {
  const redis = getSharedRedis();
  if (!redis) return null;
  const value = await redis.get<string>(KEY_NAME);
  return value ? JSON.parse(decrypt(value)) as UpbitCredentials : null;
}

export async function hasUpbitCredentials() {
  const redis = getSharedRedis();
  return Boolean(redis && await redis.exists(KEY_NAME));
}
