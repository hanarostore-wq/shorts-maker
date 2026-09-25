import { getSharedRedis } from "@/lib/store";

export type BlogArticleStatus = "ready" | "queued" | "publishing" | "published" | "failed";

export interface BlogArticle {
  id: string;
  title: string;
  body: string;
  status: BlogArticleStatus;
  createdAt: string;
  updatedAt: string;
  publishedUrl?: string | null;
  error?: string | null;
}

const KEY = "moneyos:blog:naver:articles";
let memory: BlogArticle[] | null = null;

const sample = (): BlogArticle => {
  const now = new Date().toISOString();
  return {
    id: "NAVER-TEST-001",
    title: "운영본부 네이버 블로거 자동발행 테스트",
    body: "운영본부 관제실의 네이버 블로거 자동발행 기능을 확인하기 위한 테스트 글입니다.\n\n이 글은 자동 발행 흐름 검증 후 삭제하거나 비공개로 전환할 수 있습니다.",
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
};

async function read(): Promise<BlogArticle[]> {
  const redis = getSharedRedis();
  if (!redis) {
    if (!memory) memory = [sample()];
    return memory;
  }
  const stored = await redis.get<BlogArticle[]>(KEY);
  if (stored?.length) return stored;
  const initial = [sample()];
  await redis.set(KEY, initial);
  return initial;
}

async function write(items: BlogArticle[]) {
  const redis = getSharedRedis();
  if (!redis) { memory = items; return; }
  await redis.set(KEY, items);
}

export async function listBlogArticles() { return read(); }

export async function upsertBlogArticle(input: Pick<BlogArticle,"title"|"body"> & { id?: string }) {
  const items = await read();
  const now = new Date().toISOString();
  const id = input.id || `NAVER-${Date.now()}`;
  const idx = items.findIndex((x) => x.id === id);
  const article: BlogArticle = idx >= 0
    ? { ...items[idx], title: input.title, body: input.body, status: "ready", updatedAt: now, error: null }
    : { id, title: input.title, body: input.body, status: "ready", createdAt: now, updatedAt: now };
  if (idx >= 0) items[idx] = article; else items.unshift(article);
  await write(items);
  return article;
}

export async function patchBlogArticle(id: string, patch: Partial<BlogArticle>) {
  const items = await read();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch, id, updatedAt: new Date().toISOString() };
  await write(items);
  return items[idx];
}
