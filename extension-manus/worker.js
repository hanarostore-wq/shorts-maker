const API = "https://shorts-maker-omega.vercel.app";
let busy = false;

async function api(path, method = "GET", body) {
  const response = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `머니OS 응답 오류 ${response.status}`);
  return data;
}

async function inspect(tabId, action) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["urls.js", "extractor.js", "content.js"] });
  const response = await chrome.tabs.sendMessage(tabId, { type: action });
  if (!response?.ok) throw new Error(response?.error || "쇼핑몰 화면을 읽지 못했습니다.");
  return response.data;
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("상품 페이지 로딩 시간이 초과됐습니다.")); }, 30000);
    const listener = (id, change) => {
      if (id === tabId && change.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } }).catch(reject);
  });
}

async function saveProduct(product) {
  return api("/api/sourcing/import", "POST", { product });
}

async function readAndSave(tabId) {
  const data = await inspect(tabId, "capture");
  if (!data?.name) throw new Error("상품명을 확인하지 못했습니다.");
  return saveProduct(data);
}

async function collectUrls(urls) {
  let done = 0;
  for (const url of [...new Set(urls)]) {
    const tab = await chrome.tabs.create({ url, active: false });
    try { await waitForTab(tab.id); await readAndSave(tab.id); done++; }
    finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
  }
  return done;
}

async function runTask(task) {
  const urls = [...String(task.instruction || "").matchAll(/https?:\/\/[^\s,]+/g)].map((match) => match[0].replace(/[)\]}>,.]+$/, ""));
  if (!urls.length) throw new Error("자동 소싱 작업에 쇼핑몰 주소가 없습니다.");
  const tab = await chrome.tabs.create({ url: urls[0], active: false });
  try {
    await waitForTab(tab.id);
    const links = await inspect(tab.id, "links");
    if (links.length) return await collectUrls(links);
    await readAndSave(tab.id);
    return 1;
  } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
}

async function runQueue() {
  if (busy) return;
  busy = true;
  try {
    const claimed = await api("/api/agent/claim", "POST", { agentId: "s1" });
    if (!claimed.task) return;
    try {
      const count = await runTask(claimed.task);
      await api("/api/agent/claim", "PATCH", { taskId: claimed.task.id, status: "done" });
      await chrome.storage.local.set({ autoJob: { message: `자동 소싱 완료 · ${count}건`, status: "done", at: Date.now() } });
    } catch (error) {
      await api("/api/agent/claim", "PATCH", { taskId: claimed.task.id, status: "failed", error: error instanceof Error ? error.message : String(error) }).catch(() => {});
      await chrome.storage.local.set({ autoJob: { message: `자동 소싱 실패 · ${error instanceof Error ? error.message : String(error)}`, status: "failed", at: Date.now() } });
    }
  } catch (error) {
    await chrome.storage.local.set({ autoJob: { message: error instanceof Error ? error.message : String(error), status: "failed", at: Date.now() } });
  } finally { busy = false; }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    if (message.type === "inspect") return inspect(message.tabId, message.action);
    if (message.type === "saveProduct") return saveProduct(message.product);
    if (message.type === "collectUrls") return { done: await collectUrls(message.urls) };
    if (message.type === "runQueue") { runQueue(); return { started: true }; }
    throw new Error("지원하지 않는 작업입니다.");
  })().then((data) => reply({ ok: true, data })).catch((error) => reply({ ok: false, error: error.message }));
  return true;
});

chrome.alarms.create("moneyos-sourcing-queue", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "moneyos-sourcing-queue") runQueue(); });
chrome.runtime.onStartup.addListener(runQueue);
chrome.runtime.onInstalled.addListener(runQueue);
