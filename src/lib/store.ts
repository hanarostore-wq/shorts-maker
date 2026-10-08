import { Redis } from "@upstash/redis";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import { isIP } from "node:net";
import { departments as initialDepartments, projects } from "./mock-data";
import { getAgentPlatforms } from "./agentIntegrations";
import { getPolicy, listApprovals, listTasks } from "./agent/store";
import type { Department, Project } from "./types";

export interface LogEntry {
  id: string;
  time: string;
  departmentId: string;
  agentId: string;
  agentName: string;
  message: string;
}

export interface SourcedProduct {
  id: string;
  url: string;
  title: string;
  price: string | null;
  image: string | null;
  images?: string[];
  options?: string[];
  optionGroups?: Array<{
    name: string;
    values: Array<{ label: string; availability?: string; stock_quantity?: number | null }>;
  }>;
  variants?: Array<{
    attributes: Record<string, string>;
    price?: number | null;
    availability?: string;
    stock_quantity?: number | null;
  }>;
  detailImages?: string[];
  specs?: Record<string, string>;
  description?: string | null;
  scrapedAt: string;
  revision: number;
}

interface State {
  departments: Department[];
  projects: Project[];
  log: LogEntry[];
  completedToday: number;
  sourcedProducts: SourcedProduct[];
  failureByKey: Record<string, string>;
}

const STATE_KEY = "shorts-maker:state";

type TraderHealth = {
  ok?: boolean;
  version?: string;
  markets?: number;
  status?: { upbit?: boolean; lastUpbitLatency?: number };
};

type TraderTrade = {
  time: string;
  market: string;
  side: string;
  pnl: string;
  pnlPct: string;
  reason: string;
};

type TraderRuntime = { health: TraderHealth; lastTrade: TraderTrade | null } | { error: string };

const TRADER_ORIGIN = (process.env.YUJIN_TRADERS_ORIGIN || "http://127.0.0.1:7070").replace(/\/$/, "");
const COLLAB_SYNC_STATUS_PATH = process.env.YUJIN_COLLAB_SYNC_STATUS_PATH || "C:/ProgramData/YuJinTraders/collaboration-sync/status.json";

type CollaborationRuntime = {
  phase?: string;
  lastError?: string | null;
  pendingCommands?: number;
  lastExport?: { market?: string; side?: string; at?: string } | null;
  lastCommand?: { agentId?: string; agentName?: string; operation?: string; status?: string; processedAt?: string; error?: string } | null;
};

function inspectCollaborationRuntime(): CollaborationRuntime | null {
  try { return JSON.parse(fs.readFileSync(COLLAB_SYNC_STATUS_PATH, "utf8")) as CollaborationRuntime; }
  catch { return null; }
}

function parseTraderCsvRow(line: string): TraderTrade | null {
  const values = [...line.matchAll(/"((?:""|[^"])*)"/g)].map((match) => match[1].replaceAll('""', '"'));
  if (values.length < 13) return null;
  return { time: values[0], market: values[1], side: values[2], pnl: values[8], pnlPct: values[9], reason: values[11] };
}

