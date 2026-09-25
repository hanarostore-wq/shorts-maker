import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { loadNaverBlogCredentials } from "@/lib/naverBlogCredentials";
import { enqueueTask } from "@/lib/agent/store";
import {
  getBlogResearchDashboard,
  listBlogResearch,
  patchBlogResearch,
  selectTopBlogResearch,
  upsertBlogResearch,
} from "@/lib/blogStore";

const DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";
const SEARCH_URL = "https://openapi.naver.com/v1/search/blog.json";
const MAX_KEYWORDS = 200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanKeyword(value: unknown) { return String(value || "").trim().replace(/\s+/g, " "); }
function topicId(blogId: string, keyword: string) { return `TOPIC-${createHash("sha256").update(`${blogId}:${keyword.toLowerCase()}`).digest("hex").slice(0, 16)}`; }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function dateString(daysAgo: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() - daysAgo); return date.toISOString().slice(0, 10); }

async function fetchDataLab(credentials: { clientId: string; clientSecret: string }, keywords: string[]) {
  const response = await fetch(DATALAB_URL, { method: "POST", headers: { "X-Naver-Client-Id": credentials.clientId, "X-Naver-Client-Secret": credentials.clientSecret, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: dateString(90), endDate: dateString(0), timeUnit: "date", keywordGroups: keywords.map((keyword) => ({ groupName: keyword, keywords: [keyword] })) }), cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`NAVER_DATALAB_${response.status}: ${body?.errorMessage || "DataLab 요청 실패"}`);
  return Array.isArray(body.results) ? body.results as Array<{ title: string; data: Array<{ period: string; ratio: number }> }> : [];
}

