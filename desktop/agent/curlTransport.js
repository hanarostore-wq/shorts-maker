const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");

function configQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

/** Uses the Windows curl.exe that is already able to reach Vercel.
 *  The access key and body are supplied on stdin, never in command-line arguments or files.
 */
function requestJsonViaCurl(url, method, body, key, { binary = process.platform === "win32" ? "curl.exe" : "curl" } = {}) {
  const marker = `__CURL_STATUS_${randomBytes(12).toString("hex")}__`;
  const config = [
    `url = ${configQuote(url)}`,
    `request = ${configQuote(method)}`,
    `header = ${configQuote("Content-Type: application/json")}`,
    ...(key ? [`header = ${configQuote(`x-social-control-key: ${key}`)}`] : []),
    ...(body == null ? [] : [`data-binary = ${configQuote(JSON.stringify(body))}`]),
    `write-out = ${configQuote(`\n${marker}%{http_code}`)}`,
    "max-time = 30",
    "silent",
    "show-error",
  ].join("\n") + "\n";
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--config", "-"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (part) => {
      stdout += part;
      if (stdout.length > 12_000_000) child.kill();
    });
    child.stderr.on("data", (part) => { stderr = (stderr + part).slice(-2000); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`curl 통신 실패 (${code}): ${stderr.trim().slice(0, 300)}`));
      const at = stdout.lastIndexOf(marker);
      if (at < 0) return reject(new Error("curl HTTP 상태를 확인할 수 없습니다."));
      const status = Number(stdout.slice(at + marker.length).trim());
      if (!Number.isInteger(status) || status < 100 || status > 599) return reject(new Error("curl HTTP 상태가 올바르지 않습니다."));
      const text = stdout.slice(0, at).replace(/\n$/, "");
      let data;
      try { data = JSON.parse(text); }
      catch { return reject(new Error(`서버 응답을 읽지 못했습니다 (상태 ${status})`)); }
      resolve({ ok: status >= 200 && status < 300, status, data });
    });
    child.stdin.on("error", () => null);
    child.stdin.end(config);
  });
}

module.exports = { requestJsonViaCurl };