async function inspectTraderRuntime(): Promise<TraderRuntime> {
  try {
    const [healthResponse, tradesResponse] = await Promise.all([
      fetch(`${TRADER_ORIGIN}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(2_500) }),
      fetch(`${TRADER_ORIGIN}/api/trades.csv`, { cache: "no-store", signal: AbortSignal.timeout(2_500) }),
    ]);
    if (!healthResponse.ok) return { error: `Traders 상태 조회 HTTP ${healthResponse.status}` };
    if (!tradesResponse.ok) return { error: `Traders 거래이력 조회 HTTP ${tradesResponse.status}` };
    const rows = (await tradesResponse.text()).split(/\r?\n/).filter(Boolean);
    return { health: await healthResponse.json() as TraderHealth, lastTrade: rows.length > 1 ? parseTraderCsvRow(rows.at(-1) || "") : null };
  } catch (error) {
    return { error: `Traders 상태 조회 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}` };
  }
}

function upsertTraderLog(state: State, id: string, message: string) {
  const coin = state.departments.find((department) => department.id === "coin");
  const agent = coin?.agents.find((item) => item.id === "c_yujin");
  if (!coin || !agent) return;
  const entry: LogEntry = {
    id,
    time: new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }),
    departmentId: "coin",
    agentId: agent.id,
    agentName: agent.name,
    message,
  };
  const index = state.log.findIndex((item) => item.id === id);
  if (index >= 0) state.log[index] = entry;
  else state.log.unshift(entry);
  state.log = state.log.slice(0, 30);
}

function applyTraderRuntime(state: State, runtime: TraderRuntime) {
  const agent = state.departments.find((department) => department.id === "coin")?.agents.find((item) => item.id === "c_yujin");
  if (!agent) return;
  if ("error" in runtime) {
    const message = runtime.error.slice(0, 180);
    agent.status = "offline";
    agent.task = `⚠ ${message}`;
    if (state.failureByKey.traderRuntime !== message) {
      state.failureByKey.traderRuntime = message;
      upsertTraderLog(state, "trader-runtime", `⚠ ${message}`);
    }
    return;
  }
  delete state.failureByKey.traderRuntime;
  const receiving = runtime.health.status?.upbit === true;
  const markets = Number(runtime.health.markets || 0);
  agent.status = receiving ? "active" : "standby";
  agent.task = receiving
    ? `전체 원화마켓 ${markets}개 분석 · 자동매매 ON · 시세 수신 정상`
    : `전체 원화마켓 ${markets}개 분석 · 자동매매 ON · 시세 재연결 대기`;
  upsertTraderLog(state, "trader-runtime", receiving
    ? `전체 원화마켓 ${markets}개 분석 정상 · 자동매매 ON · Traders v${runtime.health.version || "-"}`
    : `⚠ 전체 원화마켓 ${markets}개 분석 중 · 업비트 시세 재연결 대기`);
  if (!runtime.lastTrade) return;
  const trade = runtime.lastTrade;
  const tradeId = `trader-fill-${trade.time}-${trade.market}-${trade.side}`;
  const detail = [trade.pnl && `손익 ${trade.pnl}원`, trade.pnlPct && `${trade.pnlPct}%`, trade.reason].filter(Boolean).join(" · ");
  upsertTraderLog(state, tradeId, `PAPER ${trade.side} 체결 · ${trade.market}${detail ? ` · ${detail}` : ""}`);
}

function applyCollaborationRuntime(state: State, runtime: CollaborationRuntime | null) {
  const coin = state.departments.find((department) => department.id === "coin");
  const analyst = coin?.agents.find((agent) => agent.id === "c_trade_analyst");
  if (!coin || !analyst) return;
  if (!runtime) {
    analyst.status = "standby";
    analyst.task = "체결·차트·진입·매도·익절·손절 근거 동기화 서비스 연결 대기";
    return;
  }
  const healthy = runtime.phase === "healthy";
  analyst.status = healthy ? "active" : runtime.phase === "degraded" ? "offline" : "standby";
  analyst.task = healthy && runtime.lastExport
    ? `GitHub 내보내기 정상 · ${runtime.lastExport.market || "-"} ${runtime.lastExport.side || "체결"} · 차트·근거 포함`
    : `⚠ GitHub 내보내기 ${runtime.lastError || "연결 확인 중"}`.slice(0, 180);
  for (const agent of coin.agents.filter((item) => ["c_gemini", "c_claude", "c_grok", "c_manus", "c_gpt"].includes(item.id))) {
    const command = runtime.lastCommand;
    if (command?.agentId === agent.id) {
      agent.status = command.status === "applied" ? "active" : "offline";
      agent.task = command.status === "applied"
        ? `${agent.name} 슬롯 ${command.operation || "명령"} 적용 완료 · GitHub 이력 기록`
        : `⚠ ${agent.name} 슬롯 명령 거부 · ${command.error || "검증 실패"}`.slice(0, 180);
    } else {
      agent.status = healthy ? "standby" : "offline";
      agent.task = healthy ? `${agent.name} 슬롯 추가·삭제·적용 명령 GitHub 대기` : `⚠ ${agent.name} 명령 대기열 연결 확인 필요`;
    }
  }
}

export function getSharedRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function isConcatPersistentStorageAvailable() {
  return process.env.NODE_ENV !== "production" || getSharedRedis() !== null;
}

const getRedis = getSharedRedis;

export type LocalConcatJobStatus = "queued" | "working" | "canceling" | "completed" | "failed" | "canceled";
export type LocalConcatOutputFormat = "mp4";
export type LocalConcatProcessingMode = "copy" | "normalize";
export type LocalConcatOutputQuality = "source" | "720p" | "1080p";
export interface LocalConcatJob {
  id: string;
  token: string;
  status: LocalConcatJobStatus;
  outputFormat: LocalConcatOutputFormat;
  processingMode: LocalConcatProcessingMode;
  outputQuality: LocalConcatOutputQuality;
  outputName?: string;
  sourceBytes?: number;
  outputBytes?: number;
  progress?: number;
  etaSeconds?: number;
  stage?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const CONCAT_JOB_PREFIX = "shorts-maker:concat-job:";
const CONCAT_NOTIFICATION_KEY = "shorts-maker:concat-notification";
const CONCAT_ACTIVE_JOB_KEY = "shorts-maker:concat-active-job";
const CONCAT_JOB_TTL_SECONDS = 60 * 60 * 24;
const memoryConcatJobs = new Map<string, LocalConcatJob>();
let memoryConcatWebhookUrl: string | null = null;
let memoryActiveConcatJobId: string | null = null;

// Redis 저장소가 없으면(로컬 개발 등) 메모리로 대체 동작한다.
let memoryState: State | null = null;

function defaultState(): State {
  return {
    departments: structuredClone(initialDepartments),
    projects: structuredClone(projects),
    log: [],
    completedToday: 0,
    sourcedProducts: [],
    failureByKey: {},
  };
}

// 실제 연동이 없는 직원에게 예전에 잘못 찍혔던 "이상발생" 표시가
// 영원히 남아있지 않도록, 매번 상태를 읽을 때 원래 모습으로 되돌린다.
function healState(state: State): State {
  if (!Array.isArray(state.departments)) state.departments = structuredClone(initialDepartments);
  if (!state.sourcedProducts) state.sourcedProducts = [];
  if (!state.failureByKey) state.failureByKey = {};
  // UI 배치만 수정한다. 기존 원고·예약·발행 결과 Redis 키는 삭제하지 않는다.
  const freshBlog = initialDepartments.find((department) => department.id === "blog");
  let blog = state.departments.find((department) => department.id === "blog");
  if (!blog && freshBlog) {
    blog = { ...structuredClone(freshBlog), agents: [] };
    state.departments.splice(1, 0, blog);
  }
  for (const department of state.departments) {
    department.agents = department.agents.filter((agent) => !["b_research", "b_ready", "b_adsense"].includes(agent.id));
  }
  if (blog) {
    for (const id of ["b_naver", "o_threads"]) {
      const misplaced = state.departments.flatMap((department) => department.agents).find((agent) => agent.id === id);
      if (misplaced && !blog.agents.some((agent) => agent.id === id)) blog.agents.push(misplaced);
      for (const department of state.departments) if (department.id !== "blog") department.agents = department.agents.filter((agent) => agent.id !== id);
    }
  }
  const coin = state.departments.find((department) => department.id === "coin");
  const freshCoinAgents = initialDepartments.find((department) => department.id === "coin")?.agents ?? [];
  if (coin) {
    // 코인매매부서는 Traders 관제·체결 분석·에이전트별 슬롯 관리 직원을 표시한다.
    // 외부 YuJin Traders의 매매 엔진·계좌·거래 기록은 건드리지 않는다.
    coin.agents = structuredClone(freshCoinAgents);
  }
  state.projects = state.projects || [];
  const freshBlogProject = projects.find((project) => project.id === "p4");
  const blogProject = state.projects.find((project) => project.id === "p4");
  if (blogProject) { blogProject.departmentId = "blog"; blogProject.agentCount = 0; blogProject.leadAgent = "미배정"; }
  else if (freshBlogProject) state.projects.push(structuredClone(freshBlogProject));
  const existingDepartmentIds = new Set(state.departments.map((department) => department.id));
  for (const freshDepartment of initialDepartments) {
    if (!existingDepartmentIds.has(freshDepartment.id)) {
      state.departments.push(structuredClone(freshDepartment));
    }
  }
  const knownAgentIds = new Set(
    state.departments.flatMap((department) => department.agents.map((agent) => agent.id)),
  );
  for (const department of state.departments) {
    const fresh = initialDepartments.find((d) => d.id === department.id);
    if (!fresh) continue;
    if (department.id === "ops") {
      // 당장 업무가 없는 운영 직원은 화면에서 임시 제외한다. 직원 ID·로그·관련 기능은 보존한다.
      department.agents = department.agents.filter((agent) => !["o1", "o2", "o3"].includes(agent.id));
    }
    // 부서와 순서는 사용자가 직접 배치한다. 직원 ID에 해당하는 최신 업무
    // 정보만 동기화하고, 다른 부서로 옮긴 직원은 원래 자리로 되돌리지 않는다.
    department.agents = department.agents.map((agent) => {
      const current = initialDepartments
        .flatMap((item) => item.agents)
        .find((candidate) => candidate.id === agent.id);
      const isConcatRuntimeStatus = agent.id === "v_concat" && /^(이어붙이기 (대기중|작업중)|제작완료|⚠ 제작실패)/.test(agent.task);
      return current ? { ...agent, name: current.name, task: isConcatRuntimeStatus ? agent.task : current.task } : agent;
    });
    for (const freshAgent of fresh.agents) {
      if (!knownAgentIds.has(freshAgent.id)) {
        department.agents.push(structuredClone(freshAgent));
        knownAgentIds.add(freshAgent.id);
      }
    }

    for (const agent of department.agents) {
      if (agent.id === "s6" && agent.name === "서버관리원") {
        agent.name = "쿠팡파견";
        agent.status = "offline";
        agent.task = "쿠팡 API 연동 관리 (클릭해서 조회)";
      }
      if (agent.id === "s1" && agent.task.includes("아직 연동 안 됨")) {
        agent.task = "확장프로그램 수동·자동 상품소싱 대기";
      }
      const isAnomaly = agent.task.startsWith("⚠");
      const isIntegrated = getAgentPlatforms(agent.id).length > 0;
      if (isAnomaly && !isIntegrated) {
        const freshAgent = fresh.agents.find((a) => a.id === agent.id);
        if (freshAgent) {
          agent.status = freshAgent.status;
          agent.task = freshAgent.task;
        }
      }
    }
  }
  const sharedStorageAgent = state.departments
    .find((department) => department.id === "ops")
    ?.agents.find((agent) => agent.id === "o5");
  if (sharedStorageAgent) {
    if (isSharedStorageConfigured()) {
      sharedStorageAgent.status = "active";
      sharedStorageAgent.task = "Upstash Redis 공유 상태 정상";
    } else {
      sharedStorageAgent.status = "offline";
      sharedStorageAgent.task = "⚠ 공유저장소 미연결 - Redis 환경변수 확인 필요";
    }
  }
  const coinProject=state.projects.find(p=>p.id==='p5');
  if(coinProject){coinProject.agentCount=state.departments.find(d=>d.id==='coin')?.agents.length ?? 0;coinProject.leadAgent='업비트';}
  const shortsProject = state.projects.find((project) => project.id === "p3");
  if (shortsProject) {
    shortsProject.agentCount = state.departments.find((department) => department.id === "shorts")?.agents.length ?? 0;
    shortsProject.leadAgent = shortsProject.agentCount > 0 ? "영상감독" : "미배정";
  }
  const vercelLogPattern = /Vercel|빌드|배포|대기열|INITIALIZING/;
  const newestVercelLog = state.log.find((item) => item.agentId === "o4" && vercelLogPattern.test(item.message));
  if (newestVercelLog) {
    state.log = [
      newestVercelLog,
      ...state.log.filter((item) => item !== newestVercelLog && !(item.agentId === "o4" && vercelLogPattern.test(item.message))),
    ];
  }
  return state;
}

async function readState(): Promise<State> {
  const redis = getRedis();
  if (!redis) {
    if (!memoryState) memoryState = defaultState();
    memoryState = healState(memoryState);
    return memoryState;
  }
  const stored = await redis.get<State>(STATE_KEY);
  return healState(stored ?? defaultState());
}

async function writeState(state: State): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryState = state;
    return;
  }
  await redis.set(STATE_KEY, state);
}

function publicConcatJob(job: LocalConcatJob): Omit<LocalConcatJob, "token"> {
  return {
    id: job.id,
    status: job.status,
    outputFormat: job.outputFormat,
    processingMode: job.processingMode,
    outputQuality: job.outputQuality,
    outputName: job.outputName,
    sourceBytes: job.sourceBytes,
    outputBytes: job.outputBytes,
    progress: job.progress,
    etaSeconds: job.etaSeconds,
    stage: job.stage,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function readConcatJob(id: string): Promise<LocalConcatJob | null> {
  const redis = getRedis();
  if (!redis) return memoryConcatJobs.get(id) ?? null;
  return (await redis.get<LocalConcatJob>(`${CONCAT_JOB_PREFIX}${id}`)) ?? null;
}

async function writeConcatJob(job: LocalConcatJob): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryConcatJobs.set(job.id, job);
    return;
  }
  await redis.set(`${CONCAT_JOB_PREFIX}${job.id}`, job, { ex: CONCAT_JOB_TTL_SECONDS });
}

async function acquireConcatJobLock(jobId: string) {
  const redis = getRedis();
  if (!redis) {
    if (memoryActiveConcatJobId) return false;
    memoryActiveConcatJobId = jobId;
    return true;
  }
  return Boolean(await redis.set(CONCAT_ACTIVE_JOB_KEY, jobId, { nx: true, ex: CONCAT_JOB_TTL_SECONDS }));
}

async function releaseConcatJobLock(jobId: string) {
  const redis = getRedis();
  if (!redis) {
    if (memoryActiveConcatJobId === jobId) memoryActiveConcatJobId = null;
    return;
  }
  if (await redis.get<string>(CONCAT_ACTIVE_JOB_KEY) === jobId) await redis.del(CONCAT_ACTIVE_JOB_KEY);
}

function formatConcatBytes(bytes?: number) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatConcatEta(seconds?: number) {
  if (!Number.isFinite(seconds) || seconds === undefined || seconds < 1) return null;
  const value = Math.round(seconds);
  const minute = Math.floor(value / 60);
  const second = value % 60;
  return minute > 0 ? `약 ${minute}:${String(second).padStart(2, "0")} 남음` : `약 ${second}초 남음`;
}

async function readConcatWebhookUrl(): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return memoryConcatWebhookUrl;
  return (await redis.get<string>(CONCAT_NOTIFICATION_KEY)) ?? null;
}

async function writeConcatWebhookUrl(url: string | null): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryConcatWebhookUrl = url;
    return;
  }
  if (url) await redis.set(CONCAT_NOTIFICATION_KEY, url);
  else await redis.del(CONCAT_NOTIFICATION_KEY);
}

function isPrivateWebhookAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.includes("::ffff:127.") || normalized.includes("::ffff:10.") || normalized.includes("::ffff:192.168.");
  }
  return true;
}

async function normalizeWebhookUrl(value: string) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.toString().length > 2048 || parsed.port) throw new Error("공개 HTTPS 웹훅 주소만 저장할 수 있습니다.");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("내부 네트워크 웹훅 주소는 사용할 수 없습니다.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateWebhookAddress(item.address))) throw new Error("공개 인터넷 웹훅 주소만 사용할 수 있습니다.");
  return parsed.toString();
}

export async function getLocalConcatNotificationConfig() {
  const url = await readConcatWebhookUrl();
  return { configured: Boolean(url), host: url ? new URL(url).host : null };
}

export async function setLocalConcatNotificationWebhook(webhookUrl: string | null) {
  const normalized = webhookUrl?.trim() ? await normalizeWebhookUrl(webhookUrl) : null;
  await writeConcatWebhookUrl(normalized);
  return getLocalConcatNotificationConfig();
}

async function dispatchLocalConcatWebhook(job: LocalConcatJob) {
  const url = await readConcatWebhookUrl();
  if (!url) return;
  const message = `이어붙이기 제작완료${job.outputName ? ` · ${job.outputName}` : ""}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "concat.completed", message, content: message, job: publicConcatJob(job) }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    }).then((response) => {
      if (!response.ok) throw new Error(`웹훅 HTTP ${response.status}`);
    });
  } catch (error) {
    console.error("[concat-webhook] delivery failed", error);
  }
}