async function fetchSearch(credentials: { clientId: string; clientSecret: string }, keyword: string) {
  const response = await fetch(`${SEARCH_URL}?query=${encodeURIComponent(keyword)}&display=10&sort=date`, { headers: { "X-Naver-Client-Id": credentials.clientId, "X-Naver-Client-Secret": credentials.clientSecret }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`NAVER_SEARCH_${response.status}: ${body?.errorMessage || "Blog Search 요청 실패"}`);
  return { total: Number(body.total || 0), items: Array.isArray(body.items) ? body.items as Array<{ title?: string; link?: string; description?: string; pubDate?: string }> : [] };
}

async function collectCandidates(input: { keywords: string[]; blogId: string; profileKeywords: string[] }) {
  const credentials = await loadNaverBlogCredentials();
  if (!credentials) throw new Error("NAVER_CREDENTIALS_NOT_CONFIGURED: 먼저 Client ID/Secret 연결 테스트·암호화 저장을 실행하세요.");
  const uniqueKeywords = [...new Map(input.keywords.map((value) => [value.toLowerCase().replace(/\s/g, ""), value])).values()].slice(0, MAX_KEYWORDS);
  if (uniqueKeywords.length < 1) throw new Error("NAVER_RESEARCH_KEYWORDS_REQUIRED: 조사할 키워드가 없습니다.");
  const dataLabByKeyword = new Map<string, { demand: number; trend: number }>();
  for (let index = 0; index < uniqueKeywords.length; index += 5) {
    const batch = uniqueKeywords.slice(index, index + 5);
    const results = await fetchDataLab(credentials, batch);
    results.forEach((result) => {
      const rows = result.data || [];
      const values = rows.map((row) => Number(row.ratio || 0));
      const recent = values.slice(-30);
      const previous = values.slice(-60, -30);
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const recentAverage = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : average;
      const previousAverage = previous.length ? previous.reduce((sum, value) => sum + value, 0) / previous.length : average;
      dataLabByKeyword.set(result.title, { demand: average, trend: previousAverage ? clamp((recentAverage / previousAverage) * 50) : 50 });
    });
  }
  const maxDemand = Math.max(1, ...[...dataLabByKeyword.values()].map((value) => value.demand));
  const results: Awaited<ReturnType<typeof upsertBlogResearch>>[] = [];
  const errors: string[] = [];
  for (let index = 0; index < uniqueKeywords.length; index += 5) {
    const batch = uniqueKeywords.slice(index, index + 5);
    const searched = await Promise.all(batch.map(async (keyword) => { try { return { keyword, result: await fetchSearch(credentials, keyword) }; } catch (error) { errors.push(`${keyword}: ${error instanceof Error ? error.message : "Search 실패"}`); return { keyword, result: { total: 0, items: [] } }; } }));
    for (const { keyword, result } of searched) {
      const lab = dataLabByKeyword.get(keyword) || { demand: 0, trend: 50 };
      const demandScore = clamp((lab.demand / maxDemand) * 100);
      const supplyScore = clamp(Math.log10(result.total + 1) / 6 * 100);
      const fitScore = input.profileKeywords.length ? clamp(50 + input.profileKeywords.filter((profileKeyword) => keyword.includes(profileKeyword) || profileKeyword.includes(keyword)).length * 25) : 70;
      const contentGapScore = clamp(demandScore * 0.6 + (100 - supplyScore) * 0.4);
      const item = await upsertBlogResearch({ id: topicId(input.blogId, keyword), blogId: input.blogId, keyword, mainKeyword: keyword, keywordCluster: [keyword], masterTopic: `${keyword} 실전 가이드`, searchIntent: "정보 탐색", sourceUrl: result.items[0]?.link || null, sourceTitle: result.items[0]?.title || null, notes: `DataLab 상대 검색수요 ${demandScore} · 최근 30일 추세 ${lab.trend} · Blog Search 공급량 ${result.total}`, demandScore, gapScore: contentGapScore, fitScore, freshnessScore: lab.trend, trendScore: lab.trend, supplyScore, contentGapScore, selectionReason: `상대 검색수요 ${demandScore}, 콘텐츠 공백 ${contentGapScore}, 블로그 적합도 ${fitScore}`, status: "candidate" });
      results.push(item);
    }
    if (index + 5 < uniqueKeywords.length) await sleep(150);
  }
  return { results, errors, requested: input.keywords.length, unique: uniqueKeywords.length };
}

export async function GET() { return NextResponse.json(await getBlogResearchDashboard(), { headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "upsert");
  if (action === "collect") {
    try { return NextResponse.json({ ok: true, ...(await collectCandidates({ keywords: Array.isArray(body.keywords) ? body.keywords.map(cleanKeyword).filter(Boolean) : [], blogId: String(body.blogId || "b_naver_main"), profileKeywords: Array.isArray(body.profileKeywords) ? body.profileKeywords.map(cleanKeyword).filter(Boolean) : [] })) }); }
    catch (error) { const message = error instanceof Error ? error.message : "소재 수집 실패"; return NextResponse.json({ ok: false, code: message.split(":")[0], error: message }, { status: 502 }); }
  }
  if (action === "select-top-100") return NextResponse.json({ ok: true, selected: await selectTopBlogResearch(100) });
  if (action === "upsert") {
    if (!body.keyword || !body.masterTopic) return NextResponse.json({ error: "keyword/masterTopic은 필수입니다." }, { status: 400 });
    return NextResponse.json({ ok: true, item: await upsertBlogResearch({ id: body.id, blogId: body.blogId, keyword: String(body.keyword), masterTopic: String(body.masterTopic), sourceUrl: body.sourceUrl, sourceTitle: body.sourceTitle, notes: body.notes, demandScore: body.demandScore, gapScore: body.gapScore, fitScore: body.fitScore, freshnessScore: body.freshnessScore, status: body.status }) });
  }
  if (action === "send-to-ready") {
    const item = (await listBlogResearch()).find((candidate) => candidate.id === String(body?.id || ""));
    if (!item) return NextResponse.json({ error: "소재 후보를 찾을 수 없습니다." }, { status: 404 });
    if (item.status !== "approved") return NextResponse.json({ error: "승인된 소재만 READY 브리프로 보낼 수 있습니다." }, { status: 409 });
    const brief = [`[BLOG_RESEARCH_BRIEF]`, `RESEARCH_ID: ${item.id}`, `BLOG_ID: ${item.blogId}`, `MASTER_TOPIC: ${item.masterTopic}`, `KEYWORD: ${item.mainKeyword}`, `KEYWORD_CLUSTER: ${item.keywordCluster.join(", ")}`, `SEARCH_INTENT: ${item.searchIntent}`, `OPPORTUNITY_SCORE: ${item.opportunityScore}`, `SELECTION_REASON: ${item.selectionReason}`, `SOURCE_URL: ${item.sourceUrl || "없음"}`, `NOTES: ${item.notes || "없음"}`, "요청: 이 브리프로 GPT 무료 웹에서 글을 수동 생성한 뒤 READY 관리자에 import하세요. GPT/OpenAI API는 호출하지 않습니다."].join("\n");
    const task = await enqueueTask({ departmentId: "blog", agentId: "b_ready", instruction: brief });
    await patchBlogResearch(item.id, { status: "used" });
    return NextResponse.json({ ok: true, brief, task });
  }
  return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id는 필수입니다." }, { status: 400 });
  const item = (await listBlogResearch()).find((candidate) => candidate.id === id);
  if (!item) return NextResponse.json({ error: "소재 후보를 찾을 수 없습니다." }, { status: 404 });
  if (body.action === "approve" || body.action === "reject") return NextResponse.json({ ok: true, item: await patchBlogResearch(id, { status: body.action === "approve" ? "approved" : "rejected" }) });
  return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
}
