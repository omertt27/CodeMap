import { test } from "node:test";
import assert from "node:assert/strict";
import { DependencyIndex } from "../src/analysis/graph.js";
import { shortestPath } from "../src/analysis/paths.js";
import { searchSymbols } from "../src/mcp/symbols.js";
import { findApiRoutes, findConfiguration, findDatabaseModels, findEntryPoints, findTests } from "../src/mcp/navigation.js";
import type { Graph, FileNode, Edge } from "../src/graph/types.js";
import type { CodeGraph } from "../src/graph/model.js";

function file(path: string, over: Partial<FileNode> = {}): FileNode {
  return { id: `file:${path}`, path, name: path.split("/").pop()!, dir: path.slice(0, Math.max(0, path.lastIndexOf("/"))),
    lang: "typescript", loc: 10, size: 100, imports: [], exports: [], functions: [], classes: [], ...over };
}
function edge(a: string, b: string): Edge {
  return { id: `file:${a}->file:${b}`, source: `file:${a}`, target: `file:${b}`, type: "import", raw: `./${b}` };
}
function graph(nodes: FileNode[], edges: Edge[] = []): Graph {
  return { version: 1, root: "/r", generatedAt: "", stats: { files: nodes.length, edges: edges.length, languages: {}, functions: 0, classes: 0 }, nodes, edges };
}

test("navigation: classifies entry points, api routes, models, config, tests", () => {
  const files = [
    file("src/main.ts"), file("src/api/login.ts"), file("src/models/user.ts"),
    file("src/config.ts"), file("test/login.test.ts"), file("src/util.ts"),
  ];
  // API routes are entry points too, so both main.ts and api/login.ts qualify.
  assert.deepEqual(findEntryPoints(files).map((f) => f.path).sort(), ["src/api/login.ts", "src/main.ts"]);
  assert.deepEqual(findApiRoutes(files).map((f) => f.path), ["src/api/login.ts"]);
  assert.deepEqual(findDatabaseModels(files).map((f) => f.path), ["src/models/user.ts"]);
  assert.deepEqual(findConfiguration(files).map((f) => f.path), ["src/config.ts"]);
  assert.deepEqual(findTests(files).map((f) => f.path), ["test/login.test.ts"]);
});

test("dependency_path: shortest import chain", () => {
  const idx = new DependencyIndex(graph(
    [file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")],
    [edge("a.ts", "b.ts"), edge("b.ts", "c.ts"), edge("a.ts", "d.ts")],
  ));
  assert.deepEqual(shortestPath(idx, "file:a.ts", "file:c.ts"), ["a.ts", "b.ts", "c.ts"]);
  assert.equal(shortestPath(idx, "file:c.ts", "file:a.ts"), null); // no reverse path
});

test("search_symbol: matches by name with references", () => {
  const fileGraph = graph([file("src/auth.ts"), file("src/api.ts")], [edge("src/api.ts", "src/auth.ts")]);
  const idx = new DependencyIndex(fileGraph);
  const codeGraph = {
    version: 1, generatedAt: "", root: "/r",
    stats: {} as CodeGraph["stats"],
    nodes: [
      { id: "sym:src/auth.ts#function:login@3", type: "Function", name: "login", path: "src/auth.ts", line: 3, exported: true },
      { id: "sym:src/api.ts#function:handler@1", type: "Function", name: "handler", path: "src/api.ts", line: 1, exported: true },
    ],
    edges: [],
  } as unknown as CodeGraph;
  const hits = searchSymbols(codeGraph, idx, "login");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "src/auth.ts");
  assert.deepEqual(hits[0].references, ["src/api.ts"]); // api imports auth
});
