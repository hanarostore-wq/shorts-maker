import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getSharedRedis } from "@/lib/store";

export type ThreadStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "needs_review";
export type ThreadPost = {
  id: string;
  text: string;
  accountId: string;
  status: ThreadStatus;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  remoteId: string | null;
  permalink: string | null;
  error: string | null;
};
type ThreadAccount = { id: string; username: string; token: string; updatedAt: string };
const POSTS_KEY = "moneyos:social:threads:posts:v1";
const ACCOUNTS_KEY = "moneyos:social:threads:accounts:v1";
let localPosts: ThreadPost[] = [];
let localAccounts: string | null = null;

function secretKey() {
  const seed = process.env.SOCIAL_ENCRYPTION_KEY || process.env.COIN_CREDENTIALS_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!seed) throw new Error("토큰 암호화 키가 설정되지 않았습니다.");
  return createHash("sha256").update(seed).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("저장된 계정 데이터가 손상됐습니다.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
export async function readThreadAccounts(): Promise<ThreadAccount[]> {
  const redis = getSharedRedis();
  const value = redis ? await redis.get<string>(ACCOUNTS_KEY) : localAccounts;
  return value ? JSON.parse(decrypt(value)) as ThreadAccount[] : [];
}
export async function saveThreadAccount(account: ThreadAccount) {
  const redis = getSharedRedis();
  if (!redis) throw new Error("공유저장소 미연결: 인증정보를 저장할 수 없습니다.");
  const accounts = await readThreadAccounts();
  const index = accounts.findIndex((item) => item.id === account.id);
  if (index === -1) accounts.push(account);
  else accounts[index] = account;
  const encrypted = encrypt(JSON.stringify(accounts));
  await redis.set(ACCOUNTS_KEY, encrypted);
  localAccounts = encrypted;
  return { id: account.id, username: account.username, updatedAt: account.updatedAt };
}
export async function listThreadPosts(): Promise<ThreadPost[]> {
  const redis = getSharedRedis();
  return redis ? (await redis.get<ThreadPost[]>(POSTS_KEY)) ?? [] : localPosts;
}
async function savePosts(posts: ThreadPost[]) {
  const redis = getSharedRedis();
  if (!redis) throw new Error("공유저장소 미연결: 게시물을 저장할 수 없습니다.");
  await redis.set(POSTS_KEY, posts.slice(0, 300));
  localPosts = posts.slice(0, 300);
}
export async function createThreadPost(text: string, accountId: string, scheduledAt: string | null) {
  const accounts = await readThreadAccounts();
  if (!accounts.some((account) => account.id === accountId)) throw new Error("연결된 Threads 계정을 선택하세요.");
  const content = text.trim();
  if (!content || content.length > 500) throw new Error("본문은 1~500자로 입력하세요.");
  const date = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduledAt && (!date || Number.isNaN(date.valueOf()) || date.valueOf() < Date.now() + 60_000)) throw new Error("예약 시각은 최소 1분 뒤로 설정하세요.");
  const time = new Date().toISOString();
  const post: ThreadPost = { id: randomUUID(), text: content, accountId, status: scheduledAt ? "scheduled" : "draft", scheduledAt: date?.toISOString() || null, createdAt: time, updatedAt: time, remoteId: null, permalink: null, error: null };
  await savePosts([post, ...(await listThreadPosts())]);
  return post;
}
export async function changeThreadPost(id: string, patch: Partial<ThreadPost>) {
  const posts = await listThreadPosts();
  const index = posts.findIndex((item) => item.id === id);
  if (index < 0) return null;
  posts[index] = { ...posts[index], ...patch, id, updatedAt: new Date().toISOString() };
  await savePosts(posts);
  return posts[index];
}
export async function claimThreadPost(id: string, allowDraft = false) {
  const redis = getSharedRedis();
  if (!redis) throw new Error("공유저장소 미연결: 발행할 수 없습니다.");
  const lock = await redis.set(`moneyos:social:threads:publish:${id}`, "1", { nx: true, ex: 300 });
  if (lock !== "OK") throw new Error("이미 발행 처리 중입니다. 중복 발행하지 않습니다.");
  const posts = await listThreadPosts();
  const post = posts.find((item) => item.id === id);
  if (!post || !["scheduled", ...(allowDraft ? ["draft", "failed"] : [])].includes(post.status)) {
    await redis.del(`moneyos:social:threads:publish:${id}`);
    throw new Error("발행 가능한 원고가 아닙니다.");
  }
  if (!allowDraft && (!post.scheduledAt || Date.parse(post.scheduledAt) > Date.now())) {
    await redis.del(`moneyos:social:threads:publish:${id}`);
    throw new Error("아직 예약 시각이 아닙니다.");
  }
  await changeThreadPost(id, { status: "publishing", error: null });
  return post;
}
export async function releaseThreadPublishLock(id: string) {
  await getSharedRedis()?.del(`moneyos:social:threads:publish:${id}`);
}
export async function getThreadDashboard() {
  const [accounts, posts] = await Promise.all([readThreadAccounts(), listThreadPosts()]);
  const workerHeartbeat = await getSharedRedis()?.get<string>("moneyos:social:desktop-heartbeat");
  return { accounts: accounts.map(({ id, username, updatedAt }) => ({ id, username, updatedAt })), posts, workerOnline: Boolean(workerHeartbeat) };
}
