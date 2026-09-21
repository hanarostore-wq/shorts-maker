import crypto from "crypto";
import { getRedis } from "./redis";

// ───────────────────────────────────────────────────────────────────────────
// 유료 확장앱 라이선스
//
// 확장프로그램은 크롬 웹스토어에서 "무료"로 배포하고, 프로 기능만 라이선스 키로
// 열어주는 방식이다. (크롬 웹스토어 자체 결제는 2020년에 없어져서, 유료 확장앱은
// 전부 이 방식으로 판다.)
// ───────────────────────────────────────────────────────────────────────────

export type PaidPlan = "pro" | "lifetime";
export type Plan = "free" | PaidPlan;

export interface PlanFeatures {
  /** 하루에 소싱할 수 있는 상품 수 (null = 무제한) */
  dailyScrapeLimit: number | null;
  /** 목록 페이지 통째로 긁어오기 */
  bulkList: boolean;
  /** CSV 내보내기 */
  csvExport: boolean;
  /** 마진 계산기 */
  marginCalculator: boolean;
  /** 한 키로 쓸 수 있는 기기 수 */
  maxDevices: number;
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: {
    dailyScrapeLimit: 5,
    bulkList: false,
    csvExport: false,
    marginCalculator: true, // 맛보기로 열어둔다 (이게 있어야 유료 가치가 보인다)
    maxDevices: 1,
  },
  pro: {
    dailyScrapeLimit: null,
    bulkList: true,
    csvExport: true,
    marginCalculator: true,
    maxDevices: 2,
  },
  lifetime: {
    dailyScrapeLimit: null,
    bulkList: true,
    csvExport: true,
    marginCalculator: true,
    maxDevices: 3,
  },
};

export interface PlanPrice {
  plan: PaidPlan;
  name: string;
  price: number;
  /** 구독 개월 수 (lifetime은 null) */
  months: number | null;
  description: string;
}

export const PLAN_PRICES: PlanPrice[] = [
  {
    plan: "pro",
    name: "프로 (월 결제)",
    price: 19900,
    months: 1,
    description: "무제한 소싱 · 목록 통째로 수집 · CSV 내보내기 · 기기 2대",
  },
  {
    plan: "lifetime",
    name: "평생 이용권",
    price: 99000,
    months: null,
    description: "프로 기능 전부 + 평생 업데이트 · 기기 3대",
  },
];

export interface LicenseDevice {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LicenseRecord {
  key: string;
  plan: PaidPlan;
  email: string;
  issuedAt: string;
  /** null이면 만료 없음(평생) */
  expiresAt: string | null;
  devices: LicenseDevice[];
  revokedAt: string | null;
  /** 결제 주문번호 (중복 발급 방지에 쓴다) */
  orderId: string | null;
  memo: string;
}

const KEY_PREFIX = "shorts-maker:license:";
const INDEX_KEY = "shorts-maker:licenses";
const ORDER_PREFIX = "shorts-maker:license-order:";

// 헷갈리는 글자(0/O, 1/I)를 뺀 알파벳. 전화로 불러줘도 받아적을 수 있게.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function getSigningSecret(): string {
  const secret = process.env.LICENSE_SIGNING_SECRET;
  if (!secret) {
    throw new Error("LICENSE_SIGNING_SECRET 환경변수가 설정되지 않았습니다.");
  }
  return secret;
}

function randomBlock(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function checksumFor(body: string): string {
  const mac = crypto.createHmac("sha256", getSigningSecret()).update(body).digest();
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

/** SM-PRO-XXXX-XXXX-CCCC (마지막 묶음은 서명 검증용) */
export function generateLicenseKey(plan: PaidPlan): string {
  const planCode = plan === "lifetime" ? "LIF" : "PRO";
  const body = `SM-${planCode}-${randomBlock(4)}-${randomBlock(4)}`;
  return `${body}-${checksumFor(body)}`;
}

export function normalizeLicenseKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s/g, "");
}

/**
 * 저장소를 들여다보기 전에 키 모양과 서명만 먼저 확인한다.
 * 아무렇게나 찍어 넣은 키로 Redis를 두드리는 걸 막기 위함.
 */