async function reflectConcatJobOnAgent(job: LocalConcatJob, incrementCompletion: boolean) {
  const state = await readState();
  const agent = state.departments.find((department) => department.id === "shorts")?.agents.find((item) => item.id === "v_concat");
  if (!agent) return;
  const labels: Record<LocalConcatJobStatus, string> = {
    queued: "이어붙이기 대기중",
    working: [
      "이어붙이기 작업중",
      Number.isFinite(job.progress) ? `${Math.round((job.progress ?? 0) * 100)}%` : null,
      formatConcatEta(job.etaSeconds),
      formatConcatBytes(job.sourceBytes) ? `원본 ${formatConcatBytes(job.sourceBytes)}` : null,
    ].filter(Boolean).join(" · "),
    canceling: "이어붙이기 취소중",
    completed: ["제작완료", job.outputName, formatConcatBytes(job.outputBytes)].filter(Boolean).join(" · "),
    failed: `⚠ 제작실패${job.error ? ` · ${job.error}` : ""}`,
    canceled: "이어붙이기 대기중",
  };
  agent.status = job.status === "working" || job.status === "canceling" ? "active" : job.status === "queued" || job.status === "canceled" ? "standby" : job.status === "failed" ? "offline" : "active";
  agent.task = labels[job.status];
  if (incrementCompletion) {
    const message = labels.completed;
    const duplicate = state.log.some((entry) => entry.agentId === "v_concat" && entry.message === message);
    if (!duplicate) {
      state.log.unshift({
        id: `concat-${job.id}`,
        time: new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }),
        departmentId: "shorts",
        agentId: "v_concat",
        agentName: agent.name,
        message,
      });
      state.log = state.log.slice(0, 30);
      state.completedToday += 1;
    }
  }
  await writeState(state);
}

