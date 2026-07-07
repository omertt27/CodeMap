import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../src/graph/build.js";
import type { Graph } from "../src/graph/types.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const node = (g: Graph, p: string) => g.nodes.find((n) => n.path === p)!;
const names = (arr: { name: string }[]) => arr.map((s) => s.name).sort();
const edgePairs = (g: Graph) => g.edges.map((e) => `${e.source.replace("file:", "")}->${e.target.replace("file:", "")}`).sort();

// Golden end-to-end tests: real tree-sitter parsing + plugin extraction +
// import resolution over on-disk fixture repos.

test("ts-basic: files, edges, functions, classes", async () => {
  const g = await buildGraph(path.join(fixtures, "ts-basic"));
  assert.equal(g.stats.files, 3);
  assert.deepEqual(edgePairs(g), ["index.ts->src/a.ts", "src/a.ts->src/b.ts"]);
  assert.deepEqual(names(node(g, "src/a.ts").functions), ["bar", "foo"]); // incl. arrow const
  assert.deepEqual(names(node(g, "src/a.ts").classes), ["Baz"]);
  assert.deepEqual(names(node(g, "src/b.ts").functions), ["helper"]);
});

test("ts-basic: exports are captured (named + arrow + class)", async () => {
  const g = await buildGraph(path.join(fixtures, "ts-basic"));
  assert.deepEqual([...node(g, "src/a.ts").exports].sort(), ["Baz", "bar", "foo"]);
});

test("ts-basic: ESM .js specifier resolves to the .ts source", async () => {
  const g = await buildGraph(path.join(fixtures, "ts-basic"));
  const imp = node(g, "src/a.ts").imports.find((i) => i.raw === "./b.js")!;
  assert.equal(imp.resolved, "src/b.ts");
  assert.equal(imp.external, false);
});

test("py-basic: relative + absolute imports, classes, private heuristic", async () => {
  const g = await buildGraph(path.join(fixtures, "py-basic"));
  assert.equal(g.stats.files, 4); // incl. __init__.py
  assert.deepEqual(edgePairs(g), ["pkg/main.py->pkg/models.py", "pkg/main.py->pkg/utils.py"]);
  assert.deepEqual(names(node(g, "pkg/main.py").classes), ["App"]);
  // `os` is external, methods (run) are not counted as top-level functions.
  assert.deepEqual(names(node(g, "pkg/main.py").functions), ["main"]);
  // `_private` is extracted but NOT exported (leading underscore).
  const models = node(g, "pkg/models.py");
  assert.deepEqual(names(models.functions), ["_private"]);
  assert.ok(!models.exports.includes("_private"));
  assert.ok(models.exports.includes("User"));
});

test("py-basic: stdlib import is marked external", async () => {
  const g = await buildGraph(path.join(fixtures, "py-basic"));
  const osImp = node(g, "pkg/main.py").imports.find((i) => i.raw === "os")!;
  assert.equal(osImp.external, true);
  assert.equal(osImp.resolved, null);
});

test("js-cjs: require() is treated as a dependency edge", async () => {
  const g = await buildGraph(path.join(fixtures, "js-cjs"));
  assert.deepEqual(edgePairs(g), ["a.js->b.js"]);
  assert.deepEqual(names(node(g, "a.js").functions), ["go"]);
});

test("java-basic: fully-qualified import resolves to the class file", async () => {
  const g = await buildGraph(path.join(fixtures, "java-basic"));
  assert.equal(g.stats.files, 2);
  assert.deepEqual(edgePairs(g), ["com/example/app/Server.java->com/example/lib/Helper.java"]);
  const server = node(g, "com/example/app/Server.java");
  assert.deepEqual(names(server.classes), ["Server"]);
  // In the legacy file-graph, methods are not file-level functions (they belong
  // to a class — see the generic CodeGraph for Method nodes).
  assert.deepEqual(names(server.functions), []);
  // java.util.List is not in the repo → external.
  const listImp = server.imports.find((i) => i.raw === "java.util.List")!;
  assert.equal(listImp.external, true);
  assert.equal(node(g, "com/example/app/Server.java").lang, "java");
});