export function hasValidChecksum(key: string): boolean {
  const match = normalizeLicenseKey(key).match(
    /^(SM-(?:PRO|LIF)-[A-Z2-9]{4}-[A-Z2-9]{4})-([A-Z2-9]{4})$/,
  );
  if (!match) return false;
  const expected = checksumFor(match[1]);
  // 길이가 같은 값끼리만 비교하므로 timingSafeEqual을 그대로 쓸 수 있다.
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]));
}

function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next;
}

export interface IssueInput {
  plan: PaidPlan;
  email: string;
  /** 구독 개월 수. 생략하면 요금제 기본값 (lifetime은 무시) */
  months?: number;
  orderId?: string | null;
  memo?: string;
}

export async function issueLicense(input: IssueInput): Promise<LicenseRecord> {
  const redis = getRedis();
  if (!redis) throw new Error("라이선스 저장소(Upstash Redis)가 설정되지 않았습니다.");

  // 결제 웹훅이 두 번 들어와도 키가 두 개 나가지 않도록 주문번호로 막는다.
  if (input.orderId) {
    const existingKey = await redis.get<string>(`${ORDER_PREFIX}${input.orderId}`);
    if (existingKey) {
      const existing = await getLicense(existingKey);
      if (existing) return existing;
    }
  }

  const now = new Date();
  const months = input.plan === "lifetime" ? null : (input.months ?? 1);
  const record: LicenseRecord = {
    key: generateLicenseKey(input.plan),
    plan: input.plan,
    email: input.email.trim().toLowerCase(),
    issuedAt: now.toISOString(),
    expiresAt: months === null ? null : addMonths(now, months).toISOString(),
    devices: [],
    revokedAt: null,
    orderId: input.orderId ?? null,
    memo: input.memo ?? "",
  };

  await redis.set(`${KEY_PREFIX}${record.key}`, record);
  await redis.zadd(INDEX_KEY, { score: now.getTime(), member: record.key });
  if (record.orderId) {
    await redis.set(`${ORDER_PREFIX}${record.orderId}`, record.key);
  }
  return record;
}

export async function getLicense(key: string): Promise<LicenseRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get<LicenseRecord>(`${KEY_PREFIX}${normalizeLicenseKey(key)}`);
}

export async function listLicenses(limit = 100): Promise<LicenseRecord[]> {
  const redis = getRedis();
  if (!redis) return [];
  const keys = await redis.zrange<string[]>(INDEX_KEY, 0, limit - 1, { rev: true });
  const records = await Promise.all(keys.map((k) => getLicense(k)));
  return records.filter((r): r is LicenseRecord => r !== null);
}

export async function revokeLicense(key: string): Promise<LicenseRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  const record = await getLicense(key);
  if (!record) return null;
  record.revokedAt = new Date().toISOString();
  await redis.set(`${KEY_PREFIX}${record.key}`, record);
  return record;
}

/** 구독 연장 (재결제 웹훅에서 호출) */
export async function extendLicense(key: string, months: number): Promise<LicenseRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  const record = await getLicense(key);
  if (!record || record.plan === "lifetime") return record;

  // 아직 안 끝난 구독이면 남은 기간 뒤에, 이미 끝났으면 오늘부터 다시 센다.
  const now = new Date();
  const base =
    record.expiresAt && new Date(record.expiresAt) > now ? new Date(record.expiresAt) : now;
  record.expiresAt = addMonths(base, months).toISOString();
  record.revokedAt = null;
  await redis.set(`${KEY_PREFIX}${record.key}`, record);
  return record;
}

export type VerifyFailure =
  | "malformed"
  | "not_found"
  | "revoked"
  | "expired"
  | "device_limit"
  | "storage_unavailable";

export interface VerifyResult {
  valid: boolean;
  plan: Plan;
  features: PlanFeatures;
  expiresAt: string | null;
  email: string | null;
  reason: VerifyFailure | null;
}

function fail(reason: VerifyFailure): VerifyResult {
  return {
    valid: false,
    plan: "free",
    features: PLAN_FEATURES.free,
    expiresAt: null,
    email: null,
    reason,
  };
}

/**
 * 확장앱이 키를 확인할 때 부르는 함수.
 * 기기 id를 같이 받아서 한 키가 여러 대에서 무한정 쓰이는 걸 막는다.
 */
