import { createHash } from "node:crypto";
import { getSharedRedis } from "@/lib/store";

export type BlogArticleStatus = "ready" | "queued" | "publishing" | "published" | "failed" | "needs_human" | "cleanup_pending";

export interface BlogArticle {
  id: string;
  blogId: string;
  platform: "naver";
  title: string;
  body: string;
  category?: string | null;
  tags?: string[];
  images?: string[];
  status: BlogArticleStatus;
  selected: boolean;
  autoPublishEligible: boolean;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string | null;
  publishedUrl?: string | null;
  publishedAt?: string | null;
  error?: string | null;
}

export interface BlogPublishResult {
  articleId: string;
  blogId: string;
  topicId?: string | null;
  contentHash: string;
  publishedUrl: string;
  publishedAt: string;
  publishAttemptId: string;
  verified: boolean;
  cleanup: "deleted" | "pending";
  error?: string | null;
}

export interface BlogSchedule {
  blogId: string;
  timezone: string;
  slots: string[];
  updatedAt: string;
}

const ARTICLES_KEY = "moneyos:blog:naver:articles";
const RESULTS_KEY = "moneyos:blog:naver:publish-results";
const SCHEDULES_KEY = "moneyos:blog:naver:schedules";
let memoryArticles: BlogArticle[] | null = null;
let memoryResults: BlogPublishResult[] | null = null;
let memorySchedules: BlogSchedule[] | null = null;

function now() { return new Date().toISOString(); }
function hashContent(title: string, body: string) {
  return createHash("sha256").update(`${title}\n${body}`).digest("hex");
}
function getBlogId(input?: string | null) { return String(input || "b_naver_main"); }

async function readArticles(): Promise<BlogArticle[]> {
  const redis = getSharedRedis();
  if (!redis) return memoryArticles ?? (memoryArticles = []);
  return (await redis.get<BlogArticle[]>(ARTICLES_KEY)) ?? [];
}
async function writeArticles(items: BlogArticle[]) {
  const redis = getSharedRedis();
  if (!redis) { memoryArticles = items; return; }
  await redis.set(ARTICLES_KEY, items);
}
async function readResults(): Promise<BlogPublishResult[]> {
  const redis = getSharedRedis();
  if (!redis) return memoryResults ?? (memoryResults = []);
  return (await redis.get<BlogPublishResult[]>(RESULTS_KEY)) ?? [];
}
async function writeResults(items: BlogPublishResult[]) {
  const redis = getSharedRedis();
  if (!redis) { memoryResults = items; return; }
  await redis.set(RESULTS_KEY, items.slice(0, 500));
}
async function readSchedules(): Promise<BlogSchedule[]> {
  const redis = getSharedRedis();
  if (!redis) return memorySchedules ?? (memorySchedules = []);
  return (await redis.get<BlogSchedule[]>(SCHEDULES_KEY)) ?? [];
}
async function writeSchedules(items: BlogSchedule[]) {
  const redis = getSharedRedis();
  if (!redis) { memorySchedules = items; return; }
  await redis.set(SCHEDULES_KEY, items);
}

export async function listBlogArticles() { return readArticles(); }
export async function listBlogPublishResults() { return readResults(); }
export async function listBlogSchedules() { return readSchedules(); }

export async function getBlogDashboard() {
  const [articles, results, schedules] = await Promise.all([readArticles(), readResults(), readSchedules()]);
  const byBlog: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const article of articles) {
    byBlog[article.blogId] = (byBlog[article.blogId] || 0) + 1;
    byStatus[article.status] = (byStatus[article.status] || 0) + 1;
  }
  return {
    articles,
    counts: {
      total: articles.length,
      ready: articles.filter((a) => a.status === "ready").length,
      selectedReady: articles.filter((a) => a.status === "ready" && a.selected).length,
      todayPublished: results.filter((r) => r.publishedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      failed: articles.filter((a) => a.status === "failed").length,
      byBlog,
      byStatus,
    },
    schedules,
  };
}