export async function createLocalConcatJob(outputFormat: LocalConcatOutputFormat, processingMode: LocalConcatProcessingMode, outputQuality: LocalConcatOutputQuality) {
  const now = new Date().toISOString();
  const job: LocalConcatJob = {
    id: randomUUID(),
    token: randomBytes(24).toString("base64url"),
    status: "queued",
    outputFormat,
    processingMode,
    outputQuality,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (!await acquireConcatJobLock(job.id)) return null;
  await writeConcatJob(job);
  await reflectConcatJobOnAgent(job, false);
  return job;
}

export async function getLocalConcatJob(id: string, token: string) {
  const job = await readConcatJob(id);
  if (!job || job.token !== token) return null;
  return publicConcatJob(job);
}

export async function updateLocalConcatJob(input: {
  id: string;
  token: string;
  status: LocalConcatJobStatus;
  outputName?: string;
  sourceBytes?: number;
  outputBytes?: number;
  progress?: number;
  etaSeconds?: number;
  stage?: string;
  error?: string;
}) {
  const job = await readConcatJob(input.id);
  if (!job || job.token !== input.token) return null;
  const terminalStatuses: LocalConcatJobStatus[] = ["completed", "failed", "canceled"];
  if (terminalStatuses.includes(job.status) && job.status !== input.status) return publicConcatJob(job);
  if (job.status === "canceling" && input.status === "working") return publicConcatJob(job);
  const wasCompleted = job.status === "completed";
  job.status = input.status;
  job.updatedAt = new Date().toISOString();
  job.outputName = input.outputName ?? job.outputName;
  job.sourceBytes = input.sourceBytes ?? job.sourceBytes;
  job.outputBytes = input.outputBytes ?? job.outputBytes;
  job.progress = typeof input.progress === "number" ? Math.max(0, Math.min(1, input.progress)) : job.progress;
  job.etaSeconds = typeof input.etaSeconds === "number" ? Math.max(0, Math.round(input.etaSeconds)) : job.etaSeconds;
  job.stage = input.stage ? input.stage.slice(0, 160) : job.stage;
  job.error = input.error ? input.error.slice(0, 180) : undefined;
  await writeConcatJob(job);
  await reflectConcatJobOnAgent(job, !wasCompleted && job.status === "completed");
  if (!wasCompleted && job.status === "completed") await dispatchLocalConcatWebhook(job);
  if (["completed", "failed", "canceled"].includes(job.status)) await releaseConcatJobLock(job.id);
  return publicConcatJob(job);
}

export async function getState(): Promise<State> {
  const state = await readState();
  const [pendingApprovals, tasks, policy, traderRuntime] = await Promise.all([
    listApprovals({ state: "pending" }),
    listTasks(),
    getPolicy(),
    inspectTraderRuntime(),
  ]);
  applyTraderRuntime(state, traderRuntime);
  applyCollaborationRuntime(state, inspectCollaborationRuntime());
  const storeDepartment = state.departments.find((department) => department.id === "store");
  const approvalAgent = storeDepartment?.agents.find((agent) => agent.id === "s7");
  const taskAgent = storeDepartment?.agents.find((agent) => agent.id === "s8");
  const policyAgent = storeDepartment?.agents.find((agent) => agent.id === "s9");

  if (approvalAgent) {
    approvalAgent.status = pendingApprovals.length > 0 ? "active" : "offline";
    approvalAgent.task = pendingApprovals.length > 0
      ? `승인 대기 ${pendingApprovals.length}건 처리 중`
      : "승인 대기 없음";
  }

  if (taskAgent) {
    const running = tasks.filter((task) => task.status === "running").length;
    const queued = tasks.filter((task) => task.status === "queued").length;
    taskAgent.status = running > 0 ? "active" : queued > 0 ? "standby" : "offline";
    taskAgent.task = running > 0
      ? `에이전트 작업 ${running}건 실행 중`
      : queued > 0
        ? `에이전트 작업 ${queued}건 대기 중`
        : "실행 중인 지시 없음";
  }

  const sourcingAgent = storeDepartment?.agents.find((agent) => agent.id === "s1");
  const sourcingManagementAgent = storeDepartment?.agents.find((agent) => agent.id === "s11");
  if (sourcingAgent) {
    const sourcingTasks = tasks.filter((task) => task.agentId === "s1");
    const running = sourcingTasks.filter((task) => task.status === "running").length;
    const queued = sourcingTasks.filter((task) => task.status === "queued").length;
    const latest = sourcingTasks[0];
    sourcingAgent.status = running > 0 ? "active" : queued > 0 ? "standby" : "offline";
    sourcingAgent.task = running > 0
      ? `자동 소싱 ${running}건 작업 중`
      : queued > 0
        ? `자동 소싱 ${queued}건 대기 중`
        : latest?.status === "done"
          ? "최근 자동 소싱 완료"
          : "확장프로그램 수동·자동 상품소싱 대기";
  }

  if (sourcingManagementAgent) {
    const sourcedCount = state.sourcedProducts.length;
    sourcingManagementAgent.status = sourcedCount > 0 ? "active" : "offline";
    sourcingManagementAgent.task = sourcedCount > 0
      ? `소싱 상품 ${sourcedCount}건 관리 중`
      : "소싱 상품 대기 · 저장된 상품 없음";
  }

  if (policyAgent) {
    const enabledCount = Object.values(policy).filter((rule) => rule.autoApprove).length;
    policyAgent.status = enabledCount > 0 ? "active" : "offline";
    policyAgent.task = enabledCount > 0
      ? `자동 승인 정책 ${enabledCount}종 감시 중`
      : "자동 승인 정책 없음";
  }

  await writeState(state);
  return state;
}

export async function markAgentConnected(agentId: string, message: string): Promise<void> {
  const state = await readState();
  for (const department of state.departments) {
    const agent = department.agents.find((item) => item.id === agentId);
    if (!agent) continue;
    agent.status = "active";
    agent.task = message;
    await writeState(state);
    return;
  }
}

export async function reportCompletion(input: {
  departmentId: string;
  agentId: string;
  message: string;
  incidentKey?: string;
}): Promise<LogEntry | null> {
  const state = await readState();
  const department = state.departments.find((d) => d.id === input.departmentId);
  if (!department) return null;
  const agent = department.agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  agent.status = "active";
  agent.task = input.message;
  if (input.incidentKey) delete state.failureByKey[input.incidentKey];

  const duplicateCompletion = state.log.some((item) => item.agentId === agent.id && item.message === input.message && /완료|성공|정상|조회/.test(item.message));
  if (duplicateCompletion) {
    await writeState(state);
    return null;
  }

  // Vercel은 BUILDING → READY처럼 하나의 배포 상태가 바뀐다.
  // 상태별로 새 줄을 쌓으면 과거 "빌드 중"이 현재 상태처럼 보여 혼동되므로
  // 관제실에는 Vercel의 최신 상태를 하나의 로그 줄로 유지한다.
  const replaceIndex = input.incidentKey === "vercel"
    ? state.log.findIndex((item) => item.agentId === agent.id && /Vercel|빌드|배포|대기열|INITIALIZING/.test(item.message))
    : -1;
  if (replaceIndex >= 0) {
    const previous = state.log[replaceIndex];
    state.log = state.log.filter((item, index) =>
      index === replaceIndex || !(item.agentId === agent.id && /Vercel|빌드|배포|대기열|INITIALIZING/.test(item.message)),
    );
    state.log[replaceIndex] = {
      ...previous,
      time: new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }),
      message: input.message,
    };
    await writeState(state);
    return state.log[replaceIndex];
  }

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }),
    departmentId: department.id,
    agentId: agent.id,
    agentName: agent.name,
    message: input.message,
  };
  state.log.unshift(entry);
  state.log = state.log.slice(0, 30);
  state.completedToday += 1;

  await writeState(state);
  return entry;
}

