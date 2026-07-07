import { test } from "node:test";
import assert from "node:assert/strict";
import { JavaScriptParser, TypeScriptParser } from "../src/languages/jsts.js";
import { PythonParser } from "../src/languages/python.js";

// Import resolution is pure (no tree-sitter), so it can be unit-tested directly
// against a synthetic file set.
const javascriptPlugin = new JavaScriptParser();
const typescriptPlugin = new TypeScriptParser();
const pythonPlugin = new PythonParser();

test("JS/TS: resolves relative specifier with appended extension", () => {
  const files = new Set(["src/a.ts", "src/b.ts"]);
  assert.equal(typescriptPlugin.resolveImport("./b", "src/a.ts", files), "src/b.ts");
});

test("JS/TS: maps ESM .js specifier onto the .ts source", () => {
  const files = new Set(["src/a.ts", "src/b.ts"]);
  assert.equal(typescriptPlugin.resolveImport("./b.js", "src/a.ts", files), "src/b.ts");
});

test("JS/TS: resolves a directory to its index file", () => {
  const files = new Set(["src/a.ts", "src/feature/index.ts"]);
  assert.equal(typescriptPlugin.resolveImport("./feature", "src/a.ts", files), "src/feature/index.ts");
});

test("JS/TS: bare/package specifiers are external (null)", () => {
  const files = new Set(["src/a.ts"]);
  assert.equal(typescriptPlugin.resolveImport("react", "src/a.ts", files), null);
  assert.equal(javascriptPlugin.resolveImport("node:fs", "src/a.js", files), null);
});

test("JS: require-style relative path resolves to a .js file", () => {
  const files = new Set(["a.js", "b.js"]);
  assert.equal(javascriptPlugin.resolveImport("./b", "a.js", files), "b.js");
});

test("JS/TS: parent-directory traversal normalises correctly", () => {
  const files = new Set(["src/deep/a.ts", "src/b.ts"]);
  assert.equal(typescriptPlugin.resolveImport("../b.js", "src/deep/a.ts", files), "src/b.ts");
});

test("Python: relative import resolves to sibling module", () => {
  const files = new Set(["pkg/main.py", "pkg/models.py"]);
  assert.equal(pythonPlugin.resolveImport(".models", "pkg/main.py", files), "pkg/models.py");
});

test("Python: absolute dotted import resolves from repo root", () => {
  const files = new Set(["pkg/main.py", "pkg/utils.py"]);
  assert.equal(pythonPlugin.resolveImport("pkg.utils", "pkg/main.py", files), "pkg/utils.py");
});

test("Python: import of a package resolves to its __init__.py", () => {
  const files = new Set(["app/main.py", "app/sub/__init__.py"]);
  assert.equal(pythonPlugin.resolveImport("app.sub", "app/main.py", files), "app/sub/__init__.py");
});

test("Python: stdlib/third-party imports are external (null)", () => {
  const files = new Set(["pkg/main.py"]);
  assert.equal(pythonPlugin.resolveImport("os", "pkg/main.py", files), null);
  assert.equal(pythonPlugin.resolveImport("numpy.linalg", "pkg/main.py", files), null);
});
