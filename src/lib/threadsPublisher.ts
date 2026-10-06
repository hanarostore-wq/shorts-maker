import { changeThreadPost, claimThreadPost, readThreadAccounts, releaseThreadPublishLock, type ThreadPost } from "@/lib/socialThreads";
import { reportCompletion, reportFailure } from "@/lib/store";

const API = "https://graph.threads.net";
async function graph(path: string, token: string, body?: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Threads 토큰 또는 게시 권한을 확인하세요." : response.status === 429 ? "Threads API 호출 한도를 초과했습니다." : `Threads API 오류 ${response.status}`);
  return data;
}
export async function inspectThreadsToken(token: string) {
  if (!token.trim() || token.length > 2048) throw new Error("유효한 Threads Access Token을 입력하세요.");
  const profile = await graph("/me?fields=id,username,name", token);
  if (!profile.id || !profile.username) throw new Error("Threads 계정 ID와 사용자명을 확인하지 못했습니다.");
  return { id: String(profile.id), username: String(profile.username) };
}
export async function publishThreadPost(id: string, allowDraft = false) {
  const post: ThreadPost = await claimThreadPost(id, allowDraft);
  let publicationStarted = false;
  try {
    const account = (await readThreadAccounts()).find((item) => item.id === post.accountId);
    if (!account) throw new Error("Threads 계정 연결이 없습니다.");
    const container = await graph("/me/threads", account.token, new URLSearchParams({ media_type: "TEXT", text: post.text }));
    if (!container.id) throw new Error("게시 컨테이너 ID를 받지 못했습니다.");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    publicationStarted = true;
    const published = await graph("/me/threads_publish", account.token, new URLSearchParams({ creation_id: String(container.id) }));
    if (!published.id) throw new Error("게시 ID를 받지 못했습니다.");
    const remoteId = String(published.id);
    const detail = await graph(`/${encodeURIComponent(remoteId)}?fields=id,permalink,text`, account.token);
    if (String(detail.id || "") !== remoteId || !detail.permalink) throw new Error("게시물 공개 주소 검증 실패");
    const updated = await changeThreadPost(id, { status: "published", remoteId, permalink: String(detail.permalink), error: null });
    await reportCompletion({ departmentId: "blog", agentId: "o_threads", message: `Threads 게시 완료 · @${account.username} · ${remoteId}` });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Threads 게시 오류";
    // Once the final remote publish is attempted, never auto-retry an uncertain outcome.
    const status = publicationStarted ? "needs_review" : "failed";
    await changeThreadPost(id, { status, error: `${message}${publicationStarted ? " · 실제 게시 여부를 계정에서 확인한 뒤 수동으로 처리하세요. 자동 재시도 안 함" : ""}` });
    if (!publicationStarted) await releaseThreadPublishLock(id);
    await reportFailure({ departmentId: "blog", agentId: "o_threads", message: `Threads ${status === "needs_review" ? "게시 확인 필요" : "게시 실패"}: ${message}`, incidentKey: `threads:${id}` });
    throw new Error(message);
  }
}
