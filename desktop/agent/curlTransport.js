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
    // Some Windows networks close Vercel HTTP/2 POST responses (curl 56).
    // HTTP/1.1 POST was confirmed reachable on the same machine.
    const child = spawn(binary, ["--http1.1", "--config", "-"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
      const at = stdout.lastIndexOf(marker);
      const status = at < 0 ? 0 : Number(stdout.slice(at + marker.length).trim());
      const validStatus = Number.isInteger(status) && status >= 100 && status <= 599;
      let data;
      if (at >= 0 && validStatus) {
        try { data = JSON.parse(stdout.slice(0, at)); } catch { /* incomplete response */ }
      }
      // Windows Schannel can report curl 56 when the peer omits TLS close_notify
      // after the *complete* response. Accept only a valid JSON body and HTTP status.
      if ((code === 0 || code === 56) && validStatus && data !== undefined) {
        return resolve({ ok: status >= 200 && status < 300, status, data });
      }
      const safeError = stderr.replaceAll(key || "\u0000", "[비공개]").trim().slice(0, 200);
      reject(new Error(`curl HTTP/1.1 통신 실패 (${code}; HTTP ${validStatus ? status : "미수신"}; 본문 ${at < 0 ? 0 : at}자): ${safeError}`));
    });
    child.stdin.on("error", () => null);
    child.stdin.end(config);
  });
}

module.exports = { requestJsonViaCurl };
