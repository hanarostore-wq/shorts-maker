import type {
  ActionKind,
  ActionPolicy,
  AgentAction,
  ApprovalDecision,
  DailyUsage,
  PolicyConfig,
} from "./types";
import { isWriteAction } from "./types";

/**
 * 기본 정책.
 *
 * 쓰기 동작은 전부 autoApprove: false 로 시작한다. 관제실에서 담당자가
 * 직접 켜기 전까지는 발주/결제/메시지가 자동으로 나가지 않는다. 임계값은
 * 켰을 때 적용될 초기값이다.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  // 읽기 전용 — 승인 개념이 없다.
  browse: { autoApprove: true, maxAmountKrw: null, maxItemCount: Number.MAX_SAFE_INTEGER, dailyAmountCapKrw: null, dailyCountCap: null },
  scrape: { autoApprove: true, maxAmountKrw: null, maxItemCount: Number.MAX_SAFE_INTEGER, dailyAmountCapKrw: null, dailyCountCap: null },
  watch_price: { autoApprove: true, maxAmountKrw: null, maxItemCount: Number.MAX_SAFE_INTEGER, dailyAmountCapKrw: null, dailyCountCap: null },

  // 쓰기 — 기본 잠금.
  listing_create: {
    autoApprove: false,
    maxAmountKrw: null,
    maxItemCount: 10,
    dailyAmountCapKrw: null,
    dailyCountCap: 50,
  },
  listing_update: {
    autoApprove: false,
    maxAmountKrw: null,
    maxItemCount: 30,
    dailyAmountCapKrw: null,
    dailyCountCap: 200,
  },
  order_place: {
    autoApprove: false,
    maxAmountKrw: 100_000,
    maxItemCount: 5,
    dailyAmountCapKrw: 500_000,
    dailyCountCap: 20,
  },
  payment: {
    autoApprove: false,
    maxAmountKrw: 50_000,
    maxItemCount: 1,
    dailyAmountCapKrw: 200_000,
    dailyCountCap: 10,
  },
  message_send: {
    autoApprove: false,
    maxAmountKrw: null,
    maxItemCount: 5,
    dailyAmountCapKrw: null,
    dailyCountCap: 50,
  },
};

export function todayInSeoul(): string {
  // 'YYYY-MM-DD' 형태. 관제실·에이전트 모두 한국 시간 기준으로 하루를 센다.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function emptyUsage(): DailyUsage {
  return { date: todayInSeoul(), amountKrw: {}, count: {} };
}

/** 날짜가 바뀌었으면 누적을 초기화한 사본을 돌려준다. */
export function rollUsage(usage: DailyUsage | null | undefined): DailyUsage {
  const today = todayInSeoul();
  if (!usage || usage.date !== today) return emptyUsage();
  return usage;
}

/**
 * 이 동작을 자동으로 실행해도 되는지 판정한다.
 *
 * 판정에 쓰이는 모든 조건은 "통과해야 자동"이다. 하나라도 걸리면 사람에게
 * 올린다. 조건을 모르는 경우(금액 불명 등)도 걸린 것으로 취급한다.
 */
export function evaluateAction(
  action: AgentAction,
  config: PolicyConfig,
  usage: DailyUsage,
): ApprovalDecision {
  const policy: ActionPolicy | undefined = config[action.kind];

  // 정책에 없는 동작 종류는 안전한 쪽으로: 사람에게 올린다.
  if (!policy) {
    return { decision: "manual", reason: "정책이 정의되지 않은 동작" };
  }

  if (!isWriteAction(action.kind)) {
    return { decision: "auto", reason: "읽기 전용 동작" };
  }

  if (!policy.autoApprove) {
    return { decision: "manual", reason: "자동 승인이 꺼져 있음" };
  }

  // --- 건당 임계값 ---
  if (action.itemCount > policy.maxItemCount) {
    return {
      decision: "manual",
      reason: `건수 초과 (${action.itemCount}건 > 자동 ${policy.maxItemCount}건)`,
    };
  }

  if (policy.maxAmountKrw !== null) {
    if (action.amountKrw === null) {
      // 금액 기준이 걸린 동작인데 금액을 읽어내지 못했다면, 임계값을
      // 넘었는지 알 수 없으므로 넘은 것으로 본다.
      return { decision: "manual", reason: "금액을 확인하지 못함" };
    }
    if (action.amountKrw > policy.maxAmountKrw) {
      return {
        decision: "manual",
        reason: `금액 초과 (${formatKrw(action.amountKrw)} > 자동 ${formatKrw(policy.maxAmountKrw)})`,
      };
    }
  }

  // --- 일일 누적 상한 ---
  // 임계값 아래 동작을 반복해서 큰 금액·건수가 자동으로 빠져나가는 것을 막는다.
  const fresh = rollUsage(usage);

  if (policy.dailyCountCap !== null) {
    const used = fresh.count[action.kind] ?? 0;
    if (used + action.itemCount > policy.dailyCountCap) {
      return {
        decision: "manual",
        reason: `일일 건수 상한 도달 (오늘 ${used}건 / 상한 ${policy.dailyCountCap}건)`,
      };
    }
  }

  if (policy.dailyAmountCapKrw !== null) {
    const used = fresh.amountKrw[action.kind] ?? 0;
    const next = used + (action.amountKrw ?? 0);
    if (next > policy.dailyAmountCapKrw) {
      return {
        decision: "manual",
        reason: `일일 금액 상한 도달 (오늘 ${formatKrw(used)} / 상한 ${formatKrw(policy.dailyAmountCapKrw)})`,
      };
    }
  }

  return { decision: "auto", reason: "임계값 이내" };
}

/**
 * 실제로 실행된 동작을 누적에 반영한다.
 *
 * 사람이 승인한 건도 누적에 포함한다. 그래야 "승인만 계속 누르다 보니
 * 하루에 얼마가 나갔는지 아무도 모르는" 상태가 되지 않는다.
 */
export function recordUsage(usage: DailyUsage, action: AgentAction): DailyUsage {
  const fresh = rollUsage(usage);
  return {
    date: fresh.date,
    amountKrw: {
      ...fresh.amountKrw,
      [action.kind]: (fresh.amountKrw[action.kind] ?? 0) + (action.amountKrw ?? 0),
    },
    count: {
      ...fresh.count,
      [action.kind]: (fresh.count[action.kind] ?? 0) + action.itemCount,
    },
  };
}

export function formatKrw(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

/**
 * 저장돼 있던 정책을 기본값과 병합한다. 새 동작 종류가 코드에 추가됐는데
 * 저장된 설정엔 없는 경우, 그 동작은 기본값(잠금)을 따르게 된다.
 */
export function mergePolicy(stored: Partial<PolicyConfig> | null | undefined): PolicyConfig {
  const merged = { ...DEFAULT_POLICY };
  if (!stored) return merged;
  for (const key of Object.keys(DEFAULT_POLICY) as ActionKind[]) {
    const override = stored[key];
    if (override) merged[key] = { ...DEFAULT_POLICY[key], ...override };
  }
  return merged;
}
