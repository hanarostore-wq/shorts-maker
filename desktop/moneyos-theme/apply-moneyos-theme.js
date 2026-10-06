#!/usr/bin/env node
/* Applies only a CSS link/copy to the exact upstream source checkout.
   No main process, renderer behavior, IPC, database, scheduling, or publishing code is changed. */
const fs = require("node:fs");
const path = require("node:path");

function argument(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : null;
}

const root = argument("--root");
const kind = argument("--kind");
if (!root || !["naver", "threads"].includes(kind)) {
  throw new Error("Usage: node apply-moneyos-theme.js --root <upstream checkout> --kind naver|threads");
}
const spec = kind === "naver"
  ? { html: "src/renderer/index.html", css: "src/renderer/moneyos.css", link: "./moneyos.css", source: "naver-moneyos.css" }
  : { html: "index.html", css: "src/renderer/moneyos.css", link: "/src/renderer/moneyos.css", source: "threads-moneyos.css" };
const appRoot = path.resolve(root);
const themeRoot = __dirname;
const htmlPath = path.join(appRoot, spec.html);
const cssPath = path.join(appRoot, spec.css);
const sourcePath = path.join(themeRoot, spec.source);
if (!fs.existsSync(htmlPath) || !fs.existsSync(sourcePath)) throw new Error(`Theme target missing for ${kind}`);
fs.mkdirSync(path.dirname(cssPath), { recursive: true });
fs.copyFileSync(sourcePath, cssPath);
const marker = `<!-- MONEYOS_THEME:${kind} -->`;
const link = `<link rel="stylesheet" href="${spec.link}" /> ${marker}`;
let html = fs.readFileSync(htmlPath, "utf8");
html = html.replace(new RegExp(`\\s*<link\\s+rel=["']stylesheet["']\\s+href=["']${spec.link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*/?>\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}?`, "g"), "");
if (!html.includes(marker)) {
  const styleLink = kind === "naver"
    ? /<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*\/>/
    : /<link\s+rel="stylesheet"\s+href="\/src\/renderer\/styles\.css"\s*\/>/;
  if (!styleLink.test(html)) throw new Error(`Unable to find upstream stylesheet link for ${kind}`);
  html = html.replace(styleLink, (match) => `${match}\n    ${link}`);
}
fs.writeFileSync(htmlPath, html);
const gitHead = (() => {
  try { return fs.readFileSync(path.join(appRoot, ".git", "HEAD"), "utf8").trim(); }
  catch { return "unavailable"; }
})();
fs.writeFileSync(path.join(appRoot, ".moneyos-theme.json"), JSON.stringify({ kind, appliedAt: new Date().toISOString(), upstreamHead: gitHead, mode: "css-overlay-only" }, null, 2) + "\n");
console.log(`MoneyOS ${kind} CSS overlay applied: ${cssPath}`);
