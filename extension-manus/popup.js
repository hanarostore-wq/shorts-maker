"use strict";
const $ = (id) => document.getElementById(id);
let captured = null;

function say(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "ok";
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "확장프로그램 연결 오류");
  return response.data;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("쇼핑몰 탭을 열어 주세요.");
  return tab.id;
}

function renderCapture(data) {
  $("capture-summary").textContent = `대표·상세 이미지 ${data.images?.length || 0}장 · 옵션 그룹 ${data.option_groups?.length || 0}개 · 조합 ${data.variants?.length || 0}개`;
  $("name").value = data.name || "";
  $("cost").value = data.cost || "";
  $("options").value = data.options || "";
  $("capture").hidden = false;
}

$("read").addEventListener("click", async () => {
  $("read").disabled = true;
  try {
    captured = await send({ type: "inspect", tabId: await activeTab(), action: "capture" });
    renderCapture(captured);
    say("현재 상세페이지 상품을 읽었습니다. 저장 버튼을 누르세요.");
  } catch (error) { say(error.message, true); }
  finally { $("read").disabled = false; }
});

$("send").addEventListener("click", async () => {
  if (!captured) return say("먼저 현재 상품 읽기를 눌러 주세요.", true);
  $("send").disabled = true;
  try {
    const product = { ...captured, name: $("name").value.trim(), cost: Number($("cost").value), options: $("options").value.trim() };
    if (!product.name || !(product.cost > 0)) throw new Error("상품명과 현재 매입가를 확인해 주세요.");
    await send({ type: "saveProduct", product });
    say("상품·옵션·이미지를 소싱관리로 저장했습니다.");
    $("capture").hidden = true;
  } catch (error) { say(error.message, true); }
  finally { $("send").disabled = false; }
});

$("discover").addEventListener("click", async () => {
  $("discover").disabled = true;
  try {
    const links = await send({ type: "inspect", tabId: await activeTab(), action: "links" });
    if (!links?.length) throw new Error("현재 화면에서 상품 링크를 찾지 못했습니다.");
    $("link-count").textContent = `현재 화면 상품 ${links.length}건`;
    await send({ type: "collectUrls", urls: links });
    say(`현재 화면 ${links.length}건의 소싱을 시작했습니다.`);
  } catch (error) { say(error.message, true); }
  finally { $("discover").disabled = false; }
});

$("allow-sites").addEventListener("click", async () => {
  try {
    const granted = await chrome.permissions.request({ origins: ["https://*/*"] });
    if (!granted) throw new Error("쇼핑몰 접근 권한이 필요합니다.");
    await send({ type: "runQueue" });
    say("자동 소싱 권한을 연결했습니다. 상품소싱이 작업을 확인합니다.");
  } catch (error) { say(error.message, true); }
});

$("resume").addEventListener("click", async () => {
  try { await send({ type: "runQueue" }); say("자동 소싱 대기 작업을 확인했습니다."); }
  catch (error) { say(error.message, true); }
});

chrome.storage.local.get("autoJob").then((state) => { if (state.autoJob) say(state.autoJob.message, state.autoJob.status === "failed"); });
chrome.storage.onChanged.addListener((changes) => { if (changes.autoJob) say(changes.autoJob.newValue.message, changes.autoJob.newValue.status === "failed"); });
