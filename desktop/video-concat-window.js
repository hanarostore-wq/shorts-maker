const state = { paths: [], outputPath: null, busy: false };
const $ = (id) => document.getElementById(id);

function fileName(filePath) { return filePath.split(/[\\/]/).pop() || filePath; }
function setStatus(message, kind = "") { const node = $("status"); node.textContent = message; node.className = `status ${kind}`.trim(); }
function render() {
  $("count").textContent = `${state.paths.length} FILE${state.paths.length === 1 ? "" : "S"}`;
  $("run").disabled = state.busy || state.paths.length < 2;
  $("clear").disabled = state.busy || state.paths.length === 0;
  const root = $("sources"); root.innerHTML = "";
  if (!state.paths.length) { root.innerHTML = '<div id="empty">2개 이상의 원본 영상을 선택하세요</div>'; return; }
  state.paths.forEach((filePath, index) => {
    const row = document.createElement("div"); row.className = "source";
    row.innerHTML = `<span class="order">${String(index + 1).padStart(2, "0")}</span><div class="name"><b>${fileName(filePath)}</b><div class="file">${filePath}</div></div><div class="row-actions"><button class="small secondary" data-up="${index}" ${index === 0 || state.busy ? "disabled" : ""}>↑</button><button class="small secondary" data-down="${index}" ${index === state.paths.length - 1 || state.busy ? "disabled" : ""}>↓</button><button class="small danger" data-remove="${index}" ${state.busy ? "disabled" : ""}>삭제</button></div>`;
    root.appendChild(row);
  });
  root.querySelectorAll("button[data-up]").forEach((button) => button.onclick = () => move(Number(button.dataset.up), -1));
  root.querySelectorAll("button[data-down]").forEach((button) => button.onclick = () => move(Number(button.dataset.down), 1));
  root.querySelectorAll("button[data-remove]").forEach((button) => button.onclick = () => { state.paths.splice(Number(button.dataset.remove), 1); state.outputPath = null; $("folder").disabled = true; render(); });
}
function move(index, delta) { const target = index + delta; [state.paths[index], state.paths[target]] = [state.paths[target], state.paths[index]]; render(); }

$("pick").onclick = async () => {
  if (state.busy) return;
  const result = await window.videoConcat.selectSources();
  if (result.canceled || !result.paths?.length) return;
  state.paths.push(...result.paths.filter((filePath) => !state.paths.includes(filePath)));
  state.outputPath = null; $("folder").disabled = true;
  setStatus("선택 순서가 곧 이어붙일 순서입니다. 필요하면 ↑ ↓로 바꾸세요."); render();
};
$("clear").onclick = () => { state.paths = []; state.outputPath = null; $("folder").disabled = true; setStatus("원본을 선택하면 화질 보존 방식을 자동 판별합니다."); render(); };
$("run").onclick = async () => {
  if (state.paths.length < 2 || state.busy) return;
  state.busy = true; state.outputPath = null; $("folder").disabled = true; $("bar").style.width = "3%";
  setStatus("원본 규격과 무손실 처리 방식을 확인하는 중입니다."); render();
  try {
    const result = await window.videoConcat.run(state.paths);
    if (result.canceled) { setStatus("작업을 취소했습니다."); return; }
    state.outputPath = result.outputPath; $("folder").disabled = false; $("bar").style.width = "100%";
    const mode = result.mode === "stream-copy" ? "원본 비트스트림 복사" : "규격 자동 무손실 MKV";
    setStatus(`완료 · ${result.sourceCount}개 원본 · 약 ${result.keptDuration.toFixed(1)}초 · ${mode}\n${result.outputPath}`, "done");
  } catch (error) {
    $("bar").style.width = "0%";
    setStatus(error?.message || "이어붙이기에 실패했습니다.", "error");
  } finally { state.busy = false; render(); }
};
$("folder").onclick = () => { if (state.outputPath) window.videoConcat.showInFolder(state.outputPath); };
window.videoConcat.onProgress((event) => {
  const pct = event.phase === "trim" ? Math.round((event.current / event.total) * 75) : ["join", "normalize"].includes(event.phase) ? 88 : 100;
  $("bar").style.width = `${pct}%`;
  setStatus(event.message);
});
render();
