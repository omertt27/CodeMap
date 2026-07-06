import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walk } from "../src/scanner/walk.js";

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-walk-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test("walk: collects supported files and skips unsupported extensions", () => {
  const root = makeRepo({
    "src/a.ts": "", "src/b.py": "", "src/c.js": "",
    "README.md": "", "data.json": "", "notes.txt": "",
  });
  const rels = walk(root).map((f) => f.rel).sort();
  assert.deepEqual(rels, ["src/a.ts", "src/b.py", "src/c.js"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("walk: honours .gitignore beyond built-in defaults", () => {
  const root = makeRepo({
    ".gitignore": "generated/\n*.gen.ts\n",
    "src/keep.ts": "", "generated/skip.ts": "", "skip.gen.ts": "",
  });
  const rels = walk(root).map((f) => f.rel);
  assert.deepEqual(rels, ["src/keep.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("walk: prunes built-in ignored directories (node_modules)", () => {
  const root = makeRepo({
    "src/a.ts": "", "node_modules/pkg/index.js": "", "dist/out.js": "",
  });
  const rels = walk(root).map((f) => f.rel);
  assert.deepEqual(rels, ["src/a.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("walk: tags each file with its language", () => {
  const root = makeRepo({ "a.ts": "", "b.py": "", "c.jsx": "" });
  const byRel = Object.fromEntries(walk(root).map((f) => [f.rel, f.lang]));
  assert.equal(byRel["a.ts"], "typescript");
  assert.equal(byRel["b.py"], "python");
  assert.equal(byRel["c.jsx"], "javascript");
  fs.rmSync(root, { recursive: true, force: true });
});
