const { OBSERVE_SOURCE, buildActSource } = require("./observe");
const { createClient, decideNext, renderObservation } = require("./brain");

// 화면을 보고 → 무엇을 할지 판단하고 → 실행하고 → 다시 보는 순환.
//
// 우리가 사이트 구조를 미리 알 필요가 없다. 대신 되돌리기 어려운 동작은
// 반드시 승인 관문을 지나게 한다.

const MAX_STEPS = 40;
const SETTLE_MS = 1200;

// 모델이 commit을 부르지 않고 바로 누르려 해도, 버튼 글자가 이런 모양이면
// 되돌리기 어려운 동작으로 보고 관문을 강제로 거친다.
// 안전장치를 모델의 판단에만 맡기지 않기 위한 것이다.
const DANGEROUS_LABEL = /결제|발주|확정|주문\s*하기|구매\s*하기|발송|전송|보내기|등록\s*하기|수정\s*완료|저장\s*하기|삭제|취소|환불|반품\s*승인/;

const KIND_BY_LABEL = [
  [/결제|구매\s*하기/, "payment"],
  [/발주|주문\s*하기/, "order_place"],
  [/발송|전송|보내기|답변\s*등록/, "message_send"],
  [/등록\s*하기/, "listing_create"],
  [/수정|저장|삭제|취소|환불/, "listing_update"],
];

function guessKind(label) {
  for (const [pattern, kind] of KIND_BY_LABEL) {
    if (pattern.test(label)) return kind;
  }
  return "listing_update";
}

// 실제로 동작을 일으키는 조작 요소인지 본다.
//
// 링크(<a href>)는 대체로 화면 이동일 뿐이다. 글자만 보고 링크까지 막으면
// 에이전트가 발주 화면에 들어가지도 못해 업무 자체가 불가능해진다.
// 확정은 버튼에서 일어나므로 버튼류만 관문 대상으로 본다.
// (링크가 실제로 동작을 일으키는 드문 경우는 모델이 commit을 부르게 되어 있다.)
const COMMIT_TAG = /^<(button\b|input\s+(submit|button)\b|\w+\s+role=button\b)/;

function isCommitControl(elementLine) {
  if (!DANGEROUS_LABEL.test(elementLine)) return false;
  return COMMIT_TAG.test(elementLine.trim());
}

async function observe(view) {
  const wc = view.webContents;
  try {
    return await wc.mainFrame.executeJavaScript(OBSERVE_SOURCE, true);
  } catch (error) {
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      elements: [],
      text: `(화면을 읽지 못했습니다: ${error.message})`,
      scrollY: 0,
      scrollHeight: 0,
    };
  }
}

async function act(view, action) {
  return view.webContents.mainFrame.executeJavaScript(buildActSource(action), true);
}