export async function upsertBlogArticle(input: Pick<BlogArticle, "title" | "body"> & Partial<Pick<BlogArticle, "id" | "blogId" | "category" | "tags" | "images" | "selected" | "autoPublishEligible">>) {
  const items = await readArticles();
  const createdAt = now();
  const id = input.id || `NAVER-${Date.now()}`;
  const idx = items.findIndex((x) => x.id === id);
  const article: BlogArticle = idx >= 0
    ? { ...items[idx], title: input.title, body: input.body, blogId: getBlogId(input.blogId || items[idx].blogId), category: input.category ?? items[idx].category ?? null, tags: input.tags ?? items[idx].tags ?? [], images: input.images ?? items[idx].images ?? [], selected: input.selected ?? items[idx].selected, autoPublishEligible: input.autoPublishEligible ?? items[idx].autoPublishEligible, contentHash: hashContent(input.title, input.body), status: "ready", scheduledFor: null, updatedAt: createdAt, error: null }
    : { id, blogId: getBlogId(input.blogId), platform: "naver", title: input.title, body: input.body, category: input.category ?? null, tags: input.tags ?? [], images: input.images ?? [], status: "ready", selected: input.selected ?? false, autoPublishEligible: input.autoPublishEligible ?? false, contentHash: hashContent(input.title, input.body), createdAt, updatedAt: createdAt, scheduledFor: null, publishedUrl: null, publishedAt: null, error: null };
  if (idx >= 0) items[idx] = article; else items.unshift(article);
  await writeArticles(items);
  return article;
}

export async function patchBlogArticle(id: string, patch: Partial<BlogArticle>) {
  const items = await readArticles();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch, id, updatedAt: now() };
  await writeArticles(items);
  return items[idx];
}

export async function setBlogSelection(id: string, selected: boolean) {
  return patchBlogArticle(id, { selected });
}

export async function saveBlogSchedule(blogId: string, slots: string[], timezone = "Asia/Seoul") {
  const schedules = await readSchedules();
  const next: BlogSchedule = { blogId: getBlogId(blogId), timezone, slots: [...new Set(slots.filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)))].sort(), updatedAt: now() };
  const index = schedules.findIndex((x) => x.blogId === next.blogId);
  if (index >= 0) schedules[index] = next; else schedules.push(next);
  await writeSchedules(schedules);
  return next;
}

export async function claimDueBlogSlots(at = new Date()) {
  const [articles, schedules] = await Promise.all([readArticles(), readSchedules()]);
  const claimed: BlogArticle[] = [];
  for (const schedule of schedules) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone || "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "00";
    const currentMinute = `${getPart("hour")}:${getPart("minute")}`;
    const day = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
    if (!schedule.slots.includes(currentMinute)) continue;
    const slotKey = `${day}T${currentMinute}`;
    const already = articles.some((a) => a.blogId === schedule.blogId && a.scheduledFor === slotKey && ["queued", "publishing", "published"].includes(a.status));
    if (already) continue;
    const article = articles.find((a) => a.blogId === schedule.blogId && a.status === "ready" && (a.selected || a.autoPublishEligible));
    if (!article) continue;
    article.status = "queued";
    article.scheduledFor = slotKey;
    article.updatedAt = now();
    claimed.push(article);
  }
  if (claimed.length) await writeArticles(articles);
  return claimed;
}

export async function confirmPublishAndCleanup(input: { articleId: string; blogId?: string; publishedUrl: string; publishAttemptId: string; verified: boolean; publishedAt?: string; error?: string | null }) {
  const items = await readArticles();
  const article = items.find((x) => x.id === input.articleId);
  if (!article) return { article: null, cleanup: "already_deleted" as const };
  const publishedAt = input.publishedAt || now();
  const result: BlogPublishResult = { articleId: article.id, blogId: article.blogId, contentHash: article.contentHash, publishedUrl: input.publishedUrl, publishedAt, publishAttemptId: input.publishAttemptId, verified: input.verified, cleanup: input.verified ? "deleted" : "pending", error: input.error || null };
  const results = await readResults();
  results.unshift(result);
  await writeResults(results);
  if (!input.verified) {
    const updated = await patchBlogArticle(article.id, { status: "cleanup_pending", publishedUrl: input.publishedUrl, publishedAt, error: input.error || "공개 URL 검증이 끝나지 않아 원문을 보존합니다." });
    return { article: updated, cleanup: "pending" as const };
  }
  const remaining = items.filter((x) => x.id !== article.id);
  await writeArticles(remaining);
  return { article: null, cleanup: "deleted" as const };
}

export async function markPublishFailure(id: string, status: BlogArticleStatus, error: string, publishedUrl?: string | null) {
  return patchBlogArticle(id, { status, error, publishedUrl: publishedUrl || null });
}

export function isBlogStorageConfigured() { return getSharedRedis() !== null; }
