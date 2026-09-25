import { Redis } from "@upstash/redis";
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

export function getSharedRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const getRedis = getSharedRedis;

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
  const existingDepartmentIds = new Set(state.departments.map((department) => department.id));
  for (const freshDepartment of initialDepartments) {
    if (!existingDepartmentIds.has(freshDepartment.id)) {
      state.departments.push(structuredClone(freshDepartment));
    }
  }
  for (const department of state.departments) {
    const fresh = initialDepartments.find((d) => d.id === department.id);
    if (!fresh) continue;
    if (department.id === 'coin' || department.id === 'stock') {
      const allowed = new Map(fresh.agents.map(a => [a.id,a]));
      // One-time roster migration; later drag order remains user-owned.
      const migrateAnalyticsOrder=!department.agents.some(a=>a.id.endsWith('_analytics'));

      department.agents = department.agents.filter(a => allowed.has(a.id)).map(a => {
        const current=allowed.get(a.id)!;
        return a.id.includes('_') ? structuredClone(current) : {...a,name:current.name,...(['c11','c12','t11','t12'].includes(a.id)?{task:current.task}:{})};
      });
      if(migrateAnalyticsOrder){const byId=new Map(department.agents.map(a=>[a.id,a]));department.agents=fresh.agents.map(a=>byId.get(a.id)||structuredClone(a));}
    }
    const existingIds = new Set(department.agents.map((agent) => agent.id));
    for (const freshAgent of fresh.agents) {
      if (!existingIds.has(freshAgent.id)) {
        department.agents.push(structuredClone(freshAgent));
      }
    }

    // 블로그부서는 단일 '네이버 블로거' 체계로 강제 동기화한다.\n    // Redis에 남아 있는 예전 4인 블로그 조직이 다시 나타나지 않게 한다.\n    if (department.id === "blog") {\n      const byId = new Map(department.agents.map((a) => [a.id, a]));\n      department.agents = fresh.agents.map((fa) => {\n        const existing = byId.get(fa.id);\n        return existing ? { ...existing, name: fa.name, task: fa.task } : structuredClone(fa);\n      });\n    }\n\n    // 쇼츠부서는 직원 이름·업무·상태를 항상 최신 mock-data 기준으로 강제 동기화한다.
    // (Upstash Redis에 구버전 데이터가 남아 있어도 관제실 화면이 항상 최신을 보여주도록)
    if (department.id === "shorts") {
      // 순서도 fresh 기준으로 재정렬
      const byId = new Map(department.agents.map((a) => [a.id, a]));
      const reordered = fresh.agents
        .map((fa) => {
          const existing = byId.get(fa.id);
          if (existing) {
            // 이름·task·status를 fresh 기준으로 덮어쓴다
            existing.name = fa.name;
            existing.task = fa.task;
            existing.status = fa.status;
            return existing;
          }
          return structuredClone(fa);
        });
      // fresh에 없는 구버전 직원은 제거
      department.agents = reordered;
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
  if(coinProject){coinProject.agentCount=state.departments.find(d=>d.id==='coin')?.agents.length ?? 0;coinProject.leadAgent='Jev 매수근거';}
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
  const state = await readState();
  const [pendingApprovals, tasks, policy] = await Promise.all([
    listApprovals({ state: "pending" }),
    listTasks(),
    getPolicy(),
  ]);
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