export async function reportFailure(input: {
  departmentId: string;
  agentId: string;
  message: string;
  incidentKey?: string;
}): Promise<LogEntry | null> {
  const state = await readState();
  const department = state.departments.find((d) => d.id === input.departmentId);
  if (!department) return null;
  const agent = department.agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  agent.status = "offline";
  agent.task = `⚠ ${input.message}`;

  // 같은 플랫폼에서 같은 오류가 반복되면 상태만 갱신하고
  // 작업 로그에는 최초 발생 1회만 남긴다.
  const failureKey = input.incidentKey ?? `${input.departmentId}:${input.agentId}`;
  if (state.failureByKey[failureKey] === input.message) {
    await writeState(state);
    return null;
  }
  state.failureByKey[failureKey] = input.message;

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }),
    departmentId: department.id,
    agentId: agent.id,
    agentName: agent.name,
    message: `⚠ ${input.message}`,
  };
  state.log.unshift(entry);
  state.log = state.log.slice(0, 30);

  await writeState(state);
  return entry;
}

export async function reorderAgents(
  departmentId: string,
  orderedAgentIds: string[],
): Promise<boolean> {
  const state = await readState();
  const department = state.departments.find((d) => d.id === departmentId);
  if (!department) return false;

  const byId = new Map(department.agents.map((a) => [a.id, a]));
  const reordered = orderedAgentIds
    .map((id) => byId.get(id))
    .filter((a): a is (typeof department.agents)[number] => Boolean(a));

  // 혹시 빠진 직원이 있으면(동기화 문제 등) 맨 뒤에 그대로 붙여 잃어버리지 않게 한다.
  for (const agent of department.agents) {
    if (!orderedAgentIds.includes(agent.id)) reordered.push(agent);
  }

  department.agents = reordered;
  await writeState(state);
  return true;
}

