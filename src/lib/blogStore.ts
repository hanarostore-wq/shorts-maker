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


export type BlogResearchStatus = "candidate" | "approved" | "used" | "rejected";

export interface BlogResearchItem {
  id: string;
  topicId: string;
  blogId: string;
  keyword: string;
  mainKeyword: string;
  keywordCluster: string[];
  masterTopic: string;
  searchIntent: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  notes?: string | null;
  demandScore: number;
  gapScore: number;
  fitScore: number;
  freshnessScore: number;
  trendScore: number;
  supplyScore: number;
  contentGapScore: number;
  opportunityScore: number;
  selectionReason: string;
  status: BlogResearchStatus;
  createdAt: string;
  updatedAt: string;
}

const RESEARCH_KEY = "moneyos:blog:research-items";
let memoryResearch: BlogResearchItem[] | null = null;

async function readResearch(): Promise<BlogResearchItem[]> {
  const redis = getSharedRedis();
  if (!redis) return memoryResearch ?? (memoryResearch = []);
  return (await redis.get<BlogResearchItem[]>(RESEARCH_KEY)) ?? [];
}
async function writeResearch(items: BlogResearchItem[]) {
  const redis = getSharedRedis();
  if (!redis) { memoryResearch = items; return; }
  await redis.set(RESEARCH_KEY, items.slice(0, 500));
}
function scorePart(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}
function opportunityScore(scores: Pick<BlogResearchItem, "demandScore" | "gapScore" | "fitScore" | "freshnessScore">) {
  return Math.round(scores.demandScore * 0.3 + scores.gapScore * 0.25 + scores.fitScore * 0.25 + scores.freshnessScore * 0.2);
}

export async function listBlogResearch() { return readResearch(); }

export async function upsertBlogResearch(input: Partial<BlogResearchItem> & Pick<BlogResearchItem, "keyword" | "masterTopic">) {
  const items = await readResearch();
  const id = input.id || `RESEARCH-${Date.now()}`;
  const existing = items.find((item) => item.id === id);
  const scores = {
    demandScore: scorePart(input.demandScore ?? existing?.demandScore),
    gapScore: scorePart(input.gapScore ?? existing?.gapScore),
    fitScore: scorePart(input.fitScore ?? existing?.fitScore),
    freshnessScore: scorePart(input.freshnessScore ?? existing?.freshnessScore),
  };
  const timestamp = now();
  const item: BlogResearchItem = {
    id,
    topicId: id,
    blogId: getBlogId(input.blogId || existing?.blogId),
    keyword: input.keyword.trim(),
    mainKeyword: input.mainKeyword ?? input.keyword.trim(),
    keywordCluster: input.keywordCluster ?? existing?.keywordCluster ?? [input.keyword.trim()],
    masterTopic: input.masterTopic.trim(),
    searchIntent: input.searchIntent ?? existing?.searchIntent ?? "정보 탐색",
    sourceUrl: input.sourceUrl ?? existing?.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? existing?.sourceTitle ?? null,
    notes: input.notes ?? existing?.notes ?? null,
    ...scores,
    trendScore: scorePart(input.trendScore ?? existing?.trendScore ?? input.freshnessScore),
    supplyScore: scorePart(input.supplyScore ?? existing?.supplyScore),
    contentGapScore: scorePart(input.contentGapScore ?? existing?.contentGapScore ?? input.gapScore),
    opportunityScore: opportunityScore(scores),
    selectionReason: input.selectionReason ?? existing?.selectionReason ?? "수동 등록 후보",
    status: input.status ?? existing?.status ?? "candidate",
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const index = items.findIndex((candidate) => candidate.id === id);
  if (index >= 0) items[index] = item; else items.unshift(item);
  await writeResearch(items);
  return item;
}

export async function patchBlogResearch(id: string, patch: Partial<Pick<BlogResearchItem, "status" | "notes" | "masterTopic" | "sourceUrl" | "sourceTitle">>) {
  const items = await readResearch();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch, updatedAt: now() };
  await writeResearch(items);
  return items[index];
}

export async function selectTopBlogResearch(limit = 100) {
  const items = await readResearch();
  const eligible = items.filter((item) => item.status === "candidate" || item.status === "approved").sort((a, b) => b.opportunityScore - a.opportunityScore);
  const selected = new Set(eligible.slice(0, Math.max(0, Math.min(100, limit))).map((item) => item.id));
  for (const item of items) {
    if (item.status === "candidate" || item.status === "approved") {
      item.status = selected.has(item.id) ? "approved" : "candidate";
      item.updatedAt = now();
    }
  }
  await writeResearch(items);
  return items.filter((item) => selected.has(item.id));
}

export async function getBlogResearchDashboard() {
  const items = await readResearch();
  return {
    items: [...items].sort((a, b) => b.opportunityScore - a.opportunityScore || b.updatedAt.localeCompare(a.updatedAt)),
    counts: {
      total: items.length,
      candidate: items.filter((item) => item.status === "candidate").length,
      approved: items.filter((item) => item.status === "approved").length,
      used: items.filter((item) => item.status === "used").length,
      rejected: items.filter((item) => item.status === "rejected").length,
    },
  };
}
