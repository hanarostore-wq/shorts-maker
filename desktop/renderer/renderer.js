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

window.shell.list();