export async function moveAgent(
  fromDepartmentId: string,
  toDepartmentId: string,
  agentId: string,
  beforeAgentId?: string | null,
): Promise<boolean> {
  const state = await readState();
  const from = state.departments.find((department) => department.id === fromDepartmentId);
  const to = state.departments.find((department) => department.id === toDepartmentId);
  if (!from || !to) return false;
  const agentIndex = from.agents.findIndex((agent) => agent.id === agentId);
  if (agentIndex === -1) return false;

  const [agent] = from.agents.splice(agentIndex, 1);
  const existingIndex = to.agents.findIndex((candidate) => candidate.id === agentId);
  if (existingIndex !== -1) to.agents.splice(existingIndex, 1);
  const beforeIndex = beforeAgentId
    ? to.agents.findIndex((candidate) => candidate.id === beforeAgentId)
    : -1;
  if (beforeIndex === -1) to.agents.push(agent);
  else to.agents.splice(beforeIndex, 0, agent);
  await writeState(state);
  return true;
}

export async function addSourcedProducts(
  products: Array<{
    url: string;
    title: string;
    price: string | null;
    image: string | null;
    images?: string[];
    options?: string[];
    optionGroups?: SourcedProduct["optionGroups"];
    variants?: SourcedProduct["variants"];
    detailImages?: string[];
    specs?: Record<string, string>;
    description?: string | null;
  }>,
): Promise<{ added: SourcedProduct[]; updatedCount: number }> {
  const state = await readState();
  const now = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
  const canonicalUrl = (value: string) => {
    try {
      const url = new URL(value);
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "NaPm"].forEach((key) => url.searchParams.delete(key));
      url.hash = "";
      if (["m.abcmart.a-rt.com", "abcmart.a-rt.com"].includes(url.hostname)) {
        const productNo = url.searchParams.get("prdtNo");
        if (productNo) return `https://abcmart.a-rt.com/product/new?prdtNo=${productNo}`;
      }
      return url.href;
    } catch {
      return value.trim();
    }
  };

  const byUrl = new Map(state.sourcedProducts.map((p) => [canonicalUrl(p.url), p]));
  const added: SourcedProduct[] = [];
  let updatedCount = 0;

  for (const product of products) {
    const normalizedUrl = canonicalUrl(product.url);
    const existing = byUrl.get(normalizedUrl);
    if (existing) {
      // 같은 상품을 다시 소싱하면 최신 정보로 덮어쓴다 (사이트 규칙이
      // 개선됐을 때 예전 부실한 데이터가 그대로 남아있지 않도록).
      existing.title = product.title;
      existing.price = product.price;
      existing.image = product.image;
      existing.images = product.images;
      existing.options = product.options;
      existing.optionGroups = product.optionGroups;
      existing.variants = product.variants;
      existing.detailImages = product.detailImages;
      existing.specs = product.specs;
      existing.description = product.description;
      existing.scrapedAt = now;
      existing.revision = (existing.revision ?? 1) + 1;
      updatedCount++;
      continue;
    }
    const entry: SourcedProduct = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: normalizedUrl,
      title: product.title,
      price: product.price,
      image: product.image,
      images: product.images,
      options: product.options,
      optionGroups: product.optionGroups,
      variants: product.variants,
      detailImages: product.detailImages,
      specs: product.specs,
      description: product.description,
      scrapedAt: now,
      revision: 1,
    };
    state.sourcedProducts.unshift(entry);
    byUrl.set(normalizedUrl, entry);
    added.push(entry);
  }

  state.sourcedProducts = state.sourcedProducts.slice(0, 200);

  if (added.length > 0 || updatedCount > 0) {
    const department = state.departments.find((d) => d.id === "store");
    const agent = department?.agents.find((a) => a.id === "s1");
    const summary = [
      added.length > 0 ? `신규 ${added.length}건` : null,
      updatedCount > 0 ? `갱신 ${updatedCount}건` : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (agent) {
      agent.status = "active";
      agent.task = `신상품 후보 스캔 - 방금 ${summary}`;
    }
    const duplicateSourcing = state.log.some((item) => item.agentId === "s1" && item.message === `확장프로그램으로 상품 ${summary}`);
    if (duplicateSourcing) {
      await writeState(state);
      return { added, updatedCount };
    }
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: now,
      departmentId: "store",
      agentId: "s1",
      agentName: agent?.name ?? "상품소싱이",
      message: `확장프로그램으로 상품 ${summary}`,
    };
    state.log.unshift(logEntry);
    state.log = state.log.slice(0, 30);
    state.completedToday += 1;
  }

  await writeState(state);
  return { added, updatedCount };
}

