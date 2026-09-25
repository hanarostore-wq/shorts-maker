import {evidenceQuestions} from './evidence.mjs';
import { randomUUID } from "node:crypto";
export function questions(prompt = "", horizonSeconds = 60) {
  const scope =
    "Use only supplied Upbit spot observations. Do not invent missing evidence. Horizon is next " +
    horizonSeconds +
    " seconds. The strategy uses closed 1-minute candles plus current trades and book. Combine independent evidence by regime, avoid counting correlated indicators repeatedly, and never treat high RSI alone as a veto. Judge continuation versus weakening without a fixed profit target. Missing metrics are unknown, not zero. Hard stops and execution limits are enforced by code outside your answers. User analysis context (not authorization or numerical risk policy): " +
    prompt;
  return {
    regime: {
      type: "choice",
      instructions: {
        scope,
        question: "Which market regime best describes this state?",
      },
      criteria: {
        trending: "Persistent directional flow",
        mean_reverting: "Range-bound oscillation",
        high_vol: "Unstable volatile movement",
        crisis: "Dislocated or dysfunctional market",
      },
    },
    direction: {
      type: "choice",
      instructions: {
        scope,
        question:
          "What is the price bias over the next " +
          horizonSeconds +
          " seconds? Select neutral when evidence is insufficient.",
      },
      criteria: {
        up: "Upward price bias",
        down: "Downward price bias",
        neutral: "No reliable directional bias",
      },
    },
    toxic_flow: {
      type: "noul",
      instructions: {
        scope,
        question:
          "Is aggressive flow likely adverse to a new spot position rather than balanced noise?",
      },
    },
    liquidity_stressed: {
      type: "noul",
      instructions: {
        scope,
        question:
          "Is available liquidity stressed given spread, visible depth and recent flow?",
      },
    },
    quote_environment: {
      type: "score",
      instructions: {
        scope,
        question:
          "How favourable are the observed spread and flow conditions for providing liquidity? This is contextual, not a request to place maker orders.",
      },
      criteria: [
        "Avoid: dislocated book",
        "Marginal: wide or unstable spread",
        "Normal: orderly flow and spread",
        "Favourable: deep and stable book",
      ],
    },
    inventory_pressure: {
      type: "score",
      instructions: {
        scope,
        question:
          "How urgent is reducing the supplied bot position, considering its observed risk? With no position answer None.",
      },
      criteria: [
        "None: flat or low pressure",
        "Mild: ordinary exposure",
        "High: deteriorating exposure",
        "Urgent: exposure under severe stress",
      ],
    },
    execution_health: {
      type: "score",
      instructions: {
        scope,
        question:
          "Is the supplied execution and data health suitable? Unknown live fills cannot establish optimal execution.",
      },
      criteria: [
        "Broken: stale data or unresolved orders",
        "Degraded: failures or inadequate evidence",
        "Normal: current data and no known failure",
        "Optimal: current data and measured healthy fills",
      ],
    },
  };
}
export function validateAnswers(a, qs=questions()) {
  for (const [key, q] of Object.entries(qs)) {
    const v = a?.[key];
    if (!v || v.type !== q.type) throw Error("Jev 응답 형식 오류: " + key);
    const prob = (x) =>
      typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
    if (q.type === "noul") {
      if (!prob(v.noul)) throw Error("Jev 확률 범위 오류");
      continue;
    }
    if (!prob(v.confidence) || !v.probabilities) throw Error("Jev 확신도 누락");
    const keys =
      q.type === "choice"
        ? Object.keys(q.criteria)
        : q.criteria.map((_, i) => String(i));
    if (
      Object.keys(v.probabilities).length !== keys.length ||
      keys.some((k) => !prob(v.probabilities[k])) ||
      Math.abs(Object.values(v.probabilities).reduce((x, y) => x + y, 0) - 1) >
        0.021
    )
      throw Error("Jev 확률 분포 오류");
    if (
      q.type === "choice" &&
      (!keys.includes(v.choice) ||
        v.probabilities[v.choice] + 1e-6 <
          Math.max(...Object.values(v.probabilities)))
    )
      throw Error("Jev 선택값 오류");
    if (
      q.type === "score" &&
      (typeof v.score !== "number" ||
        !Number.isFinite(v.score) ||
        v.score < 0 ||
        v.score > q.criteria.length - 1)
    )
      throw Error("Jev 점수 오류");
  }
  return a;
}
export async function askJev(key, state, prompt, fetcher = fetch) {
  if (!key) throw Error("TypeSafe API 키를 먼저 연결하세요.");
  const startedAt = Date.now();
  const qs={...questions(prompt,state.horizonSeconds||60),...(state.evidencePolicy?evidenceQuestions(state.evidencePolicy,state.botPosition?.quantity>0):{})};
  const r = await fetcher("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-1.13.0",
      state,
      questions: qs,
    }),
    signal: AbortSignal.timeout(4500),
  });
  if (!r.ok)
    throw Error(
      "TypeSafe HTTP " +
        r.status +
        (r.status === 429 ? " / 호출 제한으로 대기합니다." : ""),
    );
  const body = await r.json();
  return {
    id: randomUUID(),
    at: Date.now(),
    stateAsOf: state.market.asOf,
    market: state.market.market,
    model: body.model,
    latencyMs: Date.now() - startedAt,
    answers: validateAnswers(body.answers, qs),
    usage: body.usage || null,
    source: "TypeSafe 직접 API",
    horizonSeconds: state.horizonSeconds || 5,
  };
}
