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

async function inspectDirect(tabId, action) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["urls.js", "extractor.js", "content.js"],
    });
  } catch (error) {
    throw new Error(`상세페이지 주입 오류: ${error.message}`);
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: action });
    if (!response?.ok) throw new Error(response?.error || "페이지 분석기가 응답하지 않았습니다.");
    return response.data;
  } catch (error) {
    throw new Error(`상세페이지 분석 오류: ${error.message}`);
  }
}

async function saveDirect(product) {
  let response;
  try {
    response = await fetch("https://shorts-maker-omega.vercel.app/api/sourcing/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
  } catch (error) {
    throw new Error(`머니OS 저장 연결 오류: ${error.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`머니OS 저장 API 오류 ${response.status}: ${data.error || "서버가 저장을 거부했습니다."}`);
  return data;
}

async function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("상품 페이지 로딩 시간이 초과됐습니다.")); }, 30000);
    const listener = (id, change) => { if (id === tabId && change.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } }).catch((error) => reject(new Error(`상품 페이지 상태 확인 오류: ${error.message}`)));
  });
}

async function collectDirect(urls) {
  const unique = [...new Set(urls)];
  let done = 0;
  for (const url of unique) {
    const tab = await chrome.tabs.create({ url, active: false });
    try {
      await waitForTab(tab.id);
      const product = await inspectDirect(tab.id, "capture");
      const saved = await saveDirect(product);
      done += 1;
      say(`상품 ${done}/${unique.length}건 · 이미지 ${saved.imageCount ?? product.images?.length ?? 0}장 · 옵션 ${saved.optionGroupCount ?? 0}그룹 · 조합 ${saved.variantCount ?? 0}개`);
    } catch (error) {
      throw new Error(`상품 ${done + 1}/${unique.length}건 처리 오류 (${url}): ${error.message}`);
    } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
  }
  return done;
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
    captured = await inspectDirect(await activeTab(), "capture");
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
    if (!product.name) throw new Error("상품명을 확인하지 못했습니다.");
    const saved = await saveDirect(product);
    const mode = saved.addedCount ? "신규 저장" : "기존 상품 갱신";
    say(`${mode} 완료 · 가격 ${product.cost > 0 ? `${product.cost}원` : "미확인"} · 이미지 ${saved.imageCount ?? product.images?.length ?? 0}장 · 상세 ${saved.detailImageCount ?? 0}장 · 옵션 ${saved.optionGroupCount ?? 0}그룹 · 조합 ${saved.variantCount ?? 0}개`);
    $("capture").hidden = true;
  } catch (error) { say(error.message, true); }
  finally { $("send").disabled = false; }
});

$("discover").addEventListener("click", async () => {
  $("discover").disabled = true;
  try {
    const links = await inspectDirect(await activeTab(), "links");
    if (!links?.length) throw new Error("현재 화면에서 상품 링크를 찾지 못했습니다.");
    $("link-count").textContent = `현재 화면 상품 ${links.length}건`;
    const done = await collectDirect(links);
    say(`현재 화면 소싱 완료 · ${done}/${links.length}건`);
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

chrome.storage.local.get(["autoJob", "sourceJob"]).then((state) => {
  const job = state.sourceJob || state.autoJob;
  if (job) say(job.message, job.status === "failed");
});
chrome.storage.onChanged.addListener((changes) => {
  const job = changes.sourceJob?.newValue || changes.autoJob?.newValue;
  if (job) say(job.message, job.status === "failed");
});

fetch("https://shorts-maker-omega.vercel.app/api/sourcing/add", { cache: "no-store" })
  .then((response) => response.json())
  .then((data) => {
    if (Array.isArray(data.products)) say(`머니OS 저장소 연결 정상 · 저장 상품 ${data.products.length}건`);
  })
  .catch(() => say("머니OS 저장소 연결 실패 · 확장프로그램을 다시 설치해 주세요", true));