async function callGate(controlUrl, taskId, action) {
  const res = await fetch(`${controlUrl}/api/agent/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, action }),
  });
  return res.json();
}

function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * 지시 하나를 브라우저에서 끝까지 수행한다.
 *
 * @returns {{ status: "done"|"needs_human"|"blocked"|"failed", message: string }}
 */
async function runBrowserAgent({ view, goal, controlUrl, taskId, log, client: injected }) {
  // client를 넘기면 그걸 쓴다. 모델 없이 관찰·실행·관문만 시험할 때 쓰인다.
  const client = injected ?? createClient();
  const wc = view.webContents;

  const messages = [
    {
      role: "user",
      content: `업무 지시: ${goal}\n\n지금부터 화면을 보여줄 테니, 한 번에 하나씩 조작해서 이 일을 끝내라.`,
    },
  ];

  // commit으로 승인을 받으면 바로 다음 조작 한 번만 허용한다.
  // 승인 하나로 그 뒤 모든 클릭이 열리면 안 되기 때문이다.
  let approvedOnce = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const obs = await observe(view);
    messages.push({ role: "user", content: renderObservation(obs) });

    let decision;
    try {
      decision = await decideNext({ client, goal, messages });
    } catch (error) {
      return { status: "failed", message: error.message };
    }

    const { response, toolUse, text } = decision;
    messages.push({ role: "assistant", content: response.content });

    if (!toolUse) {
      // 도구를 안 쓰고 말만 했으면 판단이 끝난 것으로 본다.
      return { status: "done", message: text || "작업을 마쳤습니다." };
    }

    const input = toolUse.input ?? {};
    let result;

    if (toolUse.name === "done") {
      log(`완료: ${input.summary}`);
      return { status: "done", message: input.summary };
    }

    if (toolUse.name === "ask_human") {
      log(`담당자 확인 필요: ${input.question}`);
      return { status: "needs_human", message: input.question };
    }

    if (toolUse.name === "commit") {
      const gate = await callGate(controlUrl, taskId, {
        kind: input.kind,
        site: siteOf(obs.url),
        url: obs.url,
        summary: input.summary,
        amountKrw: typeof input.amount_krw === "number" ? input.amount_krw : null,
        itemCount: typeof input.item_count === "number" ? input.item_count : 1,
      });

      if (!gate.allowed) {
        log(`확정 직전 멈춤 — ${gate.reason}`);
        return {
          status: "blocked",
          message: `승인 대기함으로 올렸습니다: ${input.summary} (${gate.reason})`,
        };
      }

      approvedOnce = true;
      result = { ok: true, note: "승인됨. 이어서 확정 동작을 실행해도 된다." };
      log(`승인 통과: ${input.summary}`);
    } else if (toolUse.name === "scroll") {
      const js = {
        down: "window.scrollBy(0, window.innerHeight * 0.8)",
        up: "window.scrollBy(0, -window.innerHeight * 0.8)",
        top: "window.scrollTo(0, 0)",
        bottom: "window.scrollTo(0, document.documentElement.scrollHeight)",
      }[input.direction ?? "down"];
      await wc.mainFrame.executeJavaScript(`${js}; true`, true).catch(() => null);
      result = { ok: true };
    } else if (toolUse.name === "navigate") {
      await wc.loadURL(input.url).catch(() => null);
      result = { ok: true, note: `${input.url} 로 이동했다.` };
      log(`이동: ${input.url}`);
    } else if (["click", "type", "select"].includes(toolUse.name)) {
      // 모델이 commit을 건너뛰고 위험한 버튼을 누르려는지 확인한다.
      const label = (obs.elements[input.index] ?? "").replace(/^\[\d+\]\s*/, "");
      if (toolUse.name === "click" && isCommitControl(label) && !approvedOnce) {
        const kind = guessKind(label);
        const gate = await callGate(controlUrl, taskId, {
          kind,
          site: siteOf(obs.url),
          url: obs.url,
          summary: `${label} — 확정 동작 (모델이 승인 요청을 건너뜀)`,
          // 모델이 금액을 알려주지 않았으므로 알 수 없는 것으로 둔다.
          amountKrw: null,
          itemCount: 1,
        });
        if (!gate.allowed) {
          log(`확정 직전 멈춤(자동 감지) — ${gate.reason}`);
          return {
            status: "blocked",
            message: `승인 대기함으로 올렸습니다: ${label} (${gate.reason})`,
          };
        }
      }

      result = await act(view, {
        type: toolUse.name,
        index: input.index,
        text: input.text,
      });

      if (result.ok) {
        log(`${toolUse.name}: ${result.label ?? ""} — ${input.why ?? ""}`);
        approvedOnce = false;
      } else {
        log(`${toolUse.name} 실패: ${result.error}`);
      }

      // 누른 뒤 화면이 바뀌고 자리를 잡을 시간을 준다.
      await new Promise((r) => setTimeout(r, SETTLE_MS));
    } else {
      result = { ok: false, error: `알 수 없는 도구: ${toolUse.name}` };
    }

    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
          is_error: result.ok === false,
        },
      ],
    });
  }

  return {
    status: "failed",
    message: `${MAX_STEPS}단계 안에 끝내지 못했습니다. 지시를 더 좁혀 주세요.`,
  };
}

module.exports = { runBrowserAgent };
