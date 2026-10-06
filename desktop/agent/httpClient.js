const { net } = require("electron");
const { requestJsonViaCurl } = require("./curlTransport");

let preferCurl = false;

async function callApi(controlUrl, path, method, body) {
  const url = `${controlUrl}${path}`;
  const key = process.env.SOCIAL_CONTROL_KEY || "";
  if (preferCurl && process.platform === "win32") {
    return requestJsonViaCurl(url, method, body, key);
  }
  let response;
  try {
    response = await net.fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...(key ? { "x-social-control-key": key } : {}) },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (process.platform !== "win32") throw error;
    // On some Windows networks curl.exe succeeds while Electron's HTTP/2 fails.
    // Never place the access key in a process argument or temporary file.
    const result = await requestJsonViaCurl(url, method, body, key);
    preferCurl = true;
    console.warn(`[agent] Electron 통신 오류(${error.message}); curl.exe 경로로 전환했습니다.`);
    return result;
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`서버 응답을 읽지 못했습니다 (상태 ${response.status})`); }
  return { ok: response.ok, status: response.status, data };
}

module.exports = { callApi };
