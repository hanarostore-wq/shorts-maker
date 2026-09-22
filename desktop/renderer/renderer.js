// 셸 UI. 탭 목록과 주소창만 담당하고, 실제 페이지는 main 프로세스가
// WebContentsView로 크롬 아래 영역에 띄운다.

const tabbar = document.getElementById("tabbar");
const urlInput = document.getElementById("url");
const backBtn = document.getElementById("back");
const forwardBtn = document.getElementById("forward");
const reloadBtn = document.getElementById("reload");
const homeBtn = document.getElementById("home");

let tabs = [];
let activeId = null;
// 주소를 입력하는 중에는 화면 갱신이 입력값을 덮어쓰지 않게 한다.
let editingUrl = false;

function activeTab() {
  return tabs.find((t) => t.id === activeId) ?? null;
}

function render() {
  tabbar.innerHTML = "";

  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = `tab${tab.active ? " active" : ""}`;
    el.title = tab.url;
    el.onclick = () => window.shell.activate(tab.id);

    if (tab.pinned) {
      const dot = document.createElement("span");
      dot.className = "dot";
      el.appendChild(dot);
    }

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = tab.pinned ? "운영본부 관제실" : tab.title;
    el.appendChild(label);

    // 관제실 탭은 닫기 버튼을 주지 않는다 (홈이므로).
    if (!tab.pinned) {
      const x = document.createElement("span");
      x.className = "x";
      x.textContent = "×";
      x.onclick = (e) => {
        e.stopPropagation();
        window.shell.close(tab.id);
      };
      el.appendChild(x);
    }

    tabbar.appendChild(el);
  }

  const add = document.createElement("button");
  add.id = "newtab";
  add.textContent = "+";
  add.title = "새 탭";
  add.onclick = () => window.shell.newTab("");
  tabbar.appendChild(add);

  const current = activeTab();
  if (current && !editingUrl) urlInput.value = current.url;
  backBtn.disabled = !current?.canGoBack;
  forwardBtn.disabled = !current?.canGoForward;
}

window.shell.onTabs((payload) => {
  tabs = payload;
  activeId = payload.find((t) => t.active)?.id ?? null;
  render();
});

urlInput.addEventListener("focus", () => {
  editingUrl = true;
  urlInput.select();
});
urlInput.addEventListener("blur", () => {
  editingUrl = false;
  render();
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const current = activeTab();
  if (!current) return;
  window.shell.navigate(current.id, urlInput.value);
  urlInput.blur();
});

backBtn.onclick = () => activeTab() && window.shell.back(activeId);
forwardBtn.onclick = () => activeTab() && window.shell.forward(activeId);
reloadBtn.onclick = () => activeTab() && window.shell.reload(activeId);

// 관제실은 항상 첫 번째 고정 탭이다.
homeBtn.onclick = () => {
  const home = tabs.find((t) => t.pinned);
  if (home) window.shell.activate(home.id);
};

// 에이전트 워커가 보내오는 진행 상황을 상태줄에 흘려보낸다.
const agentMsg = document.getElementById("agentmsg");
const agentDot = document.getElementById("agentdot");
window.shell.onAgentLog((message) => {
  agentMsg.textContent = message;
  agentMsg.title = message;
});

// --- 설정 ---

const panel = document.getElementById("settings");
const keyInput = document.getElementById("apikey");
const urlInputSetting = document.getElementById("controlurl");
const note = document.getElementById("note");

function say(text, tone) {
  note.textContent = text;
  note.style.color = tone === "bad" ? "#f87171" : tone === "good" ? "#4ade80" : "#a1a1aa";
}

/** 키가 있으면 상태줄 점을 초록으로, 없으면 회색으로 둔다. */
function applyStatus(s) {
  agentDot.className = s.hasKey ? "" : "off";
  if (!s.hasKey) {
    agentMsg.textContent = "API 키 없음 — ⚙ 설정에서 넣어주세요";
  }
  urlInputSetting.value = s.controlUrl ?? "";
  // 저장된 키는 절대 화면으로 가져오지 않는다. 있는지 여부만 보여준다.
  keyInput.placeholder = s.hasKey ? "저장된 키 있음 (바꾸려면 새로 입력)" : "sk-ant-...";
}

async function refreshSettings() {
  applyStatus(await window.shell.getSettings());
}

/** 패널을 열고 닫는다. 여는 동안은 탭 화면을 내려야 패널이 보인다. */
async function setPanelOpen(open) {
  panel.classList.toggle("open", open);
  await window.shell.setOverlay(open);
  if (open) {
    say("");
    await refreshSettings();
  }
}

document.getElementById("gear").onclick = () =>
  setPanelOpen(!panel.classList.contains("open"));

document.getElementById("close").onclick = () => setPanelOpen(false);

// Esc로도 닫을 수 있게 한다.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panel.classList.contains("open")) setPanelOpen(false);
});

document.getElementById("save").onclick = async () => {
  const key = keyInput.value.trim();
  if (key) {
    const result = await window.shell.setApiKey(key);
    if (!result.ok) {
      say(result.error ?? "키를 저장하지 못했습니다.", "bad");
      return;
    }
    keyInput.value = "";
  }
  const after = await window.shell.setControlUrl(urlInputSetting.value.trim());
  applyStatus(after);
  say("저장했습니다.", "good");
};

document.getElementById("clearkey").onclick = async () => {
  const after = await window.shell.setApiKey("");
  applyStatus(after);
  keyInput.value = "";
  say("키를 지웠습니다.", "good");
};

refreshSettings();
window.shell.list();
