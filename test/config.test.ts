import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walk } from "../src/scanner/walk.js";
import { loadConfig } from "../src/config.js";

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-config-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test("config: defaults when .codemap.json is absent", () => {
  const root = makeRepo({ "a.ts": "" });
  const cfg = loadConfig(root);
  assert.deepEqual(cfg, { exclude: [], languages: null });
  fs.rmSync(root, { recursive: true, force: true });
});

test("config: exclude patterns drop matching files in walk", () => {
  const root = makeRepo({ "keep.ts": "", "gen/skip.ts": "", "a.min.js": "" });
  const cfg = loadConfig(root);
  cfg.exclude = ["gen/", "*.min.js"];
  const rels = walk(root, { exclude: cfg.exclude }).map((f) => f.rel).sort();
  assert.deepEqual(rels, ["keep.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("config: language filter restricts scanned files", () => {
  const root = makeRepo({ "a.ts": "", "b.py": "", "c.js": "" });
  const rels = walk(root, { languages: ["python"] }).map((f) => f.rel);
  assert.deepEqual(rels, ["b.py"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("config: reads exclude + languages from .codemap.json", () => {
  const root = makeRepo({
    ".codemap.json": JSON.stringify({ exclude: ["vendor/"], languages: ["typescript", "python"] }),
  });
  const cfg = loadConfig(root);
  assert.deepEqual(cfg.exclude, ["vendor/"]);
  assert.deepEqual(cfg.languages, ["typescript", "python"]);
  fs.rmSync(root, { recursive: true, force: true });
});
