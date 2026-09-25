import { Redis } from "@upstash/redis";
import type {
  AgentAction,
  AgentTask,
  ApprovalGrant,
  ApprovalRequest,
  DailyUsage,
  PolicyConfig,
  TaskStatus,
} from "./types";
import { ACTION_LABELS } from "./types";
import {
  emptyUsage,
  evaluateAction,
  mergePolicy,
  recordUsage,
  rollUsage,
} from "./policy";

// 관제실 대시보드 상태(shorts-maker:state)와 키를 분리한다. 에이전트가
// 초 단위로 큐를 갱신하는 동안 대시보드 상태를 통째로 덮어쓰는 일이
// 없도록 하기 위함이다.
const AGENT_KEY = "shorts-maker:agent";

interface AgentState {
  tasks: AgentTask[];
  approvals: ApprovalRequest[];
  policy: PolicyConfig | null;
  usage: DailyUsage;
  /** 사람이 승인해 준 동작을 워커가 한 번 실행할 수 있게 하는 표들. */
  grants: ApprovalGrant[];
}

// 승인 표의 유효기간. 담당자가 승인한 뒤 워커가 이어받기까지는 보통 몇 초면
// 되지만, 앱이 꺼져 있었을 수도 있어 넉넉히 둔다. 그래도 하루 지난 표가
// 남아 엉뚱한 때 쓰이는 일은 막는다.
const GRANT_TTL_MS = 30 * 60 * 1000;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Redis가 없으면(로컬 개발) 메모리로 대체한다. 기존 store.ts와 동일한 방식.
let memoryState: AgentState | null = null;

function defaultState(): AgentState {
  return { tasks: [], approvals: [], policy: null, usage: emptyUsage(), grants: [] };
}

async function readState(): Promise<AgentState> {
  const redis = getRedis();
  if (!redis) {
    if (!memoryState) memoryState = defaultState();
    return {
      tasks: memoryState.tasks ?? [],
      approvals: memoryState.approvals ?? [],
      policy: memoryState.policy ?? null,
      usage: rollUsage(memoryState.usage),
      grants: (memoryState.grants ?? []).filter((g) => Date.parse(g.expiresAt) > Date.now()),
    };
  }
  const stored = await redis.get<AgentState>(AGENT_KEY);
  if (!stored) return defaultState();
  // 저장된 값이 오래돼 필드가 비어 있을 수 있으므로 형태를 보정한다.
  return {
    tasks: stored.tasks ?? [],
    approvals: stored.approvals ?? [],
    policy: stored.policy ?? null,
    usage: rollUsage(stored.usage),
    // 기한이 지난 표는 읽을 때마다 버린다.
    grants: (stored.grants ?? []).filter((g) => Date.parse(g.expiresAt) > Date.now()),
  };
}

async function writeState(state: AgentState): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryState = state;
    return;
  }
  await redis.set(AGENT_KEY, state);
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 현재 적용 중인 승인 정책. 저장된 게 없으면 기본값(쓰기 전부 잠금). */
export async function getPolicy(): Promise<PolicyConfig> {
  const state = await readState();
  return mergePolicy(state.policy);
}

export async function updatePolicy(patch: Partial<PolicyConfig>): Promise<PolicyConfig> {
  const state = await readState();
  const next = mergePolicy({ ...mergePolicy(state.policy), ...patch });
  state.policy = next;
  await writeState(state);
  return next;
}

export async function getUsage(): Promise<DailyUsage> {
  const state = await readState();
  return rollUsage(state.usage);
}

export async function listTasks(): Promise<AgentTask[]> {
  const state = await readState();
  return state.tasks;
}

export async function listApprovals(
  filter?: { state?: ApprovalRequest["state"] },
): Promise<ApprovalRequest[]> {
  const state = await readState();
  if (!filter?.state) return state.approvals;
  return state.approvals.filter((a) => a.state === filter.state);
}

/** 승인 대기함에서 사람이 제거한 요청을 영속 삭제한다. */
export async function removeApproval(approvalId: string): Promise<ApprovalRequest | null> {
  const state = await readState();
  const index = state.approvals.findIndex((approval) => approval.id === approvalId);
  if (index === -1) return null;
  const [removed] = state.approvals.splice(index, 1);
  const task = state.tasks.find((candidate) => candidate.id === removed.taskId);
  if (task && (task.status === "waiting_approval" || task.status === "queued")) {
    task.status = "cancelled";
    task.updatedAt = nowIso();
    task.error = "승인 대기함에서 삭제됨";
  }
  await writeState(state);
  return removed;
}

/** 관제실에서 새 지시를 큐에 넣는다. */
export async function enqueueTask(input: {
  agentId: string;
  departmentId: string;
  instruction: string;
}): Promise<AgentTask> {
  const state = await readState();
  const task: AgentTask = {
    id: newId(),
    agentId: input.agentId,
    departmentId: input.departmentId,
    instruction: input.instruction,
    status: "queued",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    steps: [],
  };
  state.tasks.unshift(task);
  // 무한정 쌓이지 않게 최근 100건만 유지한다 (기존 로그와 같은 방식).
  state.tasks = state.tasks.slice(0, 100);
  await writeState(state);
  return task;
}

/** 데스크톱 앱의 워커가 다음에 실행할 일을 하나 꺼내간다. */
export async function claimNextTask(agentId?: string): Promise<AgentTask | null> {
  const state = await readState();
  const task = state.tasks.find((t) => t.status === "queued" && (!agentId || t.agentId === agentId));
  if (!task) return null;
  task.status = "running";
  task.updatedAt = nowIso();
  await writeState(state);
  return task;
}

