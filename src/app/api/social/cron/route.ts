import { NextResponse } from "next/server";
import { isSocialCron } from "@/lib/socialAuth";
import { listThreadPosts } from "@/lib/socialThreads";
import { publishThreadPost } from "@/lib/threadsPublisher";
import { claimDueBlogSlots, patchBlogArticle } from "@/lib/blogStore";
import { enqueueTask } from "@/lib/agent/store";

export const dynamic = "force-dynamic";

/** Vercel Hobby: one daily cron; due posts are processed on the next run. */
export async function GET(request: Request) {
  if (!isSocialCron(request)) return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  const due = (await listThreadPosts()).filter((post) => post.status === "scheduled" && post.scheduledAt && Date.parse(post.scheduledAt) <= Date.now()).slice(0, 2);
  const results: { platform: string; id: string; status: string }[] = [];
  for (const post of due) {
    try {
      await publishThreadPost(post.id);
      results.push({ platform: "threads", id: post.id, status: "published" });
    } catch {
      results.push({ platform: "threads", id: post.id, status: "failed_or_needs_review" });
    }
  }
  const blogDue = await claimDueBlogSlots(new Date());
  for (const article of blogDue.slice(0, 5)) {
    try {
      await enqueueTask({ departmentId: "blog", agentId: "b_naver", instruction: ["[NAVER_BLOG_PUBLISH]", `CONTENT_ID: ${article.id}`, `BLOG_ID: ${article.blogId}`, `TITLE: ${article.title}`, "BODY_START", article.body, "BODY_END", "발행 후 공개 글 URL을 확인하고 결과를 기록하세요."].join("\n") });
      results.push({ platform: "naver", id: article.id, status: "queued_for_browser" });
    } catch {
      await patchBlogArticle(article.id, { status: "failed", error: "브라우저 작업 대기열 등록 실패" });
      results.push({ platform: "naver", id: article.id, status: "failed" });
    }
  }
  return NextResponse.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}
