const Anthropic = require("@anthropic-ai/sdk");

// 화면을 보고 다음에 무엇을 할지 판단하는 부분.
//
// 우리가 쿠팡·스마트스토어 화면 구조를 미리 알 필요가 없다. 관찰기가 뽑아준
// "지금 누를 수 있는 것들" 목록을 보고 모델이 직접 고른다.

const MODEL = "claude-opus-5";

const SYSTEM = `너는 한국 이커머스 운영본부의 업무 자동화 에이전트다.
담당자가 이미 로그인해 둔 브라우저에서 실제 업무를 대신 수행한다.

주어지는 것:
- 지금 화면의 주소와 제목
- 이 화면에서 조작할 수 있는 요소들의 번호 목록
- 화면에 보이는 글

규칙:
1. 한 번에 하나씩만 조작하고, 그 결과 화면을 다시 보고 다음을 정한다.
2. 번호는 지금 이 화면에서만 유효하다. 화면이 바뀌면 번호도 달라진다.
3. 되돌리기 어려운 동작(발주 확정, 결제, 고객 메시지 발송, 상품 등록/수정,
   취소/환불/삭제)을 하려면 반드시 commit 도구를 먼저 부른다. 사람의 승인
   관문을 거치기 위한 것이다. 확인 없이 확정 버튼을 누르지 마라.
4. 로그인 화면이 나오면 진행하지 말고 ask_human으로 담당자를 부른다.
   비밀번호를 입력하려 하지 마라.
5. 화면에서 금액·건수를 읽을 수 있으면 commit에 정확히 담는다. 못 읽으면
   비워 둔다. 추측한 숫자를 넣지 마라 — 그 숫자로 자동 승인 여부가 갈린다.
6. 지시한 범위를 넘는 일은 하지 않는다. 애매하면 ask_human으로 묻는다.
7. 일이 끝났으면 done으로 무엇을 했는지 보고한다.`;

const TOOLS = [
  {
    name: "click",
    description: "번호로 지정한 요소를 누른다. 버튼·링크·체크박스 모두 이걸로 누른다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "요소 목록의 번호" },
        why: { type: "string", description: "이걸 누르는 이유 (기록에 남는다)" },
      },
      required: ["index", "why"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "type",
    description: "입력칸에 글자를 넣는다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer" },
        text: { type: "string" },
        why: { type: "string" },
      },
      required: ["index", "text", "why"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "select",
    description: "드롭다운에서 선택지를 고른다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer" },
        text: { type: "string", description: "고를 선택지의 글자" },
        why: { type: "string" },
      },
      required: ["index", "text", "why"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "navigate",
    description: "주소를 직접 입력해 다른 페이지로 간다.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        why: { type: "string" },
      },
      required: ["url", "why"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "scroll",
    description: "화면을 위아래로 움직여 가려진 부분을 본다.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["down", "up", "top", "bottom"] },
      },
      required: ["direction"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "commit",
    description:
      "되돌리기 어려운 동작을 실행하기 직전에 부른다. 승인 관문을 거친 뒤 " +
      "허용되면 이어서 그 버튼을 누를 수 있다. 막히면 멈춰야 한다.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["order_place", "payment", "message_send", "listing_create", "listing_update"],
        },
        summary: { type: "string", description: "무엇을 확정하는지 한 줄로" },
        amount_krw: {
          type: ["integer", "null"],
          description: "화면에서 읽은 금액(원). 확인할 수 없으면 null.",
        },
        item_count: { type: "integer", description: "처리하는 건수" },
      },
      required: ["kind", "summary", "amount_krw", "item_count"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "ask_human",
    description: "판단이 서지 않거나 로그인이 필요할 때 담당자를 부른다. 작업은 멈춘다.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "done",
    description: "지시받은 일을 마쳤을 때 부른다.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function createClient(apiKey) {
  if (!apiKey) {
    throw new Error(
      "API 키가 없습니다. 앱 위쪽 ⚙ 설정에서 Anthropic API 키를 넣어주세요.",
    );
  }
  return new Anthropic({ apiKey });
}

/** 관찰 결과를 모델에게 보여줄 글로 만든다. */
function renderObservation(obs) {
  return [
    `주소: ${obs.url}`,
    `제목: ${obs.title}`,
    `스크롤: ${obs.scrollY} / ${obs.scrollHeight}`,
    "",
    "조작할 수 있는 것:",
    obs.elements.length ? obs.elements.join("\n") : "(없음)",
    "",
    "화면에 보이는 글:",
    obs.text || "(없음)",
  ].join("\n");
}

/**
 * 다음에 할 동작 하나를 모델에게 묻는다.
 * messages는 호출한 쪽이 들고 있다가 그대로 다시 넘긴다 (대화가 이어지도록).
 */
async function decideNext({ client, goal, messages }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    // 판단이 필요한 일이므로 적응형 사고를 켠다.
    thinking: { type: "adaptive" },
    tools: TOOLS,
    messages,
    metadata: undefined,
  });

  // 안전 분류에 걸린 경우 content를 읽기 전에 먼저 확인한다.
  if (response.stop_reason === "refusal") {
    throw new Error(
      `모델이 이 요청을 거부했습니다 (${response.stop_details?.category ?? "사유 미상"}).`,
    );
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { response, toolUse, text, goal };
}

module.exports = { createClient, decideNext, renderObservation, TOOLS, MODEL };
