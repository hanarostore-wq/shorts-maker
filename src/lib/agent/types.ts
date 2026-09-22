// 에이전트가 브라우저에서 실제로 수행하는 작업과, 그 중 사람 승인이 필요한
// 동작을 표현하는 타입들. 관제실(Next.js)과 데스크톱 앱(Electron)이
// 같은 타입을 공유한다.

/** 에이전트가 수행할 수 있는 동작의 종류. */
export type ActionKind =
  // --- 읽기 전용: 되돌릴 게 없으므로 승인 대상이 아니다 ---
  | "browse" // 페이지 열기/이동
  | "scrape" // 화면에서 정보 수집
  | "watch_price" // 가격 추적
  // --- 쓰기: 외부에 흔적이 남는다. 정책 엔진을 반드시 거친다 ---
  | "listing_create" // 상품 등록
  | "listing_update" // 상품 정보/가격/재고 수정
  | "order_place" // 발주
  | "payment" // 결제
  | "message_send"; // CS 답변·고객 메시지 발송

/** 되돌리기 어려워서 승인 정책을 반드시 거쳐야 하는 동작들. */
export const WRITE_ACTIONS: readonly ActionKind[] = [
  "listing_create",
  "listing_update",
  "order_place",
  "payment",
  "message_send",
];

export function isWriteAction(kind: ActionKind): boolean {
  return WRITE_ACTIONS.includes(kind);
}

/** 사람이 읽을 수 있는 동작 이름 (관제실 UI·승인 대기함에 표시). */
export const ACTION_LABELS: Record<ActionKind, string> = {
  browse: "페이지 열기",
  scrape: "정보 수집",
  watch_price: "가격 추적",
  listing_create: "상품 등록",
  listing_update: "상품 수정",
  order_place: "발주",
  payment: "결제",
  message_send: "메시지 발송",
};

/**
 * 에이전트가 실행하려는 단일 동작.
 *
 * amountKrw / itemCount 는 승인 정책의 임계값 판정에 쓰인다. 금액이 있는
 * 동작인데 값을 알 수 없으면 null 로 두고, 정책 엔진은 이를 "임계값을 넘은
 * 것"과 동일하게 취급해 사람에게 올린다(모르면 물어본다).
 */
export interface AgentAction {
  id: string;
  kind: ActionKind;
  /** 어느 사이트에서 벌어지는 일인지 (coupang, naver, abcmart ...) */
  site: string;
  /** 실제 동작이 일어나는 페이지 */
  url: string;
  /** 관제실에 그대로 보여줄 한 줄 설명 */
  summary: string;
  /** 돈이 오가는 동작이면 원화 금액. 모르면 null. */
  amountKrw: number | null;
  /** 몇 건을 한 번에 처리하는지. 단건이면 1. */
  itemCount: number;
  /** 실행 직전 화면 스냅샷 (승인자가 무엇을 승인하는지 눈으로 보도록) */
  screenshot?: string | null;
  /** 실행에 필요한 세부 정보 (셀렉터, 입력값 등) */
  payload?: Record<string, unknown>;
}

export type TaskStatus =
  | "queued" // 큐에 들어감
  | "running" // 에이전트가 실행 중
  | "waiting_approval" // 승인 대기함에서 사람을 기다림
  | "done"
  | "failed"
  | "cancelled";

/** 관제실에서 내린 지시 하나. 여러 동작으로 쪼개져 실행된다. */
export interface AgentTask {
  id: string;
  /** 어느 직원(에이전트)에게 맡긴 일인지 — 기존 관제실의 agent.id */
  agentId: string;
  departmentId: string;
  /** 사람이 내린 지시 원문 */
  instruction: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** 실행 과정에서 쌓인 기록 */
  steps: TaskStep[];
  error?: string | null;
}

export interface TaskStep {
  at: string;
  kind: ActionKind;
  summary: string;
  /** 정책 판정 결과 — 자동 실행됐는지, 사람이 승인했는지 */
  decision?: ApprovalDecision["decision"] | null;
  ok: boolean;
}

export type ApprovalState = "pending" | "approved" | "rejected" | "expired";

/** 승인 대기함에 올라온 항목. */
export interface ApprovalRequest {
  id: string;
  taskId: string;
  agentId: string;
  action: AgentAction;
  /** 왜 사람에게 올라왔는지 (임계값 초과, 금액 불명, 자동승인 꺼짐 ...) */
  reason: string;
  state: ApprovalState;
  createdAt: string;
  /** 승인/거부한 사람과 시각 */
  decidedBy?: string | null;
  decidedAt?: string | null;
}

/**
 * 동작 종류별 자동 승인 규칙.
 *
 * autoApprove 가 false 면 임계값과 무관하게 항상 사람에게 올린다. 새로운
 * 동작 종류가 추가됐을 때 아무도 모르게 자동 실행되는 일이 없도록,
 * 기본값은 언제나 잠금(false)이다.
 */
export interface ActionPolicy {
  autoApprove: boolean;
  /** 이 금액 이하면 자동 실행. null 이면 금액 기준을 쓰지 않는다. */
  maxAmountKrw: number | null;
  /** 한 번에 이 건수 이하면 자동 실행. */
  maxItemCount: number;
  /**
   * 하루 누적 상한. 임계값 아래 동작을 무한 반복해서 큰 금액이 자동으로
   * 나가는 것을 막는다. 누적이 이 값을 넘으면 그 뒤로는 전부 사람에게 올린다.
   */
  dailyAmountCapKrw: number | null;
  /** 하루 누적 실행 건수 상한. */
  dailyCountCap: number | null;
}

export type PolicyConfig = Record<ActionKind, ActionPolicy>;

/** 오늘 자동 실행된 누적량 (일일 상한 판정에 쓰인다). */
export interface DailyUsage {
  /** 'YYYY-MM-DD' (Asia/Seoul) — 날짜가 바뀌면 누적이 초기화된다. */
  date: string;
  amountKrw: Record<string, number>;
  count: Record<string, number>;
}

export interface ApprovalDecision {
  decision: "auto" | "manual";
  reason: string;
}

/**
 * 사람이 승인해 준 동작을 워커가 한 번 실행할 수 있게 해 주는 표.
 *
 * 승인하면 작업이 다시 큐에 올라가고 워커가 이어받는데, 그때 관문을 또
 * 만나면 영원히 못 지나간다. 그래서 승인 시 이 표를 한 장 발행하고,
 * 같은 작업의 같은 종류 동작이 관문에 오면 한 번만 통과시킨다.
 *
 * 한 장은 한 번만 쓰인다. 승인 한 번으로 같은 동작이 반복 실행되지 않는다.
 */
export interface ApprovalGrant {
  id: string;
  taskId: string;
  kind: ActionKind;
  approvalId: string;
  grantedBy: string;
  grantedAt: string;
  /** 오래된 표가 남아 나중에 엉뚱하게 쓰이지 않도록 유효기한을 둔다. */
  expiresAt: string;
}
