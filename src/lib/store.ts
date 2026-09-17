import { Redis } from "@upstash/redis";
import { departments as initialDepartments, projects } from "./mock-data";
import { getAgentPlatforms } from "./agentIntegrations";
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
  scrapedAt: string;
}

interface State {
  departments: Department[];
  projects: Project[];
  log: LogEntry[];
  completedToday: number;
  sourcedProducts: SourcedProduct[];
}

const STATE_KEY = "shorts-maker:state";

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Redis 저장소가 없으면(로컬 개발 등) 메모리로 대체 동작한다.
let memoryState: State | null = null;

function defaultState(): State {
  return {
    departments: structuredClone(initialDepartments),
    projects: structuredClone(projects),
    log: [],
    completedToday: 0,
    sourcedProducts: [],
  };
}

// 실제 연동이 없는 직원에게 예전에 잘못 찍혔던 "이상발생" 표시가
// 영원히 남아있지 않도록, 매번 상태를 읽을 때 원래 모습으로 되돌린다.
function healState(state: State): State {
  if (!state.sourcedProducts) state.sourcedProducts = [];
  for (const department of state.departments) {
    const fresh = initialDepartments.find((d) => d.id === department.id);
    if (!fresh) continue;
    for (const agent of department.agents) {
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

export async function getState(): Promise<State> {
  return readState();
}

export async function reportCompletion(input: {
  departmentId: string;
  agentId: string;
  message: string;
}): Promise<LogEntry | null> {
  const state = await readState();
  const department = state.departments.find((d) => d.id === input.departmentId);
  if (!department) return null;
  const agent = department.agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  agent.status = "active";
  agent.task = input.message;

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
}): Promise<LogEntry | null> {
  const state = await readState();
  const department = state.departments.find((d) => d.id === input.departmentId);
  if (!department) return null;
  const agent = department.agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  agent.status = "offline";
  agent.task = `⚠ ${input.message}`;

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

export async function addSourcedProducts(
  products: Array<{ url: string; title: string; price: string | null; image: string | null }>,
): Promise<SourcedProduct[]> {
  const state = await readState();
  const now = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });

  const existingUrls = new Set(state.sourcedProducts.map((p) => p.url));
  const added: SourcedProduct[] = [];

  for (const product of products) {
    if (existingUrls.has(product.url)) continue;
    const entry: SourcedProduct = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: product.url,
      title: product.title,
      price: product.price,
      image: product.image,
      scrapedAt: now,
    };
    state.sourcedProducts.unshift(entry);
    existingUrls.add(product.url);
    added.push(entry);
  }

  state.sourcedProducts = state.sourcedProducts.slice(0, 200);

  if (added.length > 0) {
    const department = state.departments.find((d) => d.id === "store");
    const agent = department?.agents.find((a) => a.id === "s1");
    if (agent) {
      agent.status = "active";
      agent.task = `신상품 후보 스캔 - 방금 ${added.length}건 수집`;
    }
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: now,
      departmentId: "store",
      agentId: "s1",
      agentName: agent?.name ?? "상품소싱이",
      message: `확장프로그램으로 상품 ${added.length}건 수집`,
    };
    state.log.unshift(logEntry);
    state.log = state.log.slice(0, 30);
    state.completedToday += 1;
  }

  await writeState(state);
  return added;
}

export async function getSourcedProducts(): Promise<SourcedProduct[]> {
  const state = await readState();
  return state.sourcedProducts;
}

export function isSharedStorageConfigured(): boolean {
  return getRedis() !== null;
}
