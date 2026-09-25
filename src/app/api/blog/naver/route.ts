import { NextResponse } from "next/server";
import { enqueueTask } from "@/lib/agent/store";
import {
  claimDueBlogSlots,
  confirmPublishAndCleanup,
  getBlogDashboard,
  listBlogArticles,
  markPublishFailure,
  patchBlogArticle,
  recoverStaleBlogPublishes,
  saveBlogSchedule,
  setBlogSelection,
  upsertBlogArticle,
} from "@/lib/blogStore";

export async function GET() {
  await recoverStaleBlogPublishes();
  return NextResponse.json(await getBlogDashboard(), { headers: { "Cache-Control": "no-store" } });
}

function makeInstruction(article: Awaited<ReturnType<typeof listBlogArticles>>[number]) {
  return [
    "[NAVER_BLOG_PUBLISH]",
    "네이버 블로그 SmartEditor에 아래 완성 글을 그대로 입력하고 즉시 발행하세요.",
    "로그인 화면이 나오면 자격증명을 읽거나 입력하지 말고 사람에게 로그인을 요청하세요.",
    "자동화 탐지 회피나 보안 우회는 하지 마세요.",
    "발행 완료 후 공개 글 URL로 이동해 실제 공개 상태를 확인할 수 있을 때만 성공 처리하세요.",
    `CONTENT_ID: ${article.id}`,
    `BLOG_ID: ${article.blogId}`,
    `TITLE: ${article.title}`,
    "BODY_START",
    article.body,
    "BODY_END",
    "START_URL: https://blog.naver.com/GoBlogWrite.naver",
  ].join("\n");
}

async function enqueueArticle(article: Awaited<ReturnType<typeof listBlogArticles>>[number]) {
  const task = await enqueueTask({ departmentId: "blog", agentId: "b_naver", instruction: makeInstruction(article) });
  await patchBlogArticle(article.id, { status: "queued", error: null });
  return task;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "import-ready");

  if (action === "run-due-slots") {
    const claimed = await claimDueBlogSlots(new Date());
    const tasks = [];
    for (const article of claimed) tasks.push(await enqueueArticle(article));
    return NextResponse.json({ ok: true, claimed: claimed.map((a) => a.id), tasks });
  }

  if (!body?.title || !body?.body) return NextResponse.json({ error: "title/body는 필수입니다." }, { status: 400 });
  const article = await upsertBlogArticle({
    id: body.id,
    blogId: body.blogId,
    title: body.title,
    body: body.body,
    category: body.category,
    tags: Array.isArray(body.tags) ? body.tags : [],
    images: Array.isArray(body.images) ? body.images : [],
    selected: body.selected === true,
    autoPublishEligible: body.autoPublishEligible === true,
  });
  return NextResponse.json({ ok: true, article });
}

async function verifyPublicUrl(url: string) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  if (!id && !["save-schedule"].includes(action)) return NextResponse.json({ error: "id는 필수입니다." }, { status: 400 });

  if (action === "save-schedule") {
    if (!body.blogId || !Array.isArray(body.slots)) return NextResponse.json({ error: "blogId/slots는 필수입니다." }, { status: 400 });
    return NextResponse.json({ ok: true, schedule: await saveBlogSchedule(String(body.blogId), body.slots, String(body.timezone || "Asia/Seoul")) });
  }

  const article = (await listBlogArticles()).find((x) => x.id === id);
  if (!article) return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });

  if (action === "select") {
    return NextResponse.json({ ok: true, article: await setBlogSelection(id, body.selected === true) });
  }

  if (action === "publish-result") {
    if (body.status === "done" && body.publishedUrl) {
      const browserVerified = body.verified === true && body.verifiedBy === "browser-worker";
      const serverVerified = browserVerified ? false : await verifyPublicUrl(String(body.publishedUrl));
      const verified = serverVerified || browserVerified;
      const result = await confirmPublishAndCleanup({ articleId: id, blogId: article.blogId, publishedUrl: String(body.publishedUrl), publishAttemptId: String(body.publishAttemptId || `attempt-${Date.now()}`), verified, publishedAt: body.publishedAt, error: verified ? null : "공개 URL 재조회 검증 실패로 원문을 보존합니다." });
      return NextResponse.json({ ok: verified, cleanup: result.cleanup, article: result.article, error: verified ? null : "공개 URL 검증 실패" }, { status: verified ? 200 : 409 });
    }
    const nextStatus = body.status === "needs_human" ? "needs_human" : "failed";
    return NextResponse.json({ ok: true, article: await markPublishFailure(id, nextStatus, body.error || "발행 실패", body.publishedUrl) });
  }

  if (action === "publish-now") {
    if (!["ready", "failed"].includes(article.status)) return NextResponse.json({ error: "READY/FAILED 글만 발행할 수 있습니다." }, { status: 409 });
    const task = await enqueueArticle(article);
    return NextResponse.json({ ok: true, task });
  }

  return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
}
