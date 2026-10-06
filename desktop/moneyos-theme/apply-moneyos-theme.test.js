const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const script = path.join(__dirname, "apply-moneyos-theme.js");

function makeFixture(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `moneyos-${kind}-`));
  const html = kind === "naver" ? "src/renderer/index.html" : "index.html";
  const style = kind === "naver" ? "./styles.css" : "/src/renderer/styles.css";
  fs.mkdirSync(path.dirname(path.join(root, html)), { recursive: true });
  fs.writeFileSync(path.join(root, html), `<html><head><link rel="stylesheet" href="${style}" /></head><body>original</body></html>`);
  fs.writeFileSync(path.join(root, "functional-code.js"), "module.exports = 'upstream behavior';\n");
  return { root, html };
}

for (const kind of ["naver", "threads"]) {
  test(`${kind} theme adds one CSS link and preserves functional code`, () => {
    const fixture = makeFixture(kind);
    try {
      for (let i = 0; i < 2; i += 1) execFileSync(process.execPath, [script, "--root", fixture.root, "--kind", kind]);
      const html = fs.readFileSync(path.join(fixture.root, fixture.html), "utf8");
      const css = fs.readFileSync(path.join(fixture.root, "src/renderer/moneyos.css"), "utf8");
      assert.equal((html.match(new RegExp(`MONEYOS_THEME:${kind}`, "g")) || []).length, 1);
      assert.match(css, /MoneyOS visual overlay/);
      assert.equal(fs.readFileSync(path.join(fixture.root, "functional-code.js"), "utf8"), "module.exports = 'upstream behavior';\n");
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });
}
