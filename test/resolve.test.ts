import { test } from "node:test";
import assert from "node:assert/strict";
import { javascriptPlugin } from "../src/languages/javascript.js";
import { typescriptPlugin } from "../src/languages/typescript.js";
import { pythonPlugin } from "../src/languages/python.js";

// Import resolution is pure (no tree-sitter), so it can be unit-tested directly
// against a synthetic file set.

test("JS/TS: resolves relative specifier with appended extension", () => {
  const files = new Set(["src/a.ts", "src/b.ts"]);
  assert.equal(typescriptPlugin.resolve("./b", "src/a.ts", files), "src/b.ts");
});

test("JS/TS: maps ESM .js specifier onto the .ts source", () => {
  const files = new Set(["src/a.ts", "src/b.ts"]);
  assert.equal(typescriptPlugin.resolve("./b.js", "src/a.ts", files), "src/b.ts");
});

test("JS/TS: resolves a directory to its index file", () => {
  const files = new Set(["src/a.ts", "src/feature/index.ts"]);
  assert.equal(typescriptPlugin.resolve("./feature", "src/a.ts", files), "src/feature/index.ts");
});

test("JS/TS: bare/package specifiers are external (null)", () => {
  const files = new Set(["src/a.ts"]);
  assert.equal(typescriptPlugin.resolve("react", "src/a.ts", files), null);
  assert.equal(javascriptPlugin.resolve("node:fs", "src/a.js", files), null);
});

test("JS: require-style relative path resolves to a .js file", () => {
  const files = new Set(["a.js", "b.js"]);
  assert.equal(javascriptPlugin.resolve("./b", "a.js", files), "b.js");
});

test("JS/TS: parent-directory traversal normalises correctly", () => {
  const files = new Set(["src/deep/a.ts", "src/b.ts"]);
  assert.equal(typescriptPlugin.resolve("../b.js", "src/deep/a.ts", files), "src/b.ts");
});

test("Python: relative import resolves to sibling module", () => {
  const files = new Set(["pkg/main.py", "pkg/models.py"]);
  assert.equal(pythonPlugin.resolve(".models", "pkg/main.py", files), "pkg/models.py");
});

test("Python: absolute dotted import resolves from repo root", () => {
  const files = new Set(["pkg/main.py", "pkg/utils.py"]);
  assert.equal(pythonPlugin.resolve("pkg.utils", "pkg/main.py", files), "pkg/utils.py");
});

test("Python: import of a package resolves to its __init__.py", () => {
  const files = new Set(["app/main.py", "app/sub/__init__.py"]);
  assert.equal(pythonPlugin.resolve("app.sub", "app/main.py", files), "app/sub/__init__.py");
});

test("Python: stdlib/third-party imports are external (null)", () => {
  const files = new Set(["pkg/main.py"]);
  assert.equal(pythonPlugin.resolve("os", "pkg/main.py", files), null);
  assert.equal(pythonPlugin.resolve("numpy.linalg", "pkg/main.py", files), null);
});
