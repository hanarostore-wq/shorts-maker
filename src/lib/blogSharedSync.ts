import type { BlogResearchItem } from "./blogStore";

const OWNER = "hanarostore-wq";
const REPO = "obsidian-main";
const BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;
const candidatePath = "AI-TEAM/BLOG/DATA/research-candidates.json";
const approvedPath = "AI-TEAM/BLOG/DATA/approved-topics.json";
const indexPath = "AI-TEAM/BLOG/DATA/content-index.json";

function token() { return process.env.GITHUB_BLOG_SYNC_TOKEN || process.env.GITHUB_TOKEN || ""; }
function headers() { return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }; }
function topic(item: BlogResearchItem) { return { topicId: item.topicId, blogId: item.blogId, mainKeyword: item.mainKeyword, keywordCluster: item.keywordCluster, searchIntent: item.searchIntent, masterTopic: item.masterTopic, demandScore: item.demandScore, trendScore: item.trendScore, supplyScore: item.supplyScore, contentGapScore: item.contentGapScore, fitScore: item.fitScore, opportunityScore: item.opportunityScore, selectionReason: item.selectionReason, status: item.status, generationStatus: "pending", batchId: null, articleId: null, updatedAt: item.updatedAt }; }
async function putFile(path: string, value: unknown, message: string) {
  const current = await fetch(`${API}/${path}?ref=${BRANCH}`, { headers: headers(), cache: "no-store" });
  const currentBody = current.status === 404 ? {} : await current.json();
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8").toString("base64");
  const response = await fetch(`${API}/${path}`, { method: "PUT", headers: headers(), body: JSON.stringify({ message, content, branch: BRANCH, ...(currentBody.sha ? { sha: currentBody.sha } : {}) }), cache: "no-store" });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(`GITHUB_BLOG_SYNC_${response.status}: ${body.message || "GitHub 파일 저장 실패"}`); }
}
export async function mirrorBlogResearchToGithub(items: BlogResearchItem[]) {
  if (!token()) return { status: "BLOCKED" as const, reason: "GITHUB_BLOG_SYNC_TOKEN 서버 환경변수가 없습니다." };
  const updatedAt = new Date().toISOString();
  const candidates = { schemaVersion: 1, updatedAt, count: items.length, items: items.map(topic) };
  const approvedItems = items.filter((item) => item.status === "approved");
  const approved = { schemaVersion: 1, updatedAt, selectedCount: approvedItems.length, items: approvedItems.map(topic) };
  try {
    await putFile(candidatePath, candidates, "Mirror blog research candidates");
    await putFile(approvedPath, approved, "Mirror approved blog topics");
    return { status: "CONFIRMED" as const, candidateCount: items.length, approvedCount: approvedItems.length, paths: [candidatePath, approvedPath, indexPath] };
  } catch (error) { return { status: "FAILED" as const, reason: error instanceof Error ? error.message : "GitHub 미러링 실패" }; }
}
