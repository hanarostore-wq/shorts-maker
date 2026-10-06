import { NextResponse } from "next/server";
import { isSocialAuthorized } from "@/lib/socialAuth";
import { getThreadDashboard, createThreadPost, saveThreadAccount, changeThreadPost, listThreadPosts } from "@/lib/socialThreads";
import { inspectThreadsToken, publishThreadPost } from "@/lib/threadsPublisher";
import { getSharedRedis } from "@/lib/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function unauthorized() { return NextResponse.json({ error: "관제실 소셜 접근키를 확인하세요." }, { status: 401, headers }); }
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "작업 실패" }, { status: 400, headers }); }

export async function GET(request: Request) {
  if (!isSocialAuthorized(request)) return unauthorized();
  try { return NextResponse.json(await getThreadDashboard(), { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!isSocialAuthorized(request)) return unauthorized();
  try {
    const body = await request.json();
    switch (body.action) {
      case "connect": {
        const token = String(body.token || "").trim();
        const profile = await inspectThreadsToken(token);
        const account = await saveThreadAccount({ ...profile, token, updatedAt: new Date().toISOString() });
        return NextResponse.json({ ok: true, account }, { headers });
      }
      case "create": {
        const article = await createThreadPost(String(body.text || ""), String(body.accountId || ""), body.scheduledAt ? String(body.scheduledAt) : null);
        return NextResponse.json({ ok: true, article }, { headers });
      }
      case "run-due": {
        await getSharedRedis()?.set("moneyos:social:desktop-heartbeat", new Date().toISOString(), { ex: 35 });
        const due = (await listThreadPosts()).find((post) => post.status === "scheduled" && post.scheduledAt && Date.parse(post.scheduledAt) <= Date.now());
        if (!due) return NextResponse.json({ ok: true, due: null }, { headers });
        try {
          return NextResponse.json({ ok: true, due: due.id, article: await publishThreadPost(due.id) }, { headers });
        } catch (error) {
          return failure(error);
        }
      }
      case "publish": {
        const article = (await listThreadPosts()).find((item) => item.id === body.id);
        if (!article || !["draft", "scheduled", "failed"].includes(article.status)) throw new Error("발행 가능한 원고를 선택하세요.");
        return NextResponse.json({ ok: true, article: await publishThreadPost(String(body.id), true) }, { headers });
      }
      case "cancel": {
        const article = (await listThreadPosts()).find((item) => item.id === body.id);
        if (!article || article.status !== "scheduled") throw new Error("예약 상태에서만 취소할 수 있습니다.");
        return NextResponse.json({ ok: true, article: await changeThreadPost(article.id, { status: "draft", scheduledAt: null }) }, { headers });
      }
      default: throw new Error("지원하지 않는 작업입니다.");
    }
  } catch (error) { return failure(error); }
}
