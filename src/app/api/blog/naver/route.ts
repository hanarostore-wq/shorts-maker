import { NextResponse } from "next/server";
import { enqueueTask } from "@/lib/agent/store";
import { listBlogArticles, patchBlogArticle, upsertBlogArticle } from "@/lib/blogStore";

export async function GET() {
  return NextResponse.json({ articles: await listBlogArticles() });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body?.title || !body?.body) return NextResponse.json({ error: "title/body는 필수입니다." }, { status: 400 });
  const article = await upsertBlogArticle({ id: body.id, title: body.title, body: body.body });
  return NextResponse.json({ ok: true, article });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  if (!id) return NextResponse.json({ error: "id는 필수입니다." }, { status: 400 });
  const articles = await listBlogArticles();
  const article = articles.find((x) => x.id === id);
  if (!article) return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });

  if (action === "publish-now") {
    if (!["ready","failed"].includes(article.status)) return NextResponse.json({ error: "READY/FAILED 글만 발행할 수 있습니다." }, { status: 409 });
    const instruction = [
      "[NAVER_BLOG_PUBLISH]",
      "네이버 블로그 SmartEditor에 아래 완성 글을 그대로 입력하고 즉시 발행하세요.",
      "로그인 화면이 나오면 자격증명을 읽거나 입력하지 말고 사람에게 로그인을 요청하세요.",
      "자동화 탐지 회피나 보안 우회는 하지 마세요.",
      "발행이 실제 완료된 뒤 공개 글 URL을 확인할 수 있을 때만 성공 처리하세요.",
      `CONTENT_ID: ${article.id}`,
      `TITLE: ${article.title}`,
      "BODY_START",
      article.body,
      "BODY_END",
      "START_URL: https://blog.naver.com/GoBlogWrite.naver",
    ].join("\n");
    const task = await enqueueTask({ departmentId: "blog", agentId: "b_naver", instruction });
    await patchBlogArticle(id, { status: "queued", error: null });
    return NextResponse.json({ ok: true, task });
  }

  return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
}
