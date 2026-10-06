const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
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
