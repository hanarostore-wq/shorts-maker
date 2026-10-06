const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("MoneyOS desktop startup has no curl worker or social-key prompt", () => {
  const start = read("desktop/start-social.ps1");
  const main = read("desktop/main.js");
  assert.doesNotMatch(start, /Read-Host|SOCIAL_CONTROL_KEY|curl/i);
  assert.match(start, /social-key\.dpapi/);
  assert.match(start, /Remove-Item -Force/);
  assert.doesNotMatch(main, /SOCIAL_CONTROL_KEY|startAgentRuntime|agent\/runtime|curl/i);
  assert.equal(fs.existsSync(path.join(root, "desktop/agent")), false);
});

test("MoneyOS server no longer exposes legacy social queue routes or key authorization", () => {
  for (const relative of [
    "src/app/api/social",
    "src/app/api/blog/naver",
    "src/lib/socialAuth.ts",
    "src/lib/socialThreads.ts",
    "src/lib/threadsPublisher.ts",
  ]) assert.equal(fs.existsSync(path.join(root, relative)), false, `${relative} must be removed`);
  const tasks = read("src/app/api/agent/tasks/route.ts");
  const claim = read("src/app/api/agent/claim/route.ts");
  assert.doesNotMatch(tasks, /접근키|isSocialAuthorized|SOCIAL_CONTROL_KEY/);
  assert.doesNotMatch(claim, /접근키|isSocialAuthorized|SOCIAL_CONTROL_KEY/);
});