export async function getSourcedProducts(): Promise<SourcedProduct[]> {
  const state = await readState();
  return state.sourcedProducts;
}

export async function removeSourcedProduct(id: string): Promise<boolean> {
  const state = await readState();
  const target = state.sourcedProducts.find((p) => p.id === id);
  if (!target) return false;
  const canonicalUrl = (value: string) => {
    try {
      const url = new URL(value);
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "NaPm"].forEach((key) => url.searchParams.delete(key));
      url.hash = "";
      return url.href;
    } catch {
      return value.trim();
    }
  };
  const before = state.sourcedProducts.length;
  const targetUrl = canonicalUrl(target.url);
  state.sourcedProducts = state.sourcedProducts.filter((p) => p.id !== id && canonicalUrl(p.url) !== targetUrl);
  if (state.sourcedProducts.length === before) return false;
  await writeState(state);
  return true;
}

// 소싱한 상품에서 사진 한 장만 지운다.
// (어떤 사진이 상세페이지인지 코드로 추측하지 않고 전부 가져오는 대신,
// 필요 없는 사진은 사람이 직접 지우는 방식)
export async function removeSourcedProductImage(
  productId: string,
  imageUrl: string,
): Promise<boolean> {
  const state = await readState();
  const product = state.sourcedProducts.find((p) => p.id === productId);
  if (!product) return false;

  const before = (product.images ?? []).length;
  product.images = (product.images ?? []).filter((img) => img !== imageUrl);
  if (product.image === imageUrl) {
    product.image = product.images[0] ?? null;
  }
  if (product.images.length === before && product.image !== null) return false;

  await writeState(state);
  return true;
}

export async function clearSourcedProducts(): Promise<void> {
  const state = await readState();
  state.sourcedProducts = [];
  await writeState(state);
}

export function isSharedStorageConfigured(): boolean {
  return getRedis() !== null;
}
