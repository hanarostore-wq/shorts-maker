export type JevAction = "BUY" | "SELL" | "HOLD" | "KILL";

export type JevDecision = {
  action: JevAction;
  probabilities: Record<JevAction, number>;
  confidence: number;
  provider: "JEV" | "RULES_ONLY";
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
};

type TypeSafeAnswer = {
  type?: string;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  noul?: number;
};

type TypeSafeResponse = { model?: string; answers?: Record<string, TypeSafeAnswer>; usage?: unknown };

const API_URL = process.env.TYPESAFE_API_URL || "https://api.typesafe.ai/v1/systemone";
const ACTIONS: JevAction[] = ["BUY", "SELL", "HOLD", "KILL"];
const emptyProbabilities = (): Record<JevAction, number> => ({ BUY: 0, SELL: 0, HOLD: 1, KILL: 0 });

function fallback(code: string, message: string): JevDecision {
  return { action: "HOLD", probabilities: emptyProbabilities(), confidence: 0, provider: "RULES_ONLY", latencyMs: 0, errorCode: code, errorMessage: message };
}

function normalize(raw: TypeSafeAnswer | undefined, latencyMs: number): JevDecision {
  const source = raw?.probabilities || {};
  const probabilities = ACTIONS.reduce((out, action) => { out[action] = Math.max(0, Number(source[action] || 0)); return out; }, {} as Record<JevAction, number>);
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return fallback("TYPESAFE_JEV_EMPTY_ANSWER", "TypeSafe Jev가 판단 확률을 반환하지 않았습니다");
  ACTIONS.forEach((action) => { probabilities[action] = probabilities[action] / total; });
  const requested = String(raw?.choice || "HOLD").toUpperCase() as JevAction;
  const action = ACTIONS.includes(requested) ? requested : "HOLD";
  return { action, probabilities, confidence: Math.max(0, Math.min(1, Number(raw?.confidence ?? Math.max(...Object.values(probabilities))))), provider: "JEV", latencyMs };
}

export async function askJev(state: Record<string, unknown>): Promise<JevDecision> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return fallback("TYPESAFE_JEV_API_KEY_MISSING", "TypeSafe Jev API 키가 서버 환경변수에 없습니다. RULES_ONLY로 전환합니다");
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state,
        questions: {
          action: {
            type: "choice",
            instructions: "Based only on the supplied market state, choose the next paper-trading action. Do not calculate order size or execute an order.",
            criteria: {
              BUY: "Buy-side pressure and trend support a small post-only paper buy.",
              SELL: "Sell-side pressure or inventory risk supports a small post-only paper sell.",
              HOLD: "Evidence is mixed, weak, stale, or not strong enough for a trade.",
              KILL: "The market data or execution conditions are unsafe; stop quoting.",
            },
          },
          data_quality: {
            type: "noul",
            instructions: "Is the market state fresh, coherent, and usable for a paper-trading judgment?",
            criteria: { true: "Fresh ticker and orderbook with acceptable spread and latency.", false: "Stale, missing, contradictory, or unsafe data." },
          },
        },
        signal: { purpose: "paper_trading_judgment_only", no_live_order: true },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.json().catch(() => ({})) as TypeSafeResponse & { error?: { message?: string } };
    if (!response.ok) {
      const code = response.status === 401 ? "TYPESAFE_JEV_UNAUTHORIZED" : response.status === 429 ? "TYPESAFE_JEV_RATE_LIMITED" : response.status === 529 ? "TYPESAFE_JEV_OVERLOADED" : "TYPESAFE_JEV_HTTP_ERROR";
      return fallback(code, `TypeSafe Jev API 오류 ${response.status}: ${raw.error?.message || "응답을 확인하지 못했습니다"}`);
    }
    const decision = normalize(raw.answers?.action, Date.now() - started);
    const quality = Number(raw.answers?.data_quality?.noul ?? 1);
    if (quality < 0.55) return { ...decision, action: "HOLD", errorCode: "TYPESAFE_JEV_DATA_QUALITY_LOW", errorMessage: "Jev가 데이터 품질을 낮게 판단해 PAPER 주문을 보류했습니다" };
    return decision;
  } catch (error) {
    const code = error instanceof DOMException && error.name === "AbortError" ? "TYPESAFE_JEV_TIMEOUT" : "TYPESAFE_JEV_NETWORK_ERROR";
    return fallback(code, error instanceof Error ? error.message : "TypeSafe Jev 호출 중 네트워크 오류가 발생했습니다");
  } finally {
    clearTimeout(timeout);
  }
}

export function rulesOnlyDecision(): JevDecision { return fallback("TYPESAFE_JEV_API_KEY_MISSING", "TypeSafe Jev 연결 전이라 안전한 규칙 판단을 사용합니다"); }