export async function verifyLicense(rawKey: string, deviceId: string): Promise<VerifyResult> {
  const key = normalizeLicenseKey(rawKey);
  if (!hasValidChecksum(key)) return fail("malformed");

  const redis = getRedis();
  if (!redis) return fail("storage_unavailable");

  const record = await getLicense(key);
  if (!record) return fail("not_found");
  if (record.revokedAt) return fail("revoked");
  if (record.expiresAt && new Date(record.expiresAt) <= new Date()) return fail("expired");

  const features = PLAN_FEATURES[record.plan];
  const now = new Date().toISOString();
  const device = record.devices.find((d) => d.id === deviceId);
  if (device) {
    device.lastSeenAt = now;
  } else {
    if (record.devices.length >= features.maxDevices) {
      // 기기를 정리해야 하는 상황이므로 저장은 하지 않고 그대로 거절한다.
      return fail("device_limit");
    }
    record.devices.push({ id: deviceId, firstSeenAt: now, lastSeenAt: now });
  }
  await redis.set(`${KEY_PREFIX}${record.key}`, record);

  return {
    valid: true,
    plan: record.plan,
    features,
    expiresAt: record.expiresAt,
    email: record.email,
    reason: null,
  };
}

/** 기기 등록을 풀어준다 (PC를 바꿨을 때 고객 요청으로 처리) */
export async function releaseDevice(key: string, deviceId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const record = await getLicense(key);
  if (!record) return false;
  const before = record.devices.length;
  record.devices = record.devices.filter((d) => d.id !== deviceId);
  if (record.devices.length === before) return false;
  await redis.set(`${KEY_PREFIX}${record.key}`, record);
  return true;
}

/** 관리자 토큰 확인 (키 발급/조회/회수용) */
export function isAdminAuthorized(request: Request): boolean {
  const expected = process.env.LICENSE_ADMIN_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ───────────────────────────────────────────────────────────────────────────
// 사용량 제한
//
// 확장앱 안에서만 막으면 개발자도구를 열 줄 아는 사람은 그냥 뚫는다.
// 그래서 실제 한도는 서버에서 센다. 단, 라이선스 강제 적용을 켜지 않은
// 동안에는(= 혼자 쓰는 지금) 예전처럼 아무 제한 없이 동작한다.
// ───────────────────────────────────────────────────────────────────────────

export function isEnforcementEnabled(): boolean {
  return process.env.LICENSE_ENFORCED === "true";
}

const USAGE_PREFIX = "shorts-maker:usage:";

function todayInSeoul(): string {
  // ko-KR 대신 sv-SE를 쓰면 YYYY-MM-DD 모양으로 바로 나온다.
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number | null;
}

/**
 * 오늘 사용량을 count만큼 올리고, 한도를 넘었는지 알려준다.
 * limit이 null(무제한)이면 세지도 않는다.
 */
export async function consumeDailyQuota(
  deviceId: string,
  limit: number | null,
  count = 1,
): Promise<QuotaResult> {
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const redis = getRedis();
  // 저장소가 없으면 한도를 셀 방법이 없다. 막기보다는 통과시킨다
  // (유료 기능 자체는 라이선스 검증에서 이미 걸러진다).
  if (!redis) return { allowed: true, used: 0, limit };

  const key = `${USAGE_PREFIX}${deviceId}:${todayInSeoul()}`;
  const used = await redis.incrby(key, count);
  // 날짜가 바뀌면 자동으로 사라지도록 이틀치만 남긴다.
  if (used === count) await redis.expire(key, 60 * 60 * 48);

  return { allowed: used <= limit, used, limit };
}

export interface Entitlement {
  plan: Plan;
  features: PlanFeatures;
  /** 키가 있는데 쓸 수 없는 상태라면 그 이유 */
  reason: VerifyFailure | null;
}

/** 키가 없거나 무효면 무료 등급으로 떨어뜨린다 (요청을 막지는 않는다). */
export async function resolveEntitlement(
  rawKey: string | null | undefined,
  deviceId: string,
): Promise<Entitlement> {
  if (!rawKey) return { plan: "free", features: PLAN_FEATURES.free, reason: null };
  try {
    const result = await verifyLicense(rawKey, deviceId);
    if (!result.valid) {
      return { plan: "free", features: PLAN_FEATURES.free, reason: result.reason };
    }
    return { plan: result.plan, features: result.features, reason: null };
  } catch {
    return { plan: "free", features: PLAN_FEATURES.free, reason: "storage_unavailable" };
  }
}
