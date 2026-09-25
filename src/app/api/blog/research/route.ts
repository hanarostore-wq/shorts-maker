import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { loadNaverBlogCredentials } from "@/lib/naverBlogCredentials";
import {
  getBlogResearchDashboard,
  listBlogResearch,
  patchBlogResearch,
  selectTopBlogResearch,
  upsertBlogResearch,
} from "@/lib/blogStore";
import { mirrorBlogResearchToGithub } from "@/lib/blogSharedSync";

const API_HUB_BASE_URL = "https://naverapihub.apigw.ntruss.com";
const DATALAB_URL = `${API_HUB_BASE_URL}/search-trend/v1/search`;
const SEARCH_URL = `${API_HUB_BASE_URL}/search/v1/blog`;
const MAX_KEYWORDS = 200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const AUTO_PROFILE_TERMS = ["생활", "실용", "절약", "관리", "추천", "비교", "운동", "집밥", "여행"];
const AUTO_TOPIC_BASES = [
  "전기요금 절약", "통신비 절약", "생활비 절약", "자취방 정리", "냉장고 정리", "냉장고 냄새 제거", "세탁기 청소", "수건 냄새 제거", "곰팡이 제거", "싱크대 배수구 관리",
  "에어프라이어 관리", "전자레인지 청소", "욕실 물때 제거", "주방 기름때 제거", "장마철 빨래", "겨울철 난방비", "여름철 전기요금", "집 먼지 줄이기", "옷장 냄새 제거", "이사 체크리스트",
  "무선청소기", "로봇청소기", "제습기", "공기청정기", "선풍기", "전기포트", "무선 이어폰", "모니터", "노트북", "차량용품",
  "아침 스트레칭", "목 어깨 스트레칭", "걷기 운동", "집 하체 운동", "수면 관리", "직장인 건강관리", "자취생 식비", "간단한 집밥", "여행 준비물", "가계부 관리",
];
const AUTO_VARIANTS = ["추천", "비교", "사용법", "관리 방법", "구매 전 체크리스트"];

function discoverKeywords() {
  return [...new Set(AUTO_TOPIC_BASES.flatMap((base) => AUTO_VARIANTS.map((variant) => `${base} ${variant}`)))].slice(0, MAX_KEYWORDS);
}
function masterTopicFor(keyword: string) {
  const matched = keyword.match(/^(.*)\s+(추천|비교|사용법|관리 방법|구매 전 체크리스트)$/);
  if (!matched) return `${keyword} 핵심 가이드`;
  const [, base, variant] = matched;
  const topicByVariant: Record<string, string> = {
    추천: `${base} 추천 기준과 핵심 가이드`,
    비교: `${base} 비교와 선택 기준`,
    사용법: `${base} 사용법과 관리 핵심`,
    "관리 방법": `${base} 관리 방법 핵심 가이드`,
    "구매 전 체크리스트": `${base} 구매 전 체크리스트`,
  };
  return topicByVariant[variant] || `${base} ${variant} 핵심 가이드`;
}

function cleanKeyword(value: unknown) { return String(value || "").trim().replace(/\s+/g, " "); }
function topicId(blogId: string, keyword: string) { return `TOPIC-${createHash("sha256").update(`${blogId}:${keyword.toLowerCase()}`).digest("hex").slice(0, 16)}`; }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function dateString(daysAgo: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() - daysAgo); return date.toISOString().slice(0, 10); }

async function fetchDataLab(credentials: { clientId: string; clientSecret: string }, keywords: string[]) {
  const response = await fetch(DATALAB_URL, { method: "POST", headers: { "X-NCP-APIGW-API-KEY-ID": credentials.clientId, "X-NCP-APIGW-API-KEY": credentials.clientSecret, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: dateString(90), endDate: dateString(0), timeUnit: "date", keywordGroups: keywords.map((keyword) => ({ groupName: keyword, keywords: [keyword] })) }), cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`NAVER_DATALAB_${response.status}: ${body?.errorMessage || "DataLab 요청 실패"}`);
  return Array.isArray(body.results) ? body.results as Array<{ title: string; data: Array<{ period: string; ratio: number }> }> : [];
}

async function fetchSearch(credentials: { clientId: string; clientSecret: string }, keyword: string) {
  const response = await fetch(`${SEARCH_URL}?query=${encodeURIComponent(keyword)}&display=10&sort=date&format=json`, { headers: { "X-NCP-APIGW-API-KEY-ID": credentials.clientId, "X-NCP-APIGW-API-KEY": credentials.clientSecret }, cache: "no-store" });
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
      const item = await upsertBlogResearch({ id: topicId(input.blogId, keyword), blogId: input.blogId, keyword, mainKeyword: keyword, keywordCluster: [keyword], masterTopic: masterTopicFor(keyword), searchIntent: "정보 탐색", sourceUrl: result.items[0]?.link || null, sourceTitle: result.items[0]?.title || null, notes: `DataLab 상대 검색수요 ${demandScore} · 최근 30일 추세 ${lab.trend} · Blog Search 공급량 ${result.total}`, demandScore, gapScore: contentGapScore, fitScore, freshnessScore: lab.trend, trendScore: lab.trend, supplyScore, contentGapScore, selectionReason: `상대 검색수요 ${demandScore}, 추세 ${lab.trend}, 콘텐츠 공백 ${contentGapScore}, 블로그 적합도 ${fitScore}`, status: "candidate" });
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
  if (action === "discover") {
    try {
      const keywords = discoverKeywords();
      const collected = await collectCandidates({ keywords, blogId: String(body.blogId || "b_naver_main"), profileKeywords: AUTO_PROFILE_TERMS });
      const selection = await selectTopBlogResearch(100);
      const sync = await mirrorBlogResearchToGithub(await listBlogResearch());
      return NextResponse.json({ ok: true, mode: "automatic", profileKeywords: AUTO_PROFILE_TERMS, ...collected, selected: selection, sharedStorage: sync });
    } catch (error) {
      const message = error instanceof Error ? error.message : "자동 소재 발굴 실패";
      return NextResponse.json({ ok: false, code: message.split(":")[0], error: message }, { status: 502 });
    }
  }
  if (action === "collect") {
    try { return NextResponse.json({ ok: true, ...(await collectCandidates({ keywords: Array.isArray(body.keywords) ? body.keywords.map(cleanKeyword).filter(Boolean) : [], blogId: String(body.blogId || "b_naver_main"), profileKeywords: Array.isArray(body.profileKeywords) ? body.profileKeywords.map(cleanKeyword).filter(Boolean) : [] })) }); }
    catch (error) { const message = error instanceof Error ? error.message : "소재 수집 실패"; return NextResponse.json({ ok: false, code: message.split(":")[0], error: message }, { status: 502 }); }
  }
  if (action === "select-top-100") {
    const selected = await selectTopBlogResearch(100);
    const sync = await mirrorBlogResearchToGithub(await listBlogResearch());
    return NextResponse.json({ ok: true, selected, sharedStorage: sync });
  }
  if (action === "upsert") {
    if (!body.keyword || !body.masterTopic) return NextResponse.json({ error: "keyword/masterTopic은 필수입니다." }, { status: 400 });
    return NextResponse.json({ ok: true, item: await upsertBlogResearch({ id: body.id, blogId: body.blogId, keyword: String(body.keyword), masterTopic: String(body.masterTopic), sourceUrl: body.sourceUrl, sourceTitle: body.sourceTitle, notes: body.notes, demandScore: body.demandScore, gapScore: body.gapScore, fitScore: body.fitScore, freshnessScore: body.freshnessScore, status: body.status }) });
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
