import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const tool = path.join(root, 'tools', 'make-paid.mjs');

test('유료판: 블랙전용(black/ 폴더·manifest·import·팝업 script) 이 모두 빠짐', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-'));
  const r = spawnSync(process.execPath, [tool, path.join(out, 'ext')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const ext = path.join(out, 'ext');
  assert.equal(fs.existsSync(path.join(ext, 'black')), false);
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  assert.equal(mf.content_scripts.some((g) => g.js.some((f) => f.startsWith('black/'))), false);
  assert.equal((mf.optional_permissions || []).includes('bookmarks'), false);
  assert.equal((mf.permissions || []).includes('bookmarks'), false);
  assert.equal((mf.optional_permissions || []).includes('proxy'), false);
  assert.doesNotMatch(fs.readFileSync(path.join(ext, 'background', 'service-worker.js'), 'utf8'), /black/);
  assert.doesNotMatch(fs.readFileSync(path.join(ext, 'popup', 'popup.html'), 'utf8'), /black/);
  // 원본(개인판)에는 그대로 있음
  assert.equal(fs.existsSync(path.join(root, 'extension', 'black', 'black-content.js')), true);
  fs.rmSync(out, { recursive: true, force: true });
});

test('유료판(오류 경로): 블랙전용 흔적이 남으면 파일·줄과 조치를 알리고 실패', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paidbad-'));
  const src = path.join(tmp, 'src');
  fs.cpSync(path.join(root, 'extension'), src, { recursive: true });
  fs.appendFileSync(path.join(src, 'content', 'core.js'), "\nconst leak = 'blackAltW';\n");
  const r = spawnSync(process.execPath, [tool, path.join(tmp, 'out')], { encoding: 'utf8', env: { ...process.env, MAKE_PAID_SRC: src } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /단계: 블랙전용 흔적 검사/);
  assert.match(r.stderr, /content\/core\.js:\d+/);
  assert.match(r.stderr, /조치:/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
