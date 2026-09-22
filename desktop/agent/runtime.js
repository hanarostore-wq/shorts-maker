const { WebContentsView, session } = require("electron");
const { CAPTURE_SOURCE } = require("./capture");
const { planTask, siteOf } = require("./planner");

// 관제실에서 작업을 하나씩 꺼내와 실제 브라우저로 수행하는 워커.
//
// 담당자가 로그인해 둔 세션(persist 파티션)을 그대로 쓰기 때문에, 로그인이
// 필요한 페이지도 사람이 보는 것과 같은 화면을 읽는다.

const POLL_INTERVAL_MS = 5000;
const PAGE_LOAD_TIMEOUT_MS = 45000;
const CAPTURE_TIMEOUT_MS = 60000;

let running = false;
let timer = null;

/** 워커용 화면. 창에 붙이지 않아서 담당자 작업을 방해하지 않는다. */
function createWorkerView(partition) {
  return new WebContentsView({
    webPreferences: {
      session: session.fromPartition(partition),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 창에 붙어 있지 않아도 페이지가 계속 그려지게 한다. 이게 없으면
      // lazy-load 사진이 영원히 불러와지지 않는다.
      offscreen: false,
      backgroundThrottling: false,
    },
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** 페이지를 열고 로딩이 끝날 때까지 기다린다. */
async function loadPage(view, url) {
  const wc = view.webContents;
  await withTimeout(
    wc.loadURL(url),
    PAGE_LOAD_TIMEOUT_MS,
    `페이지 로딩 시간 초과 (${PAGE_LOAD_TIMEOUT_MS / 1000}초)`,
  );
  // 화면이 그려진 뒤 스크립트가 내용을 채우는 사이트가 많아서 잠시 기다린다.
  await new Promise((r) => setTimeout(r, 1500));
}

/**
 * 바깥 페이지와 그 안의 iframe 각각에서 HTML을 거둬온다.
 * 상세페이지 사진은 별도의 iframe에 들어있는 경우가 많아 바깥만 봐서는
 * 찾을 수 없다.
 */
async function captureAllFrames(view) {
  const wc = view.webContents;
  const frames = [];

  // framesInSubtree는 바깥 프레임 자신과 모든 하위 프레임을 포함한다.
  for (const frame of wc.mainFrame.framesInSubtree) {
    try {
      const result = await withTimeout(
        frame.executeJavaScript(CAPTURE_SOURCE, true),
        CAPTURE_TIMEOUT_MS,
        "프레임 수집 시간 초과",
      );
      if (result && result.html) frames.push(result);
    } catch {
      // 광고 프레임처럼 접근이 막힌 프레임은 건너뛴다. 하나가 막혔다고
      // 수집 전체를 실패시키지 않는다.
    }
  }

  if (frames.length === 0) return null;
  const main = frames.find((f) => f.isTopFrame) ?? frames[0];
  return { url: main.url, html: main.html, frames };
}

/** 관제실 API 호출 도우미. */
async function callApi(controlUrl, path, method, body) {
  const res = await fetch(`${controlUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`서버 응답을 읽지 못했습니다 (상태 ${res.status})`);
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * 동작 하나를 승인 관문에 통과시킨다.
 *
 * 읽기 동작도 반드시 거친다. 자동으로 통과되지만, 그래야 에이전트가 무엇을
 * 했는지가 전부 작업 기록에 남는다.
 */
async function passGate(controlUrl, taskId, action) {
  const { data } = await callApi(controlUrl, "/api/agent/gate", "POST", {
    taskId,
    action,
  });
  return data;
}

async function runTask(controlUrl, partition, task, log) {
  const plan = planTask(task.instruction);
  if (!plan.ok) {
    await callApi(controlUrl, "/api/agent/claim", "PATCH", {
      taskId: task.id,
      status: "failed",
      error: plan.reason,
    });
    log(`작업 ${task.id}: ${plan.reason}`);
    return;
  }

  const view = createWorkerView(partition);
  let failure = null;

  try {
    for (const step of plan.steps) {
      const gate = await passGate(controlUrl, task.id, {
        kind: step.kind,
        site: siteOf(step.url),
        url: step.url,
        summary: step.summary,
        amountKrw: null,
        itemCount: 1,
      });

      // 관문이 막으면 그 자리에서 멈춘다. 승인 대기함에 올라간 상태이므로
      // 사람이 처리할 때까지 이 작업은 더 진행하지 않는다.
      if (!gate.allowed) {
        log(`작업 ${task.id}: 승인 대기 — ${gate.reason}`);
        return;
      }

      await loadPage(view, step.url);
      const payload = await captureAllFrames(view);
      if (!payload) {
        throw new Error(`페이지 내용을 가져오지 못했습니다: ${step.url}`);
      }

      // 사이트별 파싱과 저장은 서버가 한다 (확장프로그램과 같은 경로).
      const { ok, data } = await callApi(
        controlUrl,
        "/api/sourcing/scrape",
        "POST",
        payload,
      );
      if (!ok) {
        throw new Error(data?.error ?? "수집 결과를 저장하지 못했습니다");
      }

      const summary =
        data.mode === "list"
          ? `목록에서 ${data.foundCount}개 발견 · 신규 ${data.addedCount} / 갱신 ${data.updatedCount}`
          : `"${data.product?.title ?? "이름 확인 불가"}" ${data.addedCount > 0 ? "신규 수집" : "갱신"}`;
      log(`작업 ${task.id}: ${summary}`);
    }

    await callApi(controlUrl, "/api/agent/claim", "PATCH", {
      taskId: task.id,
      status: "done",
      error: null,
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    await callApi(controlUrl, "/api/agent/claim", "PATCH", {
      taskId: task.id,
      status: "failed",
      error: failure,
    });
    log(`작업 ${task.id} 실패: ${failure}`);
  } finally {
    view.webContents.close();
  }
}

async function tick(controlUrl, partition, log) {
  if (running) return;
  running = true;
  try {
    const { ok, data } = await callApi(controlUrl, "/api/agent/claim", "POST");
    if (!ok || !data.task) return;
    await runTask(controlUrl, partition, data.task, log);
  } catch (error) {
    // 관제실에 연결하지 못하는 상황(네트워크 끊김 등)은 흔하므로
    // 다음 주기에 조용히 재시도한다.
    log(`관제실 연결 실패: ${error instanceof Error ? error.message : error}`);
  } finally {
    running = false;
  }
}

function startAgentRuntime({ controlUrl, partition, log = console.log }) {
  if (timer) return;
  log(`에이전트 워커 시작 — ${controlUrl}`);
  timer = setInterval(() => {
    tick(controlUrl, partition, log);
  }, POLL_INTERVAL_MS);
}

function stopAgentRuntime() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startAgentRuntime, stopAgentRuntime };
