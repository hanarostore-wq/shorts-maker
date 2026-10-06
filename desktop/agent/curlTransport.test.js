const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { requestJsonViaCurl } = require("./curlTransport");

test("GET/POST via curl config stdin preserve UTF-8, quotes and the key", async () => {
  const server = http.createServer((req, res) => {
    let input = "";
    req.on("data", (piece) => { input += piece; });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = req.method === "GET" ? 401 : 200;
      res.end(JSON.stringify({ method: req.method, key: req.headers["x-social-control-key"], body: input ? JSON.parse(input) : null }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api`;
    const key = 'secret"\\key';
    const get = await requestJsonViaCurl(url, "GET", undefined, key);
    assert.equal(get.status, 401);
    assert.equal(get.data.key, key);
    const post = await requestJsonViaCurl(url, "POST", { text: '한글 "인용"\n줄바꿈' }, key);
    assert.equal(post.status, 200);
    assert.equal(post.data.key, key);
    assert.deepEqual(post.data.body, { text: '한글 "인용"\n줄바꿈' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("curl 56 accepts a complete HTTP JSON response but rejects a truncated one", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "curl-close-test-"));
  const binary = path.join(folder, "fake-curl");
  fs.writeFileSync(binary, `#!/usr/bin/env node
let config = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => { config += part; });
process.stdin.on('end', () => {
  const marker = config.match(/__CURL_STATUS_[a-f0-9]{24}__/)[0];
  process.stdout.write((config.includes('bad-response') ? '{"ok":' : '{"ok":true}') + '\\n' + marker + '200');
  process.stderr.write('curl: (56) Failure when receiving data from the peer');
  process.exitCode = 56;
});
`);
  fs.chmodSync(binary, 0o755);
  try {
    const good = await requestJsonViaCurl("https://example.test/ok", "GET", null, "secret", { binary });
    assert.deepEqual(good, { ok: true, status: 200, data: { ok: true } });
    await assert.rejects(() => requestJsonViaCurl("https://example.test/bad-response", "GET", null, "secret", { binary }), /curl HTTP\/1\.1 통신 실패 \(56; HTTP 200/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