export async function setTaskStatus(
  taskId: string,
  status: TaskStatus,
  error?: string | null,
): Promise<AgentTask | null> {
  const state = await readState();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.status = status;
  task.updatedAt = nowIso();
  if (error !== undefined) task.error = error;
  await writeState(state);
  return task;
}

export type GateResult =
  | { allowed: true; reason: string }
  | { allowed: false; approval: ApprovalRequest };

/**
 * 에이전트가 쓰기 동작을 실행하기 직전에 반드시 통과해야 하는 관문.
 *
 * 자동 승인 조건을 만족하면 그 자리에서 허용하고 누적에 반영한다. 아니면
 * 승인 대기함에 올리고 거부한다. 이 함수를 거치지 않고 실행되는 쓰기
 * 동작이 없어야 정책이 의미를 갖는다.
 */
export async function gateAction(
  taskId: string,
  action: AgentAction,
): Promise<GateResult> {
  const state = await readState();
  const policy = mergePolicy(state.policy);
  const usage = rollUsage(state.usage);

  const task = state.tasks.find((t) => t.id === taskId);

  // 사람이 이미 승인해 준 동작이면 표를 한 장 쓰고 통과시킨다.
  // 표는 쓰는 즉시 사라지므로 승인 한 번으로 같은 동작이 반복되지 않는다.
  const grantIndex = state.grants.findIndex(
    (g) =>
      g.taskId === taskId &&
      g.kind === action.kind &&
      Date.parse(g.expiresAt) > Date.now(),
  );
  if (grantIndex !== -1) {
    const [grant] = state.grants.splice(grantIndex, 1);
    task?.steps.push({
      at: nowIso(),
      kind: action.kind,
      summary: action.summary,
      decision: "manual",
      ok: true,
    });
    if (task) task.updatedAt = nowIso();
    await writeState(state);
    return { allowed: true, reason: `${grant.grantedBy} 승인으로 통과` };
  }

  const verdict = evaluateAction(action, policy, usage);

  if (verdict.decision === "auto") {
    state.usage = recordUsage(usage, action);
    task?.steps.push({
      at: nowIso(),
      kind: action.kind,
      summary: action.summary,
      decision: "auto",
      ok: true,
    });
    if (task) task.updatedAt = nowIso();
    await writeState(state);
    return { allowed: true, reason: verdict.reason };
  }

  const approval: ApprovalRequest = {
    id: newId(),
    taskId,
    agentId: task?.agentId ?? "unknown",
    action,
    reason: verdict.reason,
    state: "pending",
    createdAt: nowIso(),
  };
  state.approvals.unshift(approval);
  state.approvals = state.approvals.slice(0, 200);
  if (task) {
    task.status = "waiting_approval";
    task.updatedAt = nowIso();
  }
  await writeState(state);
  return { allowed: false, approval };
}

/**
 * 승인 대기함의 항목을 처리한다.
 *
 * pending 상태일 때만 전이시킨다. 두 담당자가 같은 항목을 동시에 눌러도
 * 동작이 두 번 실행되지 않도록 하기 위한 것이다.
 */
export async function decideApproval(input: {
  approvalId: string;
  approve: boolean;
  decidedBy: string;
}): Promise<{ approval: ApprovalRequest; alreadyDecided: boolean } | null> {
  const state = await readState();
  const approval = state.approvals.find((a) => a.id === input.approvalId);
  if (!approval) return null;

  if (approval.state !== "pending") {
    return { approval, alreadyDecided: true };
  }

  approval.state = input.approve ? "approved" : "rejected";
  approval.decidedBy = input.decidedBy;
  approval.decidedAt = nowIso();

  const task = state.tasks.find((t) => t.id === approval.taskId);
  if (task) {
    // 승인하면 다시 큐에 올려 워커가 이어받게 한다. 실제 실행은 브라우저에서
    // 일어나므로 이 서버가 대신 해 줄 수 없다.
    task.status = input.approve ? "queued" : "cancelled";
    task.updatedAt = nowIso();
    task.steps.push({
      at: nowIso(),
      kind: approval.action.kind,
      summary: `${ACTION_LABELS[approval.action.kind]} — ${input.approve ? "승인" : "거부"} (${input.decidedBy})`,
      decision: "manual",
      ok: input.approve,
    });
  }

  // 사람이 승인한 건도 일일 누적에 포함한다. 승인 버튼만 계속 누르다가
  // 하루 총액을 놓치는 상황을 막기 위해서다.
  if (input.approve) {
    state.usage = recordUsage(rollUsage(state.usage), approval.action);

    // 워커가 이어받아 관문을 다시 만났을 때 한 번만 통과할 수 있게 표를
    // 발행한다. 이게 없으면 승인해도 같은 자리에서 또 막혀 영영 못 지나간다.
    state.grants.push({
      id: newId(),
      taskId: approval.taskId,
      kind: approval.action.kind,
      approvalId: approval.id,
      grantedBy: input.decidedBy,
      grantedAt: nowIso(),
      expiresAt: new Date(Date.now() + GRANT_TTL_MS).toISOString(),
    });
  }

  await writeState(state);
  return { approval, alreadyDecided: false };
}

export function isAgentStorageConfigured(): boolean {
  return getRedis() !== null;
}
